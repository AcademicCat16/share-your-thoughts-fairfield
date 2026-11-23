/**
 * LIVE CLASSROOM MODE — shared comments in Supabase. Only the public anon key is used here; every rule is enforced
 * inside Postgres by SECURITY DEFINER functions (supabase/CONTRACT.md). Not active unless the site is built with
 * VITE_FEEDBACK_MODE=live plus the two Supabase variables.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RuleError } from '../../shared/rules.ts'
import { RULE_MESSAGES } from '../../shared/rules.ts'
import type { CourseKey } from '../../shared/roster.ts'
import type { QuestItem } from '../../shared/engine.ts'
import { BackendError, type AdminOverview, type Backend, type CommentView, type Me } from './backend.ts'

interface Row { id: string; project_id: string; reviewer_id: string; reviewer_name: string; pronouns: string | null; enjoyed: string; suggestion: string; created_at: string; updated_at: string }
const toView = (r: Row): CommentView => ({ id: r.id, projectId: r.project_id, reviewerId: r.reviewer_id, reviewerName: r.reviewer_name, pronouns: r.pronouns, enjoyed: r.enjoyed, suggestion: r.suggestion, createdAt: r.created_at, updatedAt: r.updated_at })

function fail(err: { message?: string } | null): never {
  const m = (err?.message ?? '').trim()
  const code = (Object.keys(RULE_MESSAGES) as RuleError[]).find((k) => m === k || m.startsWith(`${k}:`) || m.endsWith(` ${k}`))
  if (code === 'invalid_plan') throw new BackendError('invalid_plan', `The server rejected the plan: ${m.replace(/^invalid_plan:\s*/, '')}`)
  if (code) throw new BackendError(code)
  if (/fetch|network|Failed to fetch/i.test(m)) throw new BackendError('network', 'Could not reach the classroom server. Check your connection and try again.')
  throw new BackendError('unknown', 'The classroom server could not complete that request.')
}

export function createLiveBackend(url: string, anonKey: string): Backend {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'fic.live.auth' } })
  const rpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    let res
    try { res = await sb.rpc(fn, args) } catch (e) { fail({ message: e instanceof Error ? e.message : 'network' }) }
    if (res.error) fail(res.error)
    return res.data as T
  }
  const session = async () => (await sb.auth.getSession()).data.session
  const ensureSession = async () => {
    const s = await session()
    if (s) return
    const { error } = await sb.auth.signInAnonymously()
    if (error) throw new BackendError('network', 'Could not start a secure session with the classroom server.')
  }
  const me = async (): Promise<Me | null> => {
    if (!(await session())) return null
    const rows = await rpc<{ student_id: string; full_name: string; first_name: string; last_name: string; course: CourseKey; section_code: string; reviews_completed: number; reviews_required: number; participating: boolean }[]>('whoami')
    const r = rows?.[0]
    return r ? { studentId: r.student_id, fullName: r.full_name, firstName: r.first_name, lastName: r.last_name, course: r.course, sectionCode: r.section_code, completed: r.reviews_completed, required: r.reviews_required, participating: r.participating } : null
  }
  const signedInStudent = async () => !!(await session()) && !!(await me())

  return {
    mode: 'live',
    me,
    async signIn({ code }) {
      await ensureSession()
      const rows = await rpc<{ ok: boolean; error: string | null }[]>('redeem_access_code', { p_code: code ?? '' })
      const r = rows?.[0]
      if (!r?.ok) throw new BackendError(r?.error === 'rate_limited' ? 'rate_limited' : 'bad_code', r?.error === 'rate_limited' ? 'Too many tries. Please wait 15 minutes, or ask your instructor.' : undefined)
      const m = await me()
      if (!m) throw new BackendError('bad_code')
      return m
    },
    async signOut() { try { await rpc('sign_out_student') } finally { await sb.auth.signOut() } },
    async status() {
      const [rows, settings] = await Promise.all([
        rpc<{ project_id: string; published: number; capacity: number }[]>('get_public_status'),
        rpc<{ feedback_open: boolean; allow_extra_reviews: boolean }[]>('get_public_settings'),
      ])
      const st = settings?.[0]
      return { open: !!st?.feedback_open, allowExtra: !!st?.allow_extra_reviews, projects: Object.fromEntries((rows ?? []).map((r) => [r.project_id, { published: r.published, capacity: r.capacity }])) }
    },
    async comments(projectId) {
      if (!(await session())) return []
      try { return (await rpc<Row[]>('get_comments', { p_project_id: projectId })).map(toView) } catch (e) {
        if (e instanceof BackendError && e.code === 'not_signed_in') return []
        throw e
      }
    },
    async myReviews() { return (await signedInStudent()) ? (await rpc<Row[]>('my_reviews')).map(toView) : [] },
    async quest() {
      if (!(await signedInStudent())) return []
      const rows = await rpc<{ project_id: string; status: QuestItem['status']; comment_id: string | null; published: number; capacity: number }[]>('my_quest')
      return (rows ?? []).map((r) => ({ projectId: r.project_id, status: r.status, commentId: r.comment_id, published: r.published, capacity: r.capacity }))
    },
    async nextReview() { const rows = await rpc<{ project_id: string }[]>('next_review'); return rows?.[0]?.project_id ?? null },
    async submit(projectId, input) {
      const rows = await rpc<Row[] | Row>('submit_comment', { p_project_id: projectId, p_pronouns: input.pronouns, p_enjoyed: input.enjoyed, p_suggestion: input.suggestion })
      return toView(Array.isArray(rows) ? rows[0] : rows)
    },
    async update(commentId, input) {
      const rows = await rpc<Row[] | Row>('update_comment', { p_comment_id: commentId, p_pronouns: input.pronouns, p_enjoyed: input.enjoyed, p_suggestion: input.suggestion })
      return toView(Array.isArray(rows) ? rows[0] : rows)
    },
    async instructorStatus() {
      const u = (await session())?.user
      if (!u || u.is_anonymous) return { signedIn: false, isInstructor: false }
      return { signedIn: true, email: u.email, isInstructor: await rpc<boolean>('is_instructor') }
    },
    async instructorSignIn(email) {
      const redirect = `${location.origin}${import.meta.env.BASE_URL}?instructor=1`
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: false } })
      if (error) throw new BackendError('unknown', 'Could not send the sign-in email. Is this address set up as an instructor in Supabase?')
      return 'Check your email for a sign-in link.'
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
      // Cheap polling keeps every open classroom in sync (15 s), plus on tab focus.
      const t = setInterval(cb, 15_000)
      const onVis = () => { if (document.visibilityState === 'visible') cb() }
      document.addEventListener('visibilitychange', onVis)
      return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
    },
  }
}
