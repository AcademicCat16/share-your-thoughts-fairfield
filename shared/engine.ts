/**
 * Feedback rules engine (pure functions). Demo mode runs it in the browser against localStorage.
 * Live mode enforces the same rules in Postgres (see supabase/CONTRACT.md); tests cover both.
 */
import type { Student } from './roster.ts'
import { validateFeedback, type FeedbackInput, type RuleError, MAX_COMMENTS_PER_PROJECT, MAX_REVIEWS_PER_REVIEWER, RESERVATION_MINUTES, MAX_WRITES_PER_HOUR } from './rules.ts'

export interface CommentRecord {
  id: string
  projectId: string
  reviewerId: string
  reviewerName: string
  pronouns: string | null
  enjoyed: string
  suggestion: string
  status: 'published' | 'removed'
  removedReason?: string
  createdAt: string
  updatedAt: string
}
export interface Reservation { reviewerId: string; projectId: string; expiresAt: string }
export interface EngineState { comments: CommentRecord[]; reservations: Reservation[]; writes: { studentId: string; at: string }[]; open: boolean }
export interface EngineSettings { maxPerProject: number; maxPerReviewer: number; reservationMinutes: number; minSecondsBetweenWrites: number; maxWritesPerHour: number }

export const DEFAULT_SETTINGS: EngineSettings = {
  maxPerProject: MAX_COMMENTS_PER_PROJECT, maxPerReviewer: MAX_REVIEWS_PER_REVIEWER, reservationMinutes: RESERVATION_MINUTES,
  minSecondsBetweenWrites: 0, maxWritesPerHour: MAX_WRITES_PER_HOUR,
}
export const emptyState = (): EngineState => ({ comments: [], reservations: [], writes: [], open: true })

export class RuleViolation extends Error {
  code: RuleError
  field?: string
  constructor(code: RuleError, field?: string) { super(code); this.code = code; this.field = field }
}

const published = (s: EngineState) => s.comments.filter((c) => c.status === 'published')
export const receivedCount = (s: EngineState, projectId: string) => published(s).filter((c) => c.projectId === projectId).length
export const writtenCount = (s: EngineState, reviewerId: string) => published(s).filter((c) => c.reviewerId === reviewerId).length
export const isEligibleProject = (p: Student | undefined): p is Student => !!p && p.urlStatus === 'valid' && !!p.url

function checkRate(s: EngineState, studentId: string, now: Date, cfg: EngineSettings) {
  const mine = s.writes.filter((w) => w.studentId === studentId).map((w) => new Date(w.at).getTime())
  const t = now.getTime()
  if (cfg.minSecondsBetweenWrites > 0 && mine.some((x) => t - x < cfg.minSecondsBetweenWrites * 1000)) throw new RuleViolation('rate_limited')
  if (mine.filter((x) => t - x < 3600_000).length >= cfg.maxWritesPerHour) throw new RuleViolation('rate_limited')
}

let counter = 0
const newId = (now: Date) => `cmt_${now.getTime().toString(36)}_${(counter++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export function submitComment(s: EngineState, roster: Student[], reviewerId: string, projectId: string, input: FeedbackInput, now = new Date(), cfg = DEFAULT_SETTINGS): { state: EngineState; comment: CommentRecord } {
  const reviewer = roster.find((x) => x.id === reviewerId)
  if (!reviewer) throw new RuleViolation('not_signed_in')
  if (!s.open) throw new RuleViolation('closed')
  const project = roster.find((x) => x.id === projectId)
  if (!isEligibleProject(project)) throw new RuleViolation('project_unavailable')
  if (projectId === reviewerId) throw new RuleViolation('self_review')
  const v = validateFeedback(input)
  if (!v.ok) throw new RuleViolation(v.error, v.field)
  checkRate(s, reviewerId, now, cfg)
  if (s.comments.some((c) => c.projectId === projectId && c.reviewerId === reviewerId)) throw new RuleViolation('already_reviewed')
  if (writtenCount(s, reviewerId) >= cfg.maxPerReviewer) throw new RuleViolation('reviewer_limit')
  if (receivedCount(s, projectId) >= cfg.maxPerProject) throw new RuleViolation('project_full')
  const at = now.toISOString()
  const comment: CommentRecord = {
    id: newId(now), projectId, reviewerId, reviewerName: reviewer.fullName,
    pronouns: v.value.pronouns || null, enjoyed: v.value.enjoyed, suggestion: v.value.suggestion,
    status: 'published', createdAt: at, updatedAt: at,
  }
  return {
    comment,
    state: { ...s, comments: [...s.comments, comment], reservations: s.reservations.filter((r) => r.reviewerId !== reviewerId), writes: [...s.writes, { studentId: reviewerId, at }] },
  }
}

export function updateComment(s: EngineState, editorId: string, commentId: string, input: FeedbackInput, now = new Date(), cfg = DEFAULT_SETTINGS): { state: EngineState; comment: CommentRecord } {
  const c = s.comments.find((x) => x.id === commentId && x.status === 'published')
  if (!c) throw new RuleViolation('not_found')
  if (c.reviewerId !== editorId) throw new RuleViolation('not_author')
  const v = validateFeedback(input)
  if (!v.ok) throw new RuleViolation(v.error, v.field)
  checkRate(s, editorId, now, cfg)
  const at = now.toISOString()
  // Identity fields (projectId, reviewerId, reviewerName, createdAt) are copied, never taken from input.
  const comment: CommentRecord = { ...c, pronouns: v.value.pronouns || null, enjoyed: v.value.enjoyed, suggestion: v.value.suggestion, updatedAt: at }
  return { comment, state: { ...s, comments: s.comments.map((x) => (x.id === c.id ? comment : x)), writes: [...s.writes, { studentId: editorId, at }] } }
}

function fnv(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0
  return h
}

/** Projects this reviewer may still review, with the score used for fair recommendation. */
export function eligibleFor(s: EngineState, roster: Student[], reviewerId: string, now = new Date(), cfg = DEFAULT_SETTINGS) {
  const reviewed = new Set(s.comments.filter((c) => c.reviewerId === reviewerId).map((c) => c.projectId))
  const live = s.reservations.filter((r) => new Date(r.expiresAt) > now && r.reviewerId !== reviewerId)
  return roster
    .filter((p) => isEligibleProject(p) && p.id !== reviewerId && !reviewed.has(p.id) && receivedCount(s, p.id) < cfg.maxPerProject)
    .map((p) => ({ project: p, published: receivedCount(s, p.id), reserved: live.filter((r) => r.projectId === p.id).length }))
}

/**
 * "Find a World That Needs Feedback": fewest (published + others' active reservations) first; ties go to the
 * section that is behind on average; remaining ties are broken by a stable per-reviewer hash, so two students
 * asking at the same moment are not both sent to the same "first" desk. Records a soft reservation.
 */
export function recommend(s: EngineState, roster: Student[], reviewerId: string, now = new Date(), cfg = DEFAULT_SETTINGS): { state: EngineState; projectId: string | null } {
  if (!roster.some((x) => x.id === reviewerId)) throw new RuleViolation('not_signed_in')
  if (writtenCount(s, reviewerId) >= cfg.maxPerReviewer) throw new RuleViolation('reviewer_limit')
  const options = eligibleFor(s, roster, reviewerId, now, cfg)
  if (!options.length) return { state: s, projectId: null }
  const mean = (sec: string) => { const xs = options.filter((o) => o.project.section === sec); return xs.length ? xs.reduce((a, o) => a + o.published, 0) / xs.length : Infinity }
  const secMean: Record<string, number> = { '01': mean('01'), '02': mean('02') }
  options.sort((a, b) =>
    a.published + a.reserved - (b.published + b.reserved) ||
    secMean[a.project.section] - secMean[b.project.section] ||
    fnv(reviewerId + a.project.id) - fnv(reviewerId + b.project.id))
  const pick = options[0].project.id
  const expiresAt = new Date(now.getTime() + cfg.reservationMinutes * 60_000).toISOString()
  return { projectId: pick, state: { ...s, reservations: [...s.reservations.filter((r) => r.reviewerId !== reviewerId && new Date(r.expiresAt) > now), { reviewerId, projectId: pick, expiresAt }] } }
}

export function removeComment(s: EngineState, commentId: string, reason: string): EngineState {
  return { ...s, comments: s.comments.map((c) => (c.id === commentId ? { ...c, status: 'removed', removedReason: reason } : c)) }
}
export function restoreComment(s: EngineState, commentId: string, cfg = DEFAULT_SETTINGS): EngineState {
  const c = s.comments.find((x) => x.id === commentId)
  if (!c) throw new RuleViolation('not_found')
  if (c.status === 'published') return s
  if (receivedCount(s, c.projectId) >= cfg.maxPerProject) throw new RuleViolation('project_full')
  return { ...s, comments: s.comments.map((x) => (x.id === commentId ? { ...x, status: 'published', removedReason: undefined } : x)) }
}

/** Completion report: never assumes 232 — counts what is actually there and explains the shortfall. */
export function completion(s: EngineState, roster: Student[], cfg = DEFAULT_SETTINGS, target = 4) {
  const eligible = roster.filter(isEligibleProject)
  const rows = roster.map((st) => ({ student: st, received: receivedCount(s, st.id), written: writtenCount(s, st.id), eligible: isEligibleProject(st) }))
  const totalPublished = published(s).length
  const capacity = eligible.length * cfg.maxPerProject
  const demand = roster.length * target
  return {
    rows,
    totalPublished,
    eligibleProjects: eligible.length,
    capacity,
    demand,
    targetTotal: roster.length * target,
    projectsUnder: rows.filter((r) => r.eligible && r.received < target),
    projectsComplete: rows.filter((r) => r.eligible && r.received >= target).length,
    reviewersUnder: rows.filter((r) => r.written < target),
    reviewersComplete: rows.filter((r) => r.written >= target).length,
    /** Reviews that cannot happen even if everyone participates, because there are not enough open desks. */
    structuralShortfall: Math.max(0, demand - capacity),
  }
}
