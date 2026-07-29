/**
 * Tier-2 named actions. What Jarvis can DO on this PC is exactly the set of
 * keys in actions.json — the cloud sends a name, this file decides what (if
 * anything) that name means. No templating, no free-form arguments: every
 * runnable thing is a literal argv array or a builtin implemented here.
 */

import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Refusal } from './executors.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ACTION_TIMEOUT_MS = 30_000

/**
 * Pure resolution: request → { argv } or { builtin }. Throws Refusal with
 * the available options, so a wrong guess from the model self-corrects.
 */
export function resolveAction(actions, payload) {
  const name = typeof payload.action === 'string' ? payload.action.trim() : ''
  const action = actions[name]
  if (!action) {
    throw new Refusal(
      `Unknown action "${name || '(none)'}". Available: ${Object.keys(actions).join(', ')}.`
    )
  }

  if (action.needs_confirm && payload.confirmed !== true) {
    throw new Refusal(
      `"${name}" requires explicit confirmation — ask Jayden, then retry with confirmed: true.`
    )
  }

  if (action.variants) {
    const arg = typeof payload.arg === 'string' ? payload.arg.trim().toLowerCase() : ''
    const argv = action.variants[arg]
    if (!argv) {
      throw new Refusal(
        `"${name}" needs arg — one of: ${Object.keys(action.variants).join(', ')}.`
      )
    }
    return { name, argv }
  }
  if (action.argv) return { name, argv: action.argv }
  if (action.builtin) return { name, builtin: action.builtin }
  throw new Refusal(`Action "${name}" is misconfigured in actions.json.`)
}

/** Basic shape check at startup so a bad edit fails loudly, not per-job. */
export function validateActions(actions) {
  for (const [name, action] of Object.entries(actions)) {
    const argvs = action.variants ? Object.values(action.variants) : action.argv ? [action.argv] : []
    if (!action.builtin && argvs.length === 0) {
      throw new Error(`actions.json: "${name}" has no argv, variants, or builtin.`)
    }
    for (const argv of argvs) {
      if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string')) {
        throw new Error(`actions.json: "${name}" argv must be a non-empty string array.`)
      }
    }
  }
  return actions
}

/**
 * Fire-and-forget launch. Detached so the job finishing never kills the
 * app, and no shell so argv items can't be reinterpreted as syntax. We
 * watch for ~1.2s to catch a bad path or an instant non-zero exit, then
 * report "started" — apps are supposed to outlive the job.
 */
function launch(argv) {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(argv[0], argv.slice(1), {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`${argv[0]} exited with code ${code}`))
    })
    child.unref()
    setTimeout(resolve, 1200)
  })
}

/**
 * Builtins that need more than launching an app are small C# helpers,
 * compiled on first use with the .NET Framework csc.exe Windows ships — a
 * PowerShell version of the screenshot trips Defender's AMSI ("malicious
 * content") because script screen-capture is a known bad pattern; a plain
 * compiled helper is the boring, supported path.
 */
const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: ACTION_TIMEOUT_MS }, (error) =>
      error ? reject(error) : resolve()
    )
  })
}

/** Compile <name>.cs beside this file into <name>.exe when missing or stale. */
async function ensureHelper(name, refs = []) {
  const exe = join(here, `${name}.exe`)
  const source = join(here, `${name}.cs`)
  const [exeStat, sourceStat] = await Promise.all([
    fs.stat(exe).catch(() => null),
    fs.stat(source),
  ])
  if (!exeStat || exeStat.mtimeMs < sourceStat.mtimeMs) {
    await run(CSC, [
      '/nologo',
      '/target:winexe',
      ...refs.map((r) => `/r:${r}`),
      `/out:${exe}`,
      source,
    ])
  }
  return exe
}

/**
 * Capture → scaled JPEG → base64 in the result. The cloud side relays it
 * to Telegram and strips the bytes before the model sees anything.
 */
async function screenshot() {
  const exe = await ensureHelper('screenshot', [
    'System.Drawing.dll',
    'System.Windows.Forms.dll',
  ])

  const out = join(tmpdir(), `jarvis-shot-${Date.now()}.jpg`)
  await run(exe, [out])
  try {
    const bytes = await fs.readFile(out)
    if (bytes.length > 3 * 1024 * 1024) {
      throw new Error('Screenshot came out over 3MB — not sending.')
    }
    return { screenshot_b64: bytes.toString('base64'), bytes: bytes.length }
  } finally {
    await fs.unlink(out).catch(() => {})
  }
}

/**
 * Presses the hardware media/volume key — Windows routes it to the active
 * media session or the system mixer, like the keyboard key. Volume moves
 * 2/100 per press, hence the repeat count.
 */
async function mediaKey(key, count = 1) {
  const exe = await ensureHelper('mediakey')
  await run(exe, count > 1 ? [key, String(count)] : [key])
  return { pressed: key, count }
}

/**
 * Topmost "Jarvis" message box on the desktop. The one builtin that accepts
 * free text — display-only: the text travels as a single argv item (no
 * shell to reinterpret it) and notify.cs only ever renders it.
 */
async function notify(payload) {
  const text =
    typeof payload.arg === 'string' ? payload.arg.replace(/\s+/g, ' ').trim() : ''
  if (!text) throw new Refusal('"notify" needs arg — the message to show on screen.')
  if (text.length > 200) {
    throw new Refusal('"notify" message must be 200 characters or fewer.')
  }
  const exe = await ensureHelper('notify')
  await launch([exe, text])
  return { shown: text }
}

const BUILTINS = {
  screenshot: () => screenshot(),
  'media:play_pause': () => mediaKey('play_pause'),
  'media:next': () => mediaKey('next'),
  'media:prev': () => mediaKey('prev'),
  'media:volume_up': () => mediaKey('volume_up', 5),
  'media:volume_down': () => mediaKey('volume_down', 5),
  'media:mute': () => mediaKey('mute'),
  notify: (payload) => notify(payload),
}

export async function runAction(payload, actions) {
  const resolved = resolveAction(actions, payload)
  if (resolved.builtin) {
    const builtin = BUILTINS[resolved.builtin]
    if (!builtin) {
      throw new Refusal(`Action "${resolved.name}" is misconfigured in actions.json.`)
    }
    return await builtin(payload)
  }
  await launch(resolved.argv)
  return { action: resolved.name, started: true }
}
