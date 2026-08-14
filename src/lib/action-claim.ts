/**
 * Fabricated-action detection for the Jarvis tool loop.
 *
 * DeepSeek sometimes replies "Logged: …" having made ZERO tool calls — the
 * prompt rule against it (`ad29bb4`) did not hold (recurred 14 Aug: "Logged:
 * S$81.00 Food" with tools_called []). This is the code-level escalation: the
 * agent loop calls `claimsAction` on any reply produced without a single tool
 * call in the turn, and a match triggers one corrective retry instead of
 * delivering the lie.
 *
 * Import-free on purpose (repo convention: `node --test` can't resolve `@/`
 * aliases, tested lib modules are self-contained).
 */

// Past-tense confirmation verbs Jarvis uses when it (claims it) wrote a
// record. Deliberately broad: a false positive only costs one extra API
// round trip, while a miss delivers a lie about Jayden's money.
const VERBS =
  'logged|saved|added|created|updated|recorded|remembered|scheduled|cancelled|canceled|deleted|removed|drafted|set'

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

/** Does this reply text claim a completed write action? */
export function claimsAction(text: string): boolean {
  return ACTION_CLAIM.test(text)
}

/**
 * Injected as a user message when a reply claimed an action but the turn made
 * zero tool calls. The claiming reply is discarded, never sent to Jayden.
 */
export const ACTION_CLAIM_RETRY_PROMPT = [
  '[AUTOMATED INTEGRITY CHECK — Jayden has NOT seen your last reply and',
  'never will.] Your reply claimed a completed action but you made ZERO tool',
  'calls this turn, so NOTHING was recorded. Tool calls are the only way you',
  'can act.',
  '- If something should be recorded, make the tool calls NOW, then confirm',
  '  what each one returned.',
  '- If you were only describing records that already exist, rephrase so it',
  '  is clear nothing new was written.',
  'Reply again from scratch; your previous reply was discarded.',
].join('\n')

/**
 * Appended when even the retry claimed an action without any tool call —
 * the reply still goes out (it may legitimately describe existing records),
 * but never with an unqualified "done".
 */
export const UNVERIFIED_ACTION_WARNING =
  '⚠️ Heads-up: I could not verify that any action actually ran just now — ' +
  'if I claimed something was recorded, double-check it in the app.'
