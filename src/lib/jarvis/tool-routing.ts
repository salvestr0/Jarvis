import { TOOL_SCHEMAS, type ToolSchema } from './tool-schemas.ts'

/**
 * Keep DeepSeek's tool-choice problem small.
 *
 * Jarvis used to send every tool schema on every turn. That grew to 68 tools,
 * so even a one-line request such as "log lunch $5" made the model choose from
 * the entire product. The router is deliberately deterministic: it cannot
 * hallucinate a domain, costs no extra model call, and follow-up messages can
 * inherit the domain from the immediately preceding conversation.
 */

export const TOOL_GROUPS = {
  finance: [
    'get_net_worth',
    'get_net_worth_history',
    'get_month_summary',
    'get_month_transactions',
    'log_transaction',
    'delete_transaction',
    'get_accounts',
    'create_account',
    'update_account',
    'archive_account',
  ],
  recurring: [
    'get_recurring',
    'create_recurring',
    'update_recurring',
    'log_recurring_payment',
    'delete_recurring',
  ],
  investing: ['get_holdings', 'create_holding', 'update_holding', 'delete_holding'],
  tasks: ['get_tasks', 'create_task', 'set_task_done', 'update_task', 'delete_task'],
  goals: ['get_goals', 'create_goal', 'update_goal', 'set_goal_status', 'delete_goal'],
  projects: [
    'get_projects',
    'create_project',
    'update_project',
    'set_project_status',
    'record_project_metric',
    'delete_project',
  ],
  career: ['get_jobs', 'create_job', 'update_job', 'delete_job', 'create_win', 'delete_win'],
  calendar: ['get_calendar_events', 'create_calendar_event'],
  email: ['search_email', 'get_email', 'create_email_draft'],
  spotify: ['spotify_play', 'spotify_control', 'spotify_now_playing'],
  pc: ['pc_list_dir', 'pc_read_file', 'pc_search_files', 'pc_run_action', 'pc_job_status'],
  reminders: ['create_reminder', 'list_reminders', 'cancel_reminder'],
  alerts: ['create_price_alert', 'list_price_alerts', 'cancel_price_alert'],
  content: [
    'save_content_idea',
    'list_content_ideas',
    'create_content_draft',
    'list_content_drafts',
    'set_content_status',
  ],
} as const

export type ToolDomain = keyof typeof TOOL_GROUPS

// These stay available because they apply across domains and add only three
// choices. Web search is external knowledge; remember/forget are user memory.
export const CORE_TOOL_NAMES = ['web_search', 'remember', 'forget'] as const

const DOMAIN_PATTERNS: Readonly<Record<ToolDomain, readonly RegExp[]>> = {
  finance: [
    /\b(?:money|finance|financial|spent|spend|spending|expense|income|transaction|budget|saving|savings|net worth|cash balance)\b/i,
    /\b(?:bank|cash|brokerage|wallet) account\b/i,
    /(?:^|\s)(?:s\$|sgd|\$)\s*\d/i,
    /\b\d+(?:\.\d{1,2})?\s*(?:dollars?|bucks?)\b/i,
    /\b(?:log|record|add)\s+(?:an?\s+)?(?:expense\s+)?\d+(?:\.\d{1,2})?\b/i,
  ],
  recurring: [
    /\b(?:recurring|subscription|subscriptions|monthly bill|annual bill|renewal|next due)\b/i,
  ],
  investing: [
    /\b(?:portfolio|holding|holdings|investment|investments|stock|stocks|shares|crypto|bitcoin|ethereum|btc|eth|cost basis)\b/i,
  ],
  tasks: [
    /\b(?:task|tasks|todo|to-do|checklist|priority|priorities|mark .* done|complete .* task)\b/i,
  ],
  goals: [/\b(?:goal|goals|objective|objectives|target date|achieved|dropped goal)\b/i],
  projects: [
    /\b(?:project|projects|mrr|monthly recurring revenue|users count|launch date|launched|beta|building|paused project)\b/i,
  ],
  career: [
    /\b(?:job|jobs|career|employer|employment|salary|interview|work role|job title|career win|achievement at work)\b/i,
  ],
  calendar: [
    /\b(?:calendar|meeting|appointment|event|availability|free time|schedule .*?(?:meeting|call|event))\b/i,
  ],
  email: [/\b(?:email|emails|gmail|inbox|mail from|draft .*?email|sender|subject line)\b/i],
  spotify: [/\b(?:spotify|music|song|songs|playlist|track|album|artist|now playing)\b/i],
  pc: [
    /\b(?:pc|computer|screenshot|desktop|downloads?|documents?|folder|file|open (?:chrome|edge|spotify|discord|telegram|steam|notepad)|lock screen|volume|mute|shut ?down|restart)\b/i,
  ],
  reminders: [/\b(?:remind|reminder|reminders|remind me|notification at)\b/i],
  alerts: [/\b(?:price alert|alert me when|notify me when .*?(?:price|stock|crypto)|crosses? (?:above|below))\b/i],
  content: [
    /\b(?:content|post|posts|content idea|draft .*?(?:post|script|caption)|hook|social media|publish|posted)\b/i,
  ],
}

const FOLLOW_UP =
  /^(?:(?:yes|yeah|yep|yup|ok|okay|sure)[,! ]+(?:do it|go ahead|please do)|yes|yeah|yep|yup|ok|okay|sure|do it|go ahead|that one|this one|it|please do)[.! ]*$/i

function matchDomains(text: string): ToolDomain[] {
  return (Object.keys(DOMAIN_PATTERNS) as ToolDomain[]).filter((domain) =>
    DOMAIN_PATTERNS[domain].some((pattern) => pattern.test(text))
  )
}

export type ToolSelection = {
  domains: ToolDomain[]
  tools: ToolSchema[]
}

/** Select a small, relevant tool surface for one user turn. */
export function selectToolsForTurn(
  userText: string,
  recentConversation: readonly string[] = []
): ToolSelection {
  let domains = matchDomains(userText)

  // "yes, do it" needs the tools discussed in the last exchange. Do not mix
  // old domains into a normal new request; that is how the tool list bloats.
  if (domains.length === 0 && FOLLOW_UP.test(userText.trim())) {
    domains = matchDomains(recentConversation.slice(-2).join('\n'))
  }

  const names = new Set<string>(CORE_TOOL_NAMES)
  for (const domain of domains) {
    for (const name of TOOL_GROUPS[domain]) names.add(name)
  }

  return {
    domains,
    tools: TOOL_SCHEMAS.filter((tool) => names.has(tool.name)),
  }
}

/**
 * Conservative first-round forcing for clear, non-destructive commands.
 * Deletes are excluded because Jarvis must ask for confirmation first.
 */
export function isExplicitToolRequest(
  userText: string,
  recentConversation: readonly string[] = []
): boolean {
  const text = userText.trim()
  const imperative =
    /^(?:(?:please|pls)\s+)?(?:log|add|create|save|record|remind|schedule|draft|play|pause|resume|open|set|update|mark|queue|remember)\b/i
  const polite =
    /^(?:can|could|would|will) you\s+(?:please\s+)?(?:log|add|create|save|record|remind|schedule|draft|play|pause|resume|open|set|update|mark|queue|remember)\b/i

  if (imperative.test(text) || polite.test(text) || /^remind me\b/i.test(text)) return true

  // After Jarvis has asked for destructive-action confirmation, an explicit
  // yes should force the confirmed tool call instead of allowing another
  // unsupported "done" response.
  if (FOLLOW_UP.test(text)) {
    return /\b(?:delete|remove|archive|forget|shut ?down|restart)\b/i.test(
      recentConversation.slice(-2).join('\n')
    )
  }

  return false
}

/**
 * Force an exact first tool only when both intent and the minimum identifying
 * detail are present. Broader imperatives still get max reasoning effort, but
 * remain on automatic choice so the model can ask a missing-detail question.
 */
export function forcedToolNameForRequest(userText: string): string | null {
  const text = userText.trim()
  const hasAmount =
    /(?:^|\s)(?:s\$|sgd|\$)?\s*\d+(?:\.\d{1,2})?(?:\s|$)/i.test(text)

  if (
    hasAmount &&
    /^(?:(?:please|pls)\s+)?(?:log|record|add)\b/i.test(text) &&
    /\b(?:expense|income|spent|spend|transaction|lunch|dinner|breakfast|food|transport|salary|pay)\b/i.test(text)
  ) {
    return 'log_transaction'
  }

  if (
    /^remind me\b/i.test(text) &&
    /\b(?:at\s+\d|in\s+\d|today|tomorrow|tonight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)
  ) {
    return 'create_reminder'
  }

  if (/^(?:(?:please|pls)\s+)?(?:create|add|make) (?:a )?task (?:to |for )?.{3,}/i.test(text)) {
    return 'create_task'
  }

  if (/^(?:(?:please|pls)\s+)?remember (?:that )?.{3,}/i.test(text)) return 'remember'

  if (/^(?:(?:please|pls)\s+)?(?:save|record) .{3,} (?:as )?(?:a )?content idea\b/i.test(text)) {
    return 'save_content_idea'
  }

  if (/^(?:(?:please|pls)\s+)?(?:play|queue) .{2,}/i.test(text)) return 'spotify_play'
  if (/^(?:(?:please|pls)\s+)?(?:pause|resume|skip|next track|previous track)\b/i.test(text)) {
    return 'spotify_control'
  }

  if (
    /^(?:(?:please|pls)\s+)?(?:take (?:a )?screenshot|open (?:chrome|edge|spotify|discord|telegram|steam|notepad)|lock (?:the )?screen|mute|shut ?down|restart (?:the )?(?:pc|computer))\b/i.test(text)
  ) {
    return 'pc_run_action'
  }

  if (
    /^(?:(?:please|pls)\s+)?(?:create|set)\b.*\b(?:price )?alert\b/i.test(text) &&
    /\b(?:above|below)\b/i.test(text) &&
    hasAmount
  ) {
    return 'create_price_alert'
  }

  return null
}
