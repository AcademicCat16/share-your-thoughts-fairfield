/**
 * LIVE CLASSROOM MODE — shared comments in Supabase. Only the public (publishable/anon) key is used here; every rule is
 * enforced inside Postgres by SECURITY DEFINER functions (supabase/CONTRACT.md).
 *
 * STUDENTS — HONOR SYSTEM (migration 002): no accounts, no codes, no auth session. A student picks their own name;
 * the browser remembers it (localStorage, not a secret); every submission is checked by the server for THAT name
 * (course, not own project, not already reviewed, on the assignment list, free slot, rate limits). Choosing a name
 * does not verify identity — see supabase/SETUP.md.
 *
 * INSTRUCTOR — Supabase e-mail + password. The session is kept in sessionStorage (ends when the tab closes); the
 * password itself is never stored by this app. Instructor rights are checked on the server (public.is_instructor()).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RuleError } from '../../shared/rules.ts'
import { RULE_MESSAGES, REVIEWS_PER_STUDENT } from '../../shared/rules.ts'
import type { CourseKey, Student } from '../../shared/roster.ts'
import type { QuestItem } from '../../shared/engine.ts'
import { BackendError, type AdminOverview, type Backend, type CommentView, type Me } from './backend.ts'

interface Row { id: string; project_id: string; reviewer_id: string; reviewer_name: string; pronouns: string | null; enjoyed: string; suggestion: string; created_at: string; updated_at: string }
interface QuestRow { project_id: string; status: QuestItem['status']; comment_id: string | null; published: number; capacity: number }
const toView = (r: Row): CommentView => ({ id: r.id, projectId: r.project_id, reviewerId: r.reviewer_id, reviewerName: r.reviewer_name, pronouns: r.pronouns, enjoyed: r.enjoyed, suggestion: r.suggestion, createdAt: r.created_at, updatedAt: r.updated_at })
const toQuest = (r: QuestRow): QuestItem => ({ projectId: r.project_id, status: r.status, commentId: r.comment_id, published: r.published, capacity: r.capacity })

/** The chosen name (honor system) and the edit tokens this browser received. Neither is a credential for identity. */
export const LIVE_ME = 'fic.live.me.v1'
export const LIVE_TOKENS = 'fic.live.editTokens.v1'
const readMe = () => { try { return localStorage.getItem(LIVE_ME) } catch { return null } }
const writeMe = (id: string | null) => { try { if (id) localStorage.setItem(LIVE_ME, id); else localStorage.removeItem(LIVE_ME) } catch { /* storage blocked */ } }
const readTokens = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(LIVE_TOKENS) ?? '{}') ?? {} } catch { return {} } }
const saveToken = (commentId: string, token: string) => { try { localStorage.setItem(LIVE_TOKENS, JSON.stringify({ ...readTokens(), [commentId]: token })) } catch { /* storage blocked */ } }

function fail(err: { message?: string } | null): never {
  const m = (err?.message ?? '').trim()
  const code = (Object.keys(RULE_MESSAGES) as RuleError[]).find((k) => m === k || m.startsWith(`${k}:`) || m.endsWith(` ${k}`))
  if (code === 'invalid_plan') throw new BackendError('invalid_plan', `The server rejected the plan: ${m.replace(/^invalid_plan:\s*/, '')}`)
  if (code) throw new BackendError(code)
  if (/fetch|network|Failed to fetch/i.test(m)) throw new BackendError('network', 'Could not reach the classroom server. Check your connection and try again.')
  throw new BackendError('unknown', 'The classroom server could not complete that request.')
}

export function createLiveBackend(url: string, anonKey: string, roster: Student[]): Backend {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'fic.live.instructor', storage: typeof window !== 'undefined' ? window.sessionStorage : undefined },
  })
  const rpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    let res
    try { res = await sb.rpc(fn, args) } catch (e) { fail({ message: e instanceof Error ? e.message : 'network' }) }
    if (res.error) fail(res.error)
    return res.data as T
  }
  const session = async () => (await sb.auth.getSession()).data.session
  const byId = new Map(roster.map((s) => [s.id, s]))
  const known = (id: string | null) => { const s = id ? byId.get(id) : undefined; return s && !s.hidden ? s : null }
  const questOf = async (id: string): Promise<QuestItem[]> => (await rpc<QuestRow[]>('get_student_quest', { p_student_id: id }) ?? []).map(toQuest)
  const me = async (): Promise<Me | null> => {
    const st = known(readMe())
    if (!st) return null
    const q = await questOf(st.id)
    return { studentId: st.id, fullName: st.fullName, firstName: st.firstName, lastName: st.lastName, course: st.course, sectionCode: st.sectionCode, completed: q.filter((i) => i.status !== 'pending').length, required: REVIEWS_PER_STUDENT, participating: true }
  }
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === LIVE_ME) emit() })

  return {
    mode: 'live',
    me,
    async signIn({ studentId }) {
      if (!known(studentId)) throw new BackendError('unknown_reviewer')
      writeMe(studentId); emit()
      const m = await me()
      if (!m) throw new BackendError('unknown_reviewer')
      return m
    },
    async signOut() { writeMe(null); emit() },
    async status() {
      const [rows, settings] = await Promise.all([
        rpc<{ project_id: string; published: number; capacity: number }[]>('get_public_status'),
        rpc<{ feedback_open: boolean; allow_extra_reviews: boolean }[]>('get_public_settings'),
      ])
      const st = settings?.[0]
      return { open: !!st?.feedback_open, allowExtra: !!st?.allow_extra_reviews, projects: Object.fromEntries((rows ?? []).map((r) => [r.project_id, { published: r.published, capacity: r.capacity }])) }
    },
    async comments(projectId) { return (await rpc<Row[]>('get_project_comments', { p_project_id: projectId }) ?? []).map(toView) },
    async myReviews() {
      const id = readMe(); if (!known(id)) return []
      const q = (await questOf(id!)).filter((i) => i.status !== 'pending')
      const all = await Promise.all(q.map((i) => rpc<Row[]>('get_project_comments', { p_project_id: i.projectId })))
      return all.flat().filter((r) => r.reviewer_id === id).map(toView)
    },
    async quest() { const id = readMe(); return known(id) ? questOf(id!) : [] },
    questOf,
    async nextReview() {
      const id = readMe(); if (!known(id)) return null
      const open = (await questOf(id!)).filter((i) => i.status === 'pending' && i.published < i.capacity)
      open.sort((a, b) => a.published - b.published)
      return open[0]?.projectId ?? null
    },
    async submit(projectId, input, reviewerId) {
      if (!known(reviewerId)) throw new BackendError('unknown_reviewer')
      const rows = await rpc<(Row & { edit_token: string })[]>('submit_feedback', { p_reviewer_id: reviewerId, p_project_id: projectId, p_pronouns: input.pronouns ?? '', p_enjoyed: input.enjoyed, p_suggestion: input.suggestion })
      const r = Array.isArray(rows) ? rows[0] : rows
      if (r?.edit_token) saveToken(r.id, r.edit_token)
      writeMe(reviewerId); emit()
      return toView(r)
    },
    async update(commentId, input) {
      const token = readTokens()[commentId]
      if (!token) throw new BackendError('not_author')
      const rows = await rpc<Row[] | Row>('edit_feedback', { p_comment_id: commentId, p_edit_token: token, p_pronouns: input.pronouns ?? '', p_enjoyed: input.enjoyed, p_suggestion: input.suggestion })
      return toView(Array.isArray(rows) ? rows[0] : rows)
    },
    canEdit(c) { return !!readTokens()[c.id] },
    async instructorStatus() {
      const u = (await session())?.user
      if (!u || u.is_anonymous) return { signedIn: false, isInstructor: false }
      return { signedIn: true, email: u.email, isInstructor: await rpc<boolean>('is_instructor') }
    },
    async instructorSignIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw new BackendError('unknown', /invalid/i.test(error.message) ? 'E-mail or password is not correct.' : /rate|too many/i.test(error.message) ? 'Too many attempts. Please wait a few minutes and try again.' : 'Could not sign in. Please try again.')
      if (!(await rpc<boolean>('is_instructor'))) { await sb.auth.signOut(); throw new BackendError('not_instructor', 'This account is not an instructor for this classroom.') }
      return 'Signed in.'
    },
    async instructorChangePassword(newPassword) {
      if (!(await session())) throw new BackendError('not_instructor')
      const { error } = await sb.auth.updateUser({ password: newPassword })
      if (error) throw new BackendError('unknown', /weak|short|characters/i.test(error.message) ? `The new password was refused: ${error.message}` : 'Could not change the password. Please try again.')
    },
    async instructorSignOut() { await sb.auth.signOut() },
    async adminOverview(): Promise<AdminOverview> {
      type S = { id: string; participating: boolean; capacity: number; published_received: number; written: number }
      type A = { course: CourseKey; reviewer_id: string; project_id: string; status: 'pending' | 'completed' | 'released' }
      type C = Row & { course: CourseKey; status: 'published' | 'removed'; removed_reason: string | null; extra: boolean }
      const o = await rpc<{ settings: { feedback_open: boolean; allow_extra_reviews: boolean; base_slots: number; reviews_per_student: number }; students: S[]; assignments: A[]; comments: C[] }>('admin_overview')
      return {
        open: o.settings.feedback_open, allowExtra: o.settings.allow_extra_reviews, baseSlots: o.settings.base_slots, perStudent: o.settings.reviews_per_student,
        students: o.students.map((s) => ({ id: s.id, participating: s.participating, capacity: s.capacity, published: s.published_received, written: s.written })),
        assignments: o.assignments.map((a) => ({ course: a.course, reviewerId: a.reviewer_id, projectId: a.project_id, status: a.status })),
        comments: o.comments.map((c) => ({ ...toView(c), course: c.course, status: c.status, removedReason: c.removed_reason, extra: c.extra })),
      }
    },
    async applyAssignments(course, capacities, pending) {
      await rpc('admin_apply_assignments', { p_course: course, p_capacities: capacities, p_assignments: pending.map((e) => ({ reviewer_id: e.reviewerId, project_id: e.projectId })) })
    },
    async setParticipating(id, p) { await rpc('admin_set_participating', { p_student_id: id, p_participating: p }) },
    async removeComment(id, reason) { await rpc('admin_remove_comment', { p_comment_id: id, p_reason: reason }) },
    async restoreComment(id) { await rpc('admin_restore_comment', { p_comment_id: id }) },
    async setOpen(open) { await rpc('admin_set_open', { p_open: open }) },
    async setAllowExtra(allow) { await rpc('admin_set_allow_extra', { p_allow: allow }) },
    subscribe(cb) {
      // Cheap polling keeps every open classroom in sync (15 s), plus on tab focus and when the chosen name changes.
      listeners.add(cb)
      const t = setInterval(cb, 15_000)
      const onVis = () => { if (document.visibilityState === 'visible') cb() }
      document.addEventListener('visibilitychange', onVis)
      return () => { listeners.delete(cb); clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
    },
  }
}
