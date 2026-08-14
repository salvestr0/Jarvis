/**
 * Fabricated-action detection for the Jarvis tool loop.
 *
 * DeepSeek V4 Flash claims completed actions it never performed. Twice on
 * 14 Aug: once with no tool calls at all, and once AFTER genuinely calling
 * search_email/get_email — it read the bank emails, then announced "Logged
 * today: Food 5.70, Sports 2.50" without ever calling log_transaction. So
 * "did any tool run" is not the question; "did an ACTION tool run" is.
 *
 * The agent loop asks `claimsAction` about a final reply and, if no tool from
 * ACTION_TOOLS ran in that turn, discards the reply and retries once.
 *
 * Import-free on purpose (repo convention: `node --test` can't resolve `@/`
 * aliases, tested lib modules are self-contained). ACTION_TOOLS is kept in
 * sync with TOOL_SCHEMAS by a test — adding a tool without classifying it
 * fails the verify gate, which matters in both directions: an unclassified
 * write would let fabrications through, and misclassifying a real write as a
 * read would make the guard demand a retry of work already done.
 */

/**
 * Every tool that changes state somewhere — the tracker DB, Google, Spotify,
 * or the PC. Anything not listed is read-only, so a reply claiming an action
 * after only those must be a fabrication.
 */
export const ACTION_TOOLS: ReadonlySet<string> = new Set([
  // money / tracker writes
  'log_transaction',
  'log_recurring_payment',
  'create_recurring',
  'update_recurring',
  'delete_recurring',
  'create_holding',
  'update_holding',
  'delete_holding',
  'create_account',
  'update_account',
  'archive_account',
  'delete_transaction',
  // tasks / goals / projects / career
  'create_task',
  'update_task',
  'set_task_done',
  'delete_task',
  'create_goal',
  'update_goal',
  'set_goal_status',
  'delete_goal',
  'create_project',
  'update_project',
  'set_project_status',
  'record_project_metric',
  'delete_project',
  'create_job',
  'update_job',
  'delete_job',
  'create_win',
  'delete_win',
  // memory
  'remember',
  'forget',
  // reminders / alerts
  'create_reminder',
  'cancel_reminder',
  'create_price_alert',
  'cancel_price_alert',
  // content pipeline
  'save_content_idea',
  'create_content_draft',
  'set_content_status',
  // google (create-only; there is no send)
  'create_calendar_event',
  'create_email_draft',
  // real-world side effects
  'spotify_play',
  'spotify_control',
  'pc_run_action',
])

/** Did this turn actually do something? */
export function ranActionTool(toolNames: readonly string[]): boolean {
  return toolNames.some((name) => ACTION_TOOLS.has(name))
}

// Past-tense confirmation verbs Jarvis uses when it (claims it) acted.
// Deliberately broad: a false positive costs one extra API round trip,
// while a miss delivers a lie about Jayden's money.
const VERBS =
  'logged|saved|added|created|updated|recorded|remembered|forgot|scheduled|cancelled|canceled|deleted|removed|drafted|set|booked'

const ACTION_CLAIM = new RegExp(
  [
    // Confirmation-style line openers: "Logged: S$81.00 …", "Saved.", "Done —"
    `^\\s*(?:${VERBS}|done)\\b`,
    // First-person claims anywhere: "I've logged it", "I just created …"
    `\\bI(?:'ve| have| just)? (?:${VERBS})\\b`,
    // Passive claims: "has been logged", "have been saved"
    `\\b(?:has|have) been (?:${VERBS})\\b`,
    // Batch claims: "all logged", "all captured", "all done"
    `\\ball (?:${VERBS}|captured|done)\\b`,
  ].join('|'),
  'im'
)

/** Does this reply text claim a completed action? */
export function claimsAction(text: string): boolean {
  return ACTION_CLAIM.test(text)
}

/**
 * Injected as a user message when a reply claimed an action but the turn ran
 * no action tool. The claiming reply is discarded, never sent to Jayden.
 *
 * Reads are called out explicitly because the second 14 Aug fabrication came
 * straight after real email reads — the model appears to treat "I found the
 * transactions" as "I recorded the transactions".
 */
export const ACTION_CLAIM_RETRY_PROMPT = [
  '[AUTOMATED INTEGRITY CHECK — Jayden has NOT seen your last reply and',
  'never will.] Your reply claimed a completed action, but you made no',
  'action tool call this turn, so NOTHING was written. Reading data',
  '(search_email, get_email, any get_/list_ tool) does NOT record anything —',
  'only a write tool such as log_transaction does.',
  '- If something should be recorded, make those tool calls NOW, one per',
  '  record, then confirm what each returned.',
  '- If you were only describing data you read or records that already',
  '  exist, rephrase so it is clear nothing new was written.',
  '- Do not repeat any write you already made in THIS turn.',
  'Reply again from scratch; your previous reply was discarded.',
].join('\n')

/**
 * Appended when even the retry claimed an action without running one —
 * the reply still goes out (it may legitimately describe existing records),
 * but never with an unqualified "done".
 */
export const UNVERIFIED_ACTION_WARNING =
  '⚠️ Heads-up: I could not verify that anything was actually written just ' +
  'now — if I claimed something was recorded, check it in the app before ' +
  'trusting it.'
