/**
 * DEMO MODE — everything lives in this browser's localStorage. Nothing is shared with anyone.
 * The same rules engine (shared/engine.ts) that mirrors the Live database enforces the limits,
 * so the instructor can test four-comment capacity, self-review prevention, etc.
 */
import type { Student } from '../../shared/roster.ts'
import { emptyState, submitComment, updateComment, recommend, removeComment, restoreComment, writtenCount, receivedCount, RuleViolation, DEFAULT_SETTINGS, type EngineState, type CommentRecord } from '../../shared/engine.ts'
import { BackendError, type Backend, type CommentView, type Me } from './backend.ts'

export const DEMO_KEY = 'fic.demo.state.v1'
export const DEMO_ME = 'fic.demo.me.v1'

function load(): EngineState {
  try { const raw = localStorage.getItem(DEMO_KEY); if (raw) return { ...emptyState(), ...JSON.parse(raw) } } catch { /* storage blocked or corrupt */ }
  return emptyState()
}
function save(s: EngineState) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)) } catch { throw new BackendError('unknown', 'This browser is blocking storage, so demo comments cannot be saved.') }
}
const view = ({ status: _s, removedReason: _r, ...c }: CommentRecord): CommentView => c
const wrap = <T,>(fn: () => T): T => {
  try { return fn() } catch (e) { if (e instanceof RuleViolation) throw new BackendError(e.code, undefined, e.field); throw e }
}

export function createDemoBackend(getRoster: () => Student[]): Backend {
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  const meId = () => { try { return localStorage.getItem(DEMO_ME) } catch { return null } }
  const meOf = (id: string | null): Me | null => {
    const st = getRoster().find((s) => s.id === id)
    return st ? { studentId: st.id, fullName: st.fullName, section: st.sectionCode, reviewsWritten: writtenCount(load(), st.id) } : null
  }
  const requireMe = () => { const id = meId(); if (!id || !meOf(id)) throw new BackendError('not_signed_in'); return id }

  if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === DEMO_KEY || e.key === DEMO_ME) emit() })

  return {
    mode: 'demo',
    async me() { return meOf(meId()) },
    async signIn(studentId) {
      const m = meOf(studentId)
      if (!m) throw new BackendError('not_found')
      localStorage.setItem(DEMO_ME, studentId); emit(); return m
    },
    async signOut() { localStorage.removeItem(DEMO_ME); emit() },
    async counts() {
      const s = load(); const out: Record<string, number> = {}
      for (const st of getRoster()) out[st.id] = receivedCount(s, st.id)
      return out
    },
    async comments(projectId) {
      return load().comments.filter((c) => c.projectId === projectId && c.status === 'published').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(view)
    },
    async myReviews() {
      const id = meId(); if (!id) return []
      return load().comments.filter((c) => c.reviewerId === id && c.status === 'published').map(view)
    },
    async submit(projectId, input) {
      const id = requireMe()
      const r = wrap(() => submitComment(load(), getRoster(), id, projectId, input, new Date(), DEFAULT_SETTINGS))
      save(r.state); emit(); return view(r.comment)
    },
    async update(commentId, input) {
      const id = requireMe()
      const r = wrap(() => updateComment(load(), id, commentId, input, new Date(), DEFAULT_SETTINGS))
      save(r.state); emit(); return view(r.comment)
    },
    async recommend() {
      const id = requireMe()
      const r = wrap(() => recommend(load(), getRoster(), id, new Date(), DEFAULT_SETTINGS))
      save(r.state); return r.projectId
    },
    async instructorStatus() { return { signedIn: true, isInstructor: true, email: 'demo' } },
    async instructorSignIn() { return 'Demo mode has no instructor sign-in.' },
    async instructorSignOut() {},
    async adminOverview() {
      const s = load()
      return { open: s.open, maxPerProject: DEFAULT_SETTINGS.maxPerProject, maxPerReviewer: DEFAULT_SETTINGS.maxPerReviewer, comments: s.comments.map((c) => ({ ...view(c), status: c.status, removedReason: c.removedReason ?? null })) }
    },
    async removeComment(id, reason) { save(removeComment(load(), id, reason)); emit() },
    async restoreComment(id) { save(wrap(() => restoreComment(load(), id))); emit() },
    async setOpen(open) { save({ ...load(), open }); emit() },
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb) },
  }
}

/** Instructor "Reset demo data": wipes demo comments, reservations and the demo sign-in in this browser only. */
export function resetDemoData() {
  for (const k of [DEMO_KEY, DEMO_ME]) { try { localStorage.removeItem(k) } catch { /* ignore */ } }
}
