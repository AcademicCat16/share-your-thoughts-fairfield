/**
 * LIVE CLASSROOM MODE — shared comments in Supabase. Only the public anon key is used here;
 * every rule is enforced inside Postgres by SECURITY DEFINER functions (supabase/migrations).
 * Not active unless the site is built with VITE_FEEDBACK_MODE=live plus the two Supabase variables.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RuleError } from '../../shared/rules.ts'
import { RULE_MESSAGES } from '../../shared/rules.ts'
import { BackendError, type Backend, type CommentView, type Me } from './backend.ts'

interface Row { id: string; project_id: string; reviewer_id: string; reviewer_name: string; pronouns: string | null; enjoyed: string; suggestion: string; created_at: string; updated_at: string }
const toView = (r: Row): CommentView => ({ id: r.id, projectId: r.project_id, reviewerId: r.reviewer_id, reviewerName: r.reviewer_name, pronouns: r.pronouns, enjoyed: r.enjoyed, suggestion: r.suggestion, createdAt: r.created_at, updatedAt: r.updated_at })

function fail(err: { message?: string } | null): never {
  const m = (err?.message ?? '').trim()
  const code = (Object.keys(RULE_MESSAGES) as RuleError[]).find((k) => m === k || m.startsWith(`${k}:`) || m.endsWith(` ${k}`))
  if (code) throw new BackendError(code)
  if (/fetch|network/i.test(m)) throw new BackendError('network', 'Could not reach the classroom server. Check your connection and try again.')
  throw new BackendError('unknown', 'The classroom server could not complete that request.')
}

export function createLiveBackend(url: string, anonKey: string): Backend {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'fic.live.auth' } })
  const rpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args)
    if (error) fail(error)
    return data as T
  }
  const ensureSession = async () => {
    const { data } = await sb.auth.getSession()
    if (data.session) return
    const { error } = await sb.auth.signInAnonymously()
    if (error) throw new BackendError('network', 'Could not start a secure session with the classroom server.')
  }
  const me = async (): Promise<Me | null> => {
    const { data } = await sb.auth.getSession()
    if (!data.session) return null
    const rows = await rpc<{ student_id: string; full_name: string; section: string; reviews_written: number }[]>('whoami')
    const r = rows?.[0]
    return r ? { studentId: r.student_id, fullName: r.full_name, section: r.section, reviewsWritten: r.reviews_written } : null
  }

  return {
    mode: 'live',
    me,
    async signIn(studentId, code) {
      await ensureSession()
      await rpc('redeem_access_code', { p_student_id: studentId, p_code: code.trim().toUpperCase() })
      const m = await me()
      if (!m) throw new BackendError('bad_code')
      return m
    },
    async signOut() { try { await rpc('sign_out_student') } finally { await sb.auth.signOut() } },
    async counts() {
      const rows = await rpc<{ project_id: string; published: number }[]>('get_project_counts')
      return Object.fromEntries((rows ?? []).map((r) => [r.project_id, r.published]))
    },
    async comments(projectId) {
      const { data } = await sb.auth.getSession()
      if (!data.session) return []
      try { return (await rpc<Row[]>('get_comments', { p_project_id: projectId })).map(toView) } catch (e) {
        if (e instanceof BackendError && e.code === 'not_signed_in') return []
        throw e
      }
    },
    async myReviews() { const m = await me(); return m ? (await rpc<Row[]>('my_reviews')).map(toView) : [] },
    async submit(projectId, input) {
      const rows = await rpc<Row[] | Row>('submit_comment', { p_project_id: projectId, p_pronouns: input.pronouns, p_enjoyed: input.enjoyed, p_suggestion: input.suggestion })
      return toView(Array.isArray(rows) ? rows[0] : rows)
    },
    async update(commentId, input) {
      const rows = await rpc<Row[] | Row>('update_comment', { p_comment_id: commentId, p_pronouns: input.pronouns, p_enjoyed: input.enjoyed, p_suggestion: input.suggestion })
      return toView(Array.isArray(rows) ? rows[0] : rows)
    },
    async recommend() {
      const rows = await rpc<{ project_id: string }[]>('recommend_project')
      return rows?.[0]?.project_id ?? null
    },
    async instructorStatus() {
      const { data } = await sb.auth.getSession()
      const u = data.session?.user
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
    async adminOverview() {
      const o = await rpc<{ settings: { feedback_open: boolean; max_comments_per_project: number; max_reviews_per_reviewer: number }; comments: (Row & { status: 'published' | 'removed'; removed_reason: string | null })[] }>('admin_overview')
      return { open: o.settings.feedback_open, maxPerProject: o.settings.max_comments_per_project, maxPerReviewer: o.settings.max_reviews_per_reviewer, comments: o.comments.map((c) => ({ ...toView(c), status: c.status, removedReason: c.removed_reason })) }
    },
    async removeComment(id, reason) { await rpc('admin_remove_comment', { p_comment_id: id, p_reason: reason }) },
    async restoreComment(id) { await rpc('admin_restore_comment', { p_comment_id: id }) },
    async setOpen(open) { await rpc('admin_set_open', { p_open: open }) },
    subscribe(cb) {
      // Simple, cheap polling keeps every open classroom roughly in sync (30 s), plus on tab focus.
      const t = setInterval(cb, 30_000)
      const onVis = () => { if (document.visibilityState === 'visible') cb() }
      document.addEventListener('visibilitychange', onVis)
      return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
    },
  }
}
