/**
 * DEMO MODE — everything lives in this browser's localStorage. Nothing is shared with anyone.
 * The same rules engine (shared/engine.ts) that mirrors the Live database enforces assignments, capacities, course
 * boundaries and self-review prevention, so the instructor can rehearse the whole activity.
 */
import { isReviewable, type Student } from '../../shared/roster.ts'
import {
  submitComment, updateComment, removeComment, restoreComment, writtenCount, receivedCount, capacityOf, quest, nextReview,
  generateAssignments, applyPlan, setParticipating, isParticipating, upgradeState, RuleViolation, DEFAULT_SETTINGS,
  type EngineState, type CommentRecord,
} from '../../shared/engine.ts'
import { COURSE_KEYS } from '../../shared/roster.ts'
import { BackendError, type Backend, type CommentView, type Me } from './backend.ts'

export const DEMO_KEY = 'fic.demo.state.v1'
export const DEMO_ME = 'fic.demo.me.v1'

function save(s: EngineState) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)) } catch { throw new BackendError('unknown', 'This browser is blocking storage, so demo comments cannot be saved.') }
}
const view = ({ status: _s, removedReason: _r, extra: _e, course: _c, ...c }: CommentRecord): CommentView => c
const wrap = <T,>(fn: () => T): T => {
  try { return fn() } catch (e) { if (e instanceof RuleViolation) throw new BackendError(e.code, e.detail ? `${e.message}` : undefined, e.field); throw e }
}

export function createDemoBackend(getRoster: () => Student[]): Backend {
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  /** Load state; the first time (or for a course never planned) build the fair assignment plan automatically. */
  const load = (): EngineState => {
    let s: EngineState
    try { s = upgradeState(JSON.parse(localStorage.getItem(DEMO_KEY) ?? 'null'), getRoster()) } catch { s = upgradeState(null, getRoster()) }
    let changed = false
    for (const c of COURSE_KEYS) if (!s.planned[c]) { s = generateAssignments(s, getRoster(), c, 'rebalance').state; changed = true }
    if (changed) { try { save(s) } catch { /* storage blocked: still usable for this page view */ } }
    return s
  }
  const meId = () => { try { return localStorage.getItem(DEMO_ME) } catch { return null } }
  const meOf = (id: string | null): Me | null => {
    const st = getRoster().find((s) => s.id === id)
    if (!st || st.hidden) return null
    const s = load()
    return { studentId: st.id, fullName: st.fullName, firstName: st.firstName, lastName: st.lastName, course: st.course, sectionCode: st.sectionCode, completed: writtenCount(s, st.id), required: DEFAULT_SETTINGS.perStudent, participating: isParticipating(s, st.id) }
  }
  const requireMe = () => { const id = meId(); if (!id || !meOf(id)) throw new BackendError('not_signed_in'); return id }
  const mutate = (fn: (s: EngineState) => EngineState) => { save(wrap(() => fn(load()))); emit() }

  if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === DEMO_KEY || e.key === DEMO_ME) emit() })

  return {
    mode: 'demo',
    async me() { return meOf(meId()) },
    async signIn({ studentId }) {
      const m = meOf(studentId ?? null)
      if (!m) throw new BackendError('not_found')
      localStorage.setItem(DEMO_ME, m.studentId); emit(); return m
    },
    async signOut() { localStorage.removeItem(DEMO_ME); emit() },
    async status() {
      const s = load(); const projects: Record<string, { published: number; capacity: number }> = {}
      for (const st of getRoster()) if (isReviewable(st)) projects[st.id] = { published: receivedCount(s, st.id), capacity: capacityOf(s, st.id) }
      return { open: s.open, allowExtra: s.allowExtra, projects }
    },
    async comments(projectId) {
      return load().comments.filter((c) => c.projectId === projectId && c.status === 'published').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(view)
    },
    async myReviews() {
      const id = meId(); if (!id) return []
      return load().comments.filter((c) => c.reviewerId === id && c.status === 'published').map(view)
    },
    async quest() { const id = meId(); return id ? quest(load(), id) : [] },
    async questOf(studentId) { return getRoster().some((s) => s.id === studentId && !s.hidden) ? quest(load(), studentId) : [] },
    async nextReview() { return nextReview(load(), requireMe()) },
    async submit(projectId, input, reviewerId) {
      if (!meOf(reviewerId)) throw new BackendError('unknown_reviewer')
      const r = wrap(() => submitComment(load(), getRoster(), reviewerId, projectId, input, new Date(), DEFAULT_SETTINGS))
      save(r.state)
      try { localStorage.setItem(DEMO_ME, reviewerId) } catch { /* storage blocked */ }
      emit(); return view(r.comment)
    },
    async update(commentId, input) {
      const id = requireMe()
      const r = wrap(() => updateComment(load(), id, commentId, input, new Date(), DEFAULT_SETTINGS))
      save(r.state); emit(); return view(r.comment)
    },
    async instructorStatus() { return { signedIn: true, isInstructor: true, email: 'demo' } },
    canEdit(c) { return c.reviewerId === meId() },
    async instructorSignIn() { return 'Demo mode has no instructor sign-in.' },
    async instructorChangePassword() {},
    async instructorSignOut() {},
    async adminOverview() {
      const s = load()
      return {
        open: s.open, allowExtra: s.allowExtra, baseSlots: DEFAULT_SETTINGS.baseSlots, perStudent: DEFAULT_SETTINGS.perStudent,
        students: getRoster().map((st) => ({ id: st.id, participating: isParticipating(s, st.id), capacity: isReviewable(st) ? capacityOf(s, st.id) : 0, published: receivedCount(s, st.id), written: writtenCount(s, st.id) })),
        assignments: s.assignments.map((a) => ({ course: a.course, reviewerId: a.reviewerId, projectId: a.projectId, status: a.status })),
        comments: s.comments.map((c) => ({ ...view(c), course: c.course, status: c.status, removedReason: c.removedReason ?? null, extra: !!c.extra })),
      }
    },
    async applyAssignments(course, capacities, pending) { mutate((s) => applyPlan(s, getRoster(), course, capacities, pending)) },
    async setParticipating(id, p) { mutate((s) => setParticipating(s, id, p)) },
    async removeComment(id, reason) { mutate((s) => removeComment(s, id, reason)) },
    async restoreComment(id) { mutate((s) => restoreComment(s, id)) },
    async setOpen(open) { mutate((s) => ({ ...s, open })) },
    async setAllowExtra(allowExtra) { mutate((s) => ({ ...s, allowExtra })) },
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb) },
  }
}

/** Instructor "Reset demo data": wipes demo comments, assignments and the demo sign-in in this browser only. */
export function resetDemoData() {
  for (const k of [DEMO_KEY, DEMO_ME]) { try { localStorage.removeItem(k) } catch { /* ignore */ } }
}
