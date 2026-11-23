/**
 * Feedback rules engine (pure functions). Demo mode runs it in the browser against localStorage; Live mode enforces the
 * SAME rules inside Postgres (supabase/CONTRACT.md — same error codes, same order). Tests cover both sides.
 *
 * Model: two review pools (courses). Each student must complete REVIEWS_PER_STUDENT reviews, each for a different
 * classmate in their own course. Reviews are ASSIGNED by a fair plan (shared/allocation.ts); a project accepts at most
 * its slot capacity (4 standard, plus extra slots the plan opened). Browsing is never restricted.
 */
import { isReviewable, type CourseKey, type Student } from './roster.ts'
import { validateFeedback, type FeedbackInput, type RuleError, BASE_SLOTS, REVIEWS_PER_STUDENT, MAX_WRITES_PER_HOUR } from './rules.ts'
import { planAssignments, validateAssignments, type Plan } from './allocation.ts'

export interface CommentRecord {
  id: string
  course: CourseKey
  projectId: string
  reviewerId: string
  reviewerName: string
  pronouns: string | null
  enjoyed: string
  suggestion: string
  status: 'published' | 'removed'
  removedReason?: string
  /** An unassigned review the instructor allowed (allowExtra). */
  extra?: boolean
  createdAt: string
  updatedAt: string
}
export type AssignmentStatus = 'pending' | 'completed' | 'released'
export interface AssignmentRecord { course: CourseKey; reviewerId: string; projectId: string; status: AssignmentStatus; commentId?: string }

export interface EngineState {
  comments: CommentRecord[]
  assignments: AssignmentRecord[]
  /** Slot capacity per project (missing → BASE_SLOTS). */
  capacities: Record<string, number>
  writes: { studentId: string; at: string }[]
  open: boolean
  allowExtra: boolean
  /** Students the instructor released (not participating). */
  nonParticipants: string[]
  /** When each course's plan was last generated (null = never). */
  planned: Partial<Record<CourseKey, string>>
}
export interface EngineSettings { baseSlots: number; perStudent: number; minSecondsBetweenWrites: number; maxWritesPerHour: number }

export const DEFAULT_SETTINGS: EngineSettings = { baseSlots: BASE_SLOTS, perStudent: REVIEWS_PER_STUDENT, minSecondsBetweenWrites: 0, maxWritesPerHour: MAX_WRITES_PER_HOUR }
export const emptyState = (): EngineState => ({ comments: [], assignments: [], capacities: {}, writes: [], open: true, allowExtra: false, nonParticipants: [], planned: {} })

/** Older demo data (v1: comments only, no course) keeps working. */
export function upgradeState(raw: Partial<EngineState> | null | undefined, roster: Student[]): EngineState {
  const s = { ...emptyState(), ...(raw ?? {}) }
  const courseOf = (id: string) => roster.find((x) => x.id === id)?.course ?? '2241'
  s.comments = (s.comments ?? []).map((c) => ({ ...c, course: c.course ?? courseOf(c.projectId) }))
  return s as EngineState
}

export class RuleViolation extends Error {
  code: RuleError
  field?: string
  detail?: string
  constructor(code: RuleError, field?: string, detail?: string) { super(detail ? `${code}: ${detail}` : code); this.code = code; this.field = field; this.detail = detail }
}

const published = (s: EngineState) => s.comments.filter((c) => c.status === 'published')
export const receivedCount = (s: EngineState, projectId: string) => published(s).filter((c) => c.projectId === projectId).length
export const writtenCount = (s: EngineState, reviewerId: string) => published(s).filter((c) => c.reviewerId === reviewerId).length
export const capacityOf = (s: EngineState, projectId: string, cfg = DEFAULT_SETTINGS) => s.capacities[projectId] ?? cfg.baseSlots
const pendingFor = (s: EngineState, projectId: string, exceptReviewer?: string) =>
  s.assignments.filter((a) => a.projectId === projectId && a.status === 'pending' && a.reviewerId !== exceptReviewer).length
export const isParticipating = (s: EngineState, id: string) => !s.nonParticipants.includes(id)

function checkRate(s: EngineState, studentId: string, now: Date, cfg: EngineSettings) {
  const mine = s.writes.filter((w) => w.studentId === studentId).map((w) => new Date(w.at).getTime())
  const t = now.getTime()
  if (cfg.minSecondsBetweenWrites > 0 && mine.some((x) => t - x < cfg.minSecondsBetweenWrites * 1000)) throw new RuleViolation('rate_limited')
  if (mine.filter((x) => t - x < 3600_000).length >= cfg.maxWritesPerHour) throw new RuleViolation('rate_limited')
}

let counter = 0
const newId = (now: Date) => `cmt_${now.getTime().toString(36)}_${(counter++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Why this reviewer may (or may not) submit for this project right now. Same order as submit_comment in SQL. */
export function submitBlocker(s: EngineState, roster: Student[], reviewerId: string, projectId: string, cfg = DEFAULT_SETTINGS): RuleError | null {
  const reviewer = roster.find((x) => x.id === reviewerId)
  if (!reviewer) return 'not_signed_in'
  if (!s.open) return 'closed'
  const project = roster.find((x) => x.id === projectId)
  if (!project || !isReviewable(project)) return 'project_unavailable'
  if (projectId === reviewerId) return 'self_review'
  if (project.course !== reviewer.course) return 'wrong_course'
  if (s.comments.some((c) => c.projectId === projectId && c.reviewerId === reviewerId)) return 'already_reviewed'
  const assigned = s.assignments.some((a) => a.reviewerId === reviewerId && a.projectId === projectId && a.status === 'pending')
  if (!assigned) {
    const roomBeyondPending = receivedCount(s, projectId) + pendingFor(s, projectId, reviewerId) < capacityOf(s, projectId, cfg)
    if (!(s.allowExtra && writtenCount(s, reviewerId) >= cfg.perStudent && roomBeyondPending)) return receivedCount(s, projectId) >= capacityOf(s, projectId, cfg) ? 'project_full' : 'not_assigned'
  }
  if (receivedCount(s, projectId) >= capacityOf(s, projectId, cfg)) return 'project_full'
  return null
}

export function submitComment(s: EngineState, roster: Student[], reviewerId: string, projectId: string, input: FeedbackInput, now = new Date(), cfg = DEFAULT_SETTINGS): { state: EngineState; comment: CommentRecord } {
  const reviewer = roster.find((x) => x.id === reviewerId)
  if (!reviewer) throw new RuleViolation('not_signed_in')
  if (!s.open) throw new RuleViolation('closed')
  const project = roster.find((x) => x.id === projectId)
  if (!project || !isReviewable(project)) throw new RuleViolation('project_unavailable')
  if (projectId === reviewerId) throw new RuleViolation('self_review')
  if (project.course !== reviewer.course) throw new RuleViolation('wrong_course')
  const v = validateFeedback(input)
  if (!v.ok) throw new RuleViolation(v.error, v.field)
  checkRate(s, reviewerId, now, cfg)
  const block = submitBlocker(s, roster, reviewerId, projectId, cfg)
  if (block) throw new RuleViolation(block)
  const assignment = s.assignments.find((a) => a.reviewerId === reviewerId && a.projectId === projectId && a.status === 'pending')
  const at = now.toISOString()
  const comment: CommentRecord = {
    id: newId(now), course: project.course, projectId, reviewerId, reviewerName: reviewer.fullName,
    pronouns: v.value.pronouns || null, enjoyed: v.value.enjoyed, suggestion: v.value.suggestion,
    status: 'published', extra: !assignment || undefined, createdAt: at, updatedAt: at,
  }
  return {
    comment,
    state: {
      ...s,
      comments: [...s.comments, comment],
      assignments: s.assignments.map((a) => (a === assignment ? { ...a, status: 'completed', commentId: comment.id } : a)),
      writes: [...s.writes, { studentId: reviewerId, at }],
    },
  }
}

export function updateComment(s: EngineState, editorId: string, commentId: string, input: FeedbackInput, now = new Date(), cfg = DEFAULT_SETTINGS): { state: EngineState; comment: CommentRecord } {
  const c = s.comments.find((x) => x.id === commentId && x.status === 'published')
  if (!c) throw new RuleViolation('not_found')
  if (c.reviewerId !== editorId) throw new RuleViolation('not_author')
  if (!s.open) throw new RuleViolation('closed')
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

export interface QuestItem { projectId: string; status: 'pending' | 'completed' | 'extra'; commentId: string | null; published: number; capacity: number }

/** The reviewer's Feedback Quest: assigned projects (pending and completed) plus any extra reviews. */
export function quest(s: EngineState, reviewerId: string, cfg = DEFAULT_SETTINGS): QuestItem[] {
  const items: QuestItem[] = s.assignments
    .filter((a) => a.reviewerId === reviewerId && a.status !== 'released')
    .map((a) => ({ projectId: a.projectId, status: a.status as 'pending' | 'completed', commentId: a.commentId ?? null, published: receivedCount(s, a.projectId), capacity: capacityOf(s, a.projectId, cfg) }))
  for (const c of published(s)) if (c.reviewerId === reviewerId && !items.some((i) => i.projectId === c.projectId)) {
    items.push({ projectId: c.projectId, status: 'extra', commentId: c.id, published: receivedCount(s, c.projectId), capacity: capacityOf(s, c.projectId, cfg) })
  }
  const rank = (i: QuestItem) => (i.status === 'pending' ? 1 : 0)
  return items.sort((a, b) => rank(a) - rank(b) || fnv(reviewerId + a.projectId) - fnv(reviewerId + b.projectId))
}

/** "Find My Next Review": the pending assignment whose project is least full (then a stable per-student tiebreak). */
export function nextReview(s: EngineState, reviewerId: string, cfg = DEFAULT_SETTINGS): string | null {
  const pending = quest(s, reviewerId, cfg).filter((q) => q.status === 'pending')
  pending.sort((a, b) => a.published / Math.max(1, a.capacity) - b.published / Math.max(1, b.capacity) || fnv(reviewerId + a.projectId) - fnv(reviewerId + b.projectId))
  return pending[0]?.projectId ?? null
}

/** Plan a course with shared/allocation.ts from the current state. mode "replace" keeps only completed reviews. */
export function planCourse(s: EngineState, roster: Student[], course: CourseKey, mode: 'replace' | 'rebalance', cfg = DEFAULT_SETTINGS, seed = `fic-${course}`): Plan {
  const pool = roster.filter((x) => x.course === course)
  const ids = new Set(pool.map((x) => x.id))
  return planAssignments({
    reviewers: pool.filter((x) => isParticipating(s, x.id) && !x.hidden).map((x) => x.id),
    projects: pool.filter((x) => isReviewable(x)).map((x) => x.id),
    perReviewer: cfg.perStudent, baseSlots: cfg.baseSlots, keepPending: mode === 'rebalance', seed,
    existing: [
      ...published(s).filter((c) => ids.has(c.reviewerId) && ids.has(c.projectId)).map((c) => ({ reviewerId: c.reviewerId, projectId: c.projectId, status: 'completed' as const })),
      ...s.assignments.filter((a) => a.course === course && a.status === 'pending').map((a) => ({ reviewerId: a.reviewerId, projectId: a.projectId, status: 'pending' as const })),
    ],
  })
}

/**
 * Apply a plan's pending assignments + capacities for one course (the same checks admin_apply_assignments makes on the
 * server): completed work is kept, dropped pending rows become released.
 */
export function applyPlan(s: EngineState, roster: Student[], course: CourseKey, capacities: Record<string, number>, pendingEdges: { reviewerId: string; projectId: string }[], now = new Date(), cfg = DEFAULT_SETTINGS): EngineState {
  const pool = roster.filter((x) => x.course === course)
  const reviewers = pool.filter((x) => isParticipating(s, x.id) && !x.hidden).map((x) => x.id)
  const projects = pool.filter((x) => isReviewable(x)).map((x) => x.id)
  const commented = new Set(s.comments.map((c) => `${c.reviewerId}>${c.projectId}`))
  const fullCaps: Record<string, number> = {}
  for (const p of projects) fullCaps[p] = capacities[p] ?? capacityOf(s, p, cfg)
  for (const [p, n] of Object.entries(capacities)) {
    if (!projects.includes(p)) throw new RuleViolation('invalid_plan', undefined, `${p} is not an eligible project in ${course}`)
    if (n < cfg.baseSlots || n < receivedCount(s, p)) throw new RuleViolation('invalid_plan', undefined, `capacity for ${p} is below the minimum`)
  }
  for (const e of pendingEdges) if (commented.has(`${e.reviewerId}>${e.projectId}`)) throw new RuleViolation('invalid_plan', undefined, `${e.reviewerId} already reviewed ${e.projectId}`)
  const problems = validateAssignments(
    [...published(s).filter((c) => c.course === course && !c.extra).map((c) => ({ reviewerId: c.reviewerId, projectId: c.projectId })).filter((e) => reviewers.includes(e.reviewerId) && projects.includes(e.projectId)), ...pendingEdges],
    { reviewers, projects, perReviewer: cfg.perStudent, capacities: fullCaps })
  if (problems.length) throw new RuleViolation('invalid_plan', undefined, problems.slice(0, 3).join('; '))
  for (const p of projects) {
    const total = receivedCount(s, p) + pendingEdges.filter((e) => e.projectId === p).length
    if (total > fullCaps[p]) throw new RuleViolation('invalid_plan', undefined, `${p} over capacity`)
  }
  // One row per (reviewer, project): completed rows are untouched; wanted rows become pending; other pending rows of
  // this course are released; wanted pairs without a row are added.
  const key = (a: { reviewerId: string; projectId: string }) => `${a.reviewerId}>${a.projectId}`
  const want = new Set(pendingEdges.map(key))
  const seen = new Set<string>()
  const next: AssignmentRecord[] = s.assignments.map((a) => {
    if (a.course !== course || a.status === 'completed') return a
    seen.add(key(a))
    return want.has(key(a)) ? { ...a, status: 'pending' } : { ...a, status: 'released' }
  })
  for (const e of pendingEdges) if (!seen.has(key(e))) next.push({ course, reviewerId: e.reviewerId, projectId: e.projectId, status: 'pending' })
  return {
    ...s,
    assignments: next,
    capacities: { ...s.capacities, ...capacities },
    planned: { ...s.planned, [course]: now.toISOString() },
  }
}

/** Plan + apply in one go (Demo backend and tests). */
export function generateAssignments(s: EngineState, roster: Student[], course: CourseKey, mode: 'replace' | 'rebalance', now = new Date(), cfg = DEFAULT_SETTINGS): { state: EngineState; plan: Plan } {
  const plan = planCourse(s, roster, course, mode, cfg)
  const pending = plan.assignments.filter((a) => a.status === 'pending')
  return { plan, state: applyPlan(s, roster, course, plan.capacities, pending, now, cfg) }
}

export function setParticipating(s: EngineState, studentId: string, participating: boolean): EngineState {
  const non = new Set(s.nonParticipants)
  if (participating) non.delete(studentId); else non.add(studentId)
  return {
    ...s, nonParticipants: [...non],
    assignments: participating ? s.assignments : s.assignments.map((a) => (a.reviewerId === studentId && a.status === 'pending' ? { ...a, status: 'released' } : a)),
  }
}

export function removeComment(s: EngineState, commentId: string, reason: string): EngineState {
  return {
    ...s,
    comments: s.comments.map((c) => (c.id === commentId ? { ...c, status: 'removed', removedReason: reason } : c)),
    assignments: s.assignments.map((a) => (a.commentId === commentId ? { ...a, status: 'released' } : a)),
  }
}
export function restoreComment(s: EngineState, commentId: string, cfg = DEFAULT_SETTINGS): EngineState {
  const c = s.comments.find((x) => x.id === commentId)
  if (!c) throw new RuleViolation('not_found')
  if (c.status === 'published') return s
  if (receivedCount(s, c.projectId) >= capacityOf(s, c.projectId, cfg)) throw new RuleViolation('project_full')
  return {
    ...s,
    comments: s.comments.map((x) => (x.id === commentId ? { ...x, status: 'published', removedReason: undefined } : x)),
    assignments: s.assignments.map((a) => (a.commentId === commentId ? { ...a, status: 'completed' } : a)),
  }
}

/** Per-course completion report. Never assumes the target is met — counts what is actually there. */
export function completion(s: EngineState, roster: Student[], course: CourseKey, cfg = DEFAULT_SETTINGS) {
  const pool = roster.filter((x) => x.course === course)
  const eligible = pool.filter((x) => isReviewable(x))
  const participants = pool.filter((x) => isParticipating(s, x.id) && !x.hidden)
  const rows = pool.map((st) => ({
    student: st, eligible: isReviewable(st), participating: isParticipating(s, st.id),
    received: receivedCount(s, st.id), written: writtenCount(s, st.id), capacity: isReviewable(st) ? capacityOf(s, st.id, cfg) : 0,
    pending: s.assignments.filter((a) => a.reviewerId === st.id && a.status === 'pending').length,
    assignedTo: s.assignments.filter((a) => a.projectId === st.id && a.status !== 'released').length,
  }))
  const demand = participants.length * cfg.perStudent
  const capacity = eligible.reduce((a, p) => a + capacityOf(s, p.id, cfg), 0)
  const standard = eligible.length * cfg.baseSlots
  return {
    course, rows, demand, capacity, standardCapacity: standard,
    eligibleProjects: eligible.length,
    totalPublished: published(s).filter((c) => c.course === course).length,
    assignedTotal: s.assignments.filter((a) => a.course === course && a.status !== 'released').length,
    pendingTotal: s.assignments.filter((a) => a.course === course && a.status === 'pending').length,
    extraSlots: eligible.reduce((a, p) => a + Math.max(0, capacityOf(s, p.id, cfg) - cfg.baseSlots), 0),
    projectsWithExtra: eligible.filter((p) => capacityOf(s, p.id, cfg) > cfg.baseSlots).length,
    projectsWithRoom: eligible.filter((p) => receivedCount(s, p.id) < capacityOf(s, p.id, cfg)).length,
    reviewersComplete: rows.filter((r) => r.participating && r.written >= cfg.perStudent).length,
    participants: participants.length,
    planned: !!s.planned[course],
    /** Reviews that cannot happen even with full participation (0 once extra slots cover demand). */
    structuralShortfall: Math.max(0, demand - Math.max(capacity, standard)),
  }
}
