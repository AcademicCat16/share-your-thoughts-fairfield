/**
 * The feedback rules. Demo mode enforces them in src/lib/demoBackend.ts using this file;
 * Live mode enforces the SAME rules inside Postgres (supabase/migrations/*.sql). Keep both in sync —
 * tests/unit/rules.test.ts and tests/db/*.test.ts check each side.
 */
export const MAX_COMMENTS_PER_PROJECT = 4
/** Target reviews per reviewer; also the cap, so scarce slots are shared fairly (see report: capacity < 232). */
export const MAX_REVIEWS_PER_REVIEWER = 4
export const TARGET_REVIEWS_PER_STUDENT = 4
export const TEXT_MIN = 15
export const TEXT_MAX = 800
export const PRONOUNS_MAX = 40
/** Soft reservation made by "Find a World That Needs Feedback" (minutes). Steers others away; never blocks a submission. */
export const RESERVATION_MINUTES = 20
/** Rate limits (enforced server-side in Live mode). */
export const MIN_SECONDS_BETWEEN_WRITES = 15
export const MAX_WRITES_PER_HOUR = 20

export type RuleError =
  | 'not_signed_in' | 'self_review' | 'project_full' | 'already_reviewed' | 'reviewer_limit'
  | 'project_unavailable' | 'invalid_text' | 'inappropriate' | 'rate_limited' | 'not_author'
  | 'closed' | 'bad_code' | 'locked' | 'not_instructor' | 'not_found'

export const RULE_MESSAGES: Record<RuleError, string> = {
  not_signed_in: 'Please sign in with your access code first.',
  self_review: "That's your own world! You can't review your own project.",
  project_full: 'This desk is full of thoughtful feedback! Thank you for helping your classmates.',
  already_reviewed: "You've already left your thoughts here. You can edit your comment instead.",
  reviewer_limit: `You've written ${MAX_REVIEWS_PER_REVIEWER} reviews — thank you! That's the goal reached.`,
  project_unavailable: "This project hasn't arrived yet!",
  invalid_text: `Each answer needs ${TEXT_MIN}–${TEXT_MAX} characters.`,
  inappropriate: 'Please keep feedback kind and respectful — try rewording that answer.',
  rate_limited: 'Whoa, speedy! Please wait a few seconds before sending again.',
  not_author: 'Only the person who wrote this comment can edit it.',
  closed: 'Feedback is closed right now.',
  bad_code: "That access code didn't match. Check it and try again.",
  locked: 'Too many tries. Please wait 15 minutes, or ask your instructor.',
  not_instructor: 'Instructor sign-in required.',
  not_found: 'That item could not be found.',
}

/**
 * A short, deliberately conservative list of words that are never appropriate in peer feedback.
 * Mirrored in SQL (public.blocked_terms). It is a speed bump, not moderation: the instructor can remove anything.
 */
export const BLOCKED_TERMS = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'cunt', 'slut', 'whore', 'retard', 'fag', 'nigger', 'nigga',
  'kill yourself', 'kys', 'stupid', 'idiot', 'dumb', 'loser', 'ugly', 'sucks',
]

export function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export function findBlockedTerm(s: string): string | null {
  const t = ` ${s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ')} `
  for (const w of BLOCKED_TERMS) if (t.includes(` ${w} `) || t.includes(` ${w}s `) || t.includes(` ${w}ed `)) return w
  return null
}

export interface FeedbackInput { pronouns: string; enjoyed: string; suggestion: string }

export function validateFeedback(f: FeedbackInput): { ok: true; value: FeedbackInput } | { ok: false; error: RuleError; field?: keyof FeedbackInput } {
  const value = { pronouns: normalizeText(f.pronouns).slice(0, PRONOUNS_MAX + 1), enjoyed: normalizeText(f.enjoyed), suggestion: normalizeText(f.suggestion) }
  if (value.pronouns.length > PRONOUNS_MAX) return { ok: false, error: 'invalid_text', field: 'pronouns' }
  for (const k of ['enjoyed', 'suggestion'] as const) {
    if (value[k].length < TEXT_MIN || value[k].length > TEXT_MAX) return { ok: false, error: 'invalid_text', field: k }
    if (findBlockedTerm(value[k])) return { ok: false, error: 'inappropriate', field: k }
  }
  if (findBlockedTerm(value.pronouns)) return { ok: false, error: 'inappropriate', field: 'pronouns' }
  return { ok: true, value }
}
