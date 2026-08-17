/**
 * Live, read-only DeepSeek eval for Jarvis tool selection.
 *
 * It compares the old 68-tool surface with the deterministic routed surface.
 * No Jarvis tool is executed, so this cannot write tracker/Google/PC data.
 * It does make ordinary DeepSeek API calls and therefore has a tiny API cost.
 *
 * Run: npm run eval:jarvis
 */

import Anthropic from '@anthropic-ai/sdk'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TOOL_SCHEMAS } from '../src/lib/jarvis/tool-schemas.ts'
import {
  forcedToolNameForRequest,
  selectToolsForTurn,
} from '../src/lib/jarvis/tool-routing.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvLocal() {
  const file = join(root, '.env.local')
  if (!existsSync(file)) return {}
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

const env = { ...loadEnvLocal(), ...process.env }
if (!env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY is missing from .env.local or the environment.')
  process.exit(2)
}

const client = new Anthropic({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/anthropic',
  timeout: 120_000,
})

const SYSTEM = [
  "You are Jarvis, Jayden's personal assistant.",
  'It is Mon 2026-08-17 17:00 Singapore time (SGT, UTC+8).',
  'Use a tool whenever the request depends on his data or asks you to perform an action.',
  'Never say an action succeeded unless its action tool ran successfully.',
  'If required details are missing, ask instead of inventing them.',
].join('\n')

const CASES = [
  {
    prompt: 'Log S$5.70 for lunch as Food',
    expected: 'log_transaction',
    validate: (input) =>
      input.direction === 'expense' &&
      String(input.amount).includes('5.70') &&
      String(input.category).toLowerCase() === 'food',
  },
  {
    prompt: 'Log 5.70 lunch',
    expected: 'log_transaction',
    validate: (input) => input.direction === 'expense' && String(input.amount).includes('5.70'),
  },
  { prompt: 'How much did I spend this month?', expected: 'get_month_summary' },
  { prompt: 'What tasks do I have due?', expected: 'get_tasks' },
  {
    prompt: 'Remind me tomorrow at 9am to submit the SingSaver form',
    expected: 'create_reminder',
    validate: (input) =>
      input.due_at === '2026-08-18 09:00' &&
      String(input.body).toLowerCase().includes('singsaver'),
  },
  {
    prompt: 'Check Gmail for recent emails from OCBC',
    expected: 'search_email',
    validate: (input) => String(input.query).toLowerCase().includes('ocbc'),
  },
  {
    prompt: 'Play my Deep Focus playlist on Spotify',
    expected: 'spotify_play',
    validate: (input) =>
      String(input.query).toLowerCase().includes('deep focus') && input.kind === 'playlist',
  },
  { prompt: 'What is on my calendar tomorrow?', expected: 'get_calendar_events' },
  { prompt: 'How are you?', expected: null },
]

function calledTools(response) {
  return response.content
    .filter((block) => block.type === 'tool_use')
    .map((block) => block.name)
}

function toolCalls(response) {
  return response.content.filter((block) => block.type === 'tool_use')
}

function totalInputTokens(usage) {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  )
}

async function runCase(testCase, routed) {
  const selection = routed
    ? selectToolsForTurn(testCase.prompt)
    : { tools: TOOL_SCHEMAS, domains: [] }
  const forced = routed ? forcedToolNameForRequest(testCase.prompt) : null
  const started = Date.now()
  const response = await client.messages.create({
    model: 'deepseek-v4-flash',
    max_tokens: 4096,
    system: SYSTEM,
    tools: selection.tools,
    messages: [{ role: 'user', content: testCase.prompt }],
    ...(forced
      ? { thinking: { type: 'disabled' } }
      : { output_config: { effort: 'high' } }),
    ...(forced ? { tool_choice: { type: 'tool', name: forced } } : {}),
  })
  const calls = toolCalls(response)
  const called = calledTools(response)
  const expectedCall = calls.find((call) => call.name === testCase.expected)
  const argsPassed =
    !testCase.validate || (expectedCall ? testCase.validate(expectedCall.input) : false)
  const passed = testCase.expected === null
    ? called.length === 0
    : Boolean(expectedCall) && argsPassed
  return {
    passed,
    called,
    badArgs: expectedCall && !argsPassed ? expectedCall.input : null,
    offered: selection.tools.length,
    latencyMs: Date.now() - started,
    inputTokens: totalInputTokens(response.usage),
    outputTokens: response.usage.output_tokens,
  }
}

async function runEmailLoggingTrajectory(routed) {
  const prompt = "Find today's PayLah transaction emails and log each expense."
  const selection = routed
    ? selectToolsForTurn(prompt)
    : { tools: TOOL_SCHEMAS, domains: [] }
  const messages = [{ role: 'user', content: prompt }]
  const recorded = []
  const unexpectedActions = []
  let inputTokens = 0
  let outputTokens = 0
  const started = Date.now()

  for (let round = 0; round < 6; round++) {
    const response = await client.messages.create({
      model: 'deepseek-v4-flash',
      max_tokens: 4096,
      system: SYSTEM,
      tools: selection.tools,
      messages,
      output_config: { effort: 'high' },
    })
    inputTokens += totalInputTokens(response.usage)
    outputTokens += response.usage.output_tokens
    const calls = toolCalls(response)
    if (calls.length === 0) {
      const amounts = recorded.map((item) => item.amount).sort()
      return {
        passed:
          unexpectedActions.length === 0 &&
          amounts.length === 2 &&
          amounts[0] === '2.50' &&
          amounts[1] === '5.70',
        offered: selection.tools.length,
        recorded,
        unexpectedActions,
        rounds: round + 1,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
      }
    }

    messages.push({ role: 'assistant', content: response.content })
    const results = calls.map((call) => {
      let content
      let isError = false
      if (call.name === 'search_email') {
        content = JSON.stringify({
          results: [
            {
              id: 'mail-1',
              subject: 'PayLah! transaction',
              snippet: 'You sent SGD 5.70 to Jiang Quan for lunch today.',
            },
            {
              id: 'mail-2',
              subject: 'PayLah! transaction',
              snippet: 'You sent SGD 2.50 to MyActiveSG Plus today.',
            },
          ],
        })
      } else if (call.name === 'get_email') {
        const id = call.input.email_id
        content = JSON.stringify(
          id === 'mail-1'
            ? { id, body: 'You sent SGD 5.70 to Jiang Quan for lunch today.' }
            : { id, body: 'You sent SGD 2.50 to MyActiveSG Plus today.' }
        )
      } else if (call.name === 'get_month_transactions') {
        content = JSON.stringify({ transactions: [] })
      } else if (call.name === 'log_transaction') {
        const numeric = Number.parseFloat(String(call.input.amount).replace(/[^0-9.]/g, ''))
        const amount = Number.isFinite(numeric) ? numeric.toFixed(2) : 'invalid'
        recorded.push({ amount, input: call.input })
        content = JSON.stringify({
          logged: {
            date: '2026-08-17',
            direction: call.input.direction,
            amount: { display: `S$${amount}` },
            category: call.input.category ?? null,
            note: call.input.note ?? null,
          },
        })
      } else {
        unexpectedActions.push(call.name)
        content = `Unexpected tool in eval: ${call.name}`
        isError = true
      }
      return {
        type: 'tool_result',
        tool_use_id: call.id,
        content,
        ...(isError ? { is_error: true } : {}),
      }
    })
    messages.push({ role: 'user', content: results })
  }

  return {
    passed: false,
    offered: selection.tools.length,
    recorded,
    unexpectedActions,
    rounds: 6,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
  }
}

let routedFailures = 0
for (const routed of [false, true]) {
  const label = routed ? 'ROUTED' : 'ALL-68'
  let passed = 0
  let inputTokens = 0
  let outputTokens = 0
  let latencyMs = 0
  console.log(`\n${label}`)

  for (const testCase of CASES) {
    try {
      const result = await runCase(testCase, routed)
      if (result.passed) passed += 1
      if (routed && !result.passed) routedFailures += 1
      inputTokens += result.inputTokens
      outputTokens += result.outputTokens
      latencyMs += result.latencyMs
      console.log(
        `${result.passed ? 'PASS' : 'FAIL'} | ${result.offered} tools | ` +
          `${result.latencyMs}ms | called: ${result.called.join(', ') || 'none'} | ` +
          testCase.prompt
      )
      if (result.badArgs) console.log(`       bad args: ${JSON.stringify(result.badArgs)}`)
    } catch (error) {
      if (routed) routedFailures += 1
      console.log(`ERROR | ${testCase.prompt} | ${error instanceof Error ? error.message : error}`)
    }
  }

  console.log(
    `${label} SUMMARY: ${passed}/${CASES.length} passed; ` +
      `${inputTokens} input tokens; ${outputTokens} output tokens; ${latencyMs}ms total`
  )

  try {
    const trajectory = await runEmailLoggingTrajectory(routed)
    if (routed && !trajectory.passed) routedFailures += 1
    console.log(
      `${trajectory.passed ? 'PASS' : 'FAIL'} | ${trajectory.offered} tools | ` +
        `${trajectory.rounds} rounds | ${trajectory.latencyMs}ms | ` +
        `mock writes: ${trajectory.recorded.map((item) => item.amount).join(', ') || 'none'} | ` +
        'email reads -> two transaction writes'
    )
    if (!trajectory.passed) {
      console.log(`       writes: ${JSON.stringify(trajectory.recorded)}`)
      console.log(`       unexpected: ${trajectory.unexpectedActions.join(', ') || 'none'}`)
    }
  } catch (error) {
    if (routed) routedFailures += 1
    console.log(
      `ERROR | email reads -> two transaction writes | ${error instanceof Error ? error.message : error}`
    )
  }
}

process.exitCode = routedFailures === 0 ? 0 : 1
