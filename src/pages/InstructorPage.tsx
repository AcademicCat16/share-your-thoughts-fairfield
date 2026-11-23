import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Upload, Trash2, RotateCcw, ShieldCheck, AlertTriangle, Lock, Unlock, LogOut, Mail, Shuffle, Scale, UserX, UserCheck, EyeOff, Link2, RefreshCw } from 'lucide-react'
import linkAudit from '../data/link_audit.json'
import { useApp, MODE, BUNDLED_ROSTER } from '../lib/app.tsx'
import { BackendError, type AdminOverview } from '../lib/backend.ts'
import { resetDemoData } from '../lib/demoBackend.ts'
import { completion, emptyState, planCourse, DEFAULT_SETTINGS, type EngineState } from '../../shared/engine.ts'
import type { Plan } from '../../shared/allocation.ts'
import { composeComment } from '../../shared/compose.ts'
import { readWorkbook } from '../../shared/xlsx.ts'
import { parseWorkbook, mergeRoster, rosterCounts, countProblems, classifyUrl, publicRoster, isReviewable, COURSES, COURSE_KEYS, type CourseKey, type Roster, type MergeReport, type Student } from '../../shared/roster.ts'
import { CREATURES } from '../../shared/creatures.ts'
import { CREATURES_1101 } from '../../shared/creatures1101.ts'

type AuditRow = { status: string; note: string; resolvedUrl: string | null; checkedAt: string }
const AUDIT = linkAudit as { checkedAt: string; results: Record<string, AuditRow> }

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
function downloadFile(name: string, text: string, type = 'text/csv') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` })); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
const today = () => new Date().toISOString().slice(0, 10)

function InstructorGate({ onReady }: { onReady: () => void }) {
  const { backend } = useApp()
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [status, setStatus] = useState<{ signedIn: boolean; email?: string; isInstructor: boolean } | null>(null)
  useEffect(() => { backend.instructorStatus().then((s) => { setStatus(s); if (s.isInstructor) onReady() }).catch(() => setStatus({ signedIn: false, isInstructor: false })) }, [backend, onReady])
  if (!status) return <p className="hint">Checking instructor access…</p>
  if (status.signedIn && !status.isInstructor) return (
    <div className="gate"><Lock aria-hidden="true" /><h2>Not an instructor account</h2><p>{status.email} is signed in but is not on the instructor list.</p>
      <button type="button" className="btn" onClick={() => backend.instructorSignOut().then(() => location.reload())}><LogOut size={16} aria-hidden="true" /> Sign out</button></div>
  )
  return (
    <form className="gate" onSubmit={async (e) => { e.preventDefault(); try { setMsg(await backend.instructorSignIn(email.trim())) } catch (x) { setMsg(x instanceof BackendError ? x.message : 'Could not send the link.') } }} data-testid="instructor-gate">
      <Lock aria-hidden="true" /><h2>Instructor sign-in</h2>
      <p>The dashboard and moderation tools are protected on the server. Enter the instructor email registered in the database and we'll send a one-time sign-in link.</p>
      <label className="field"><span>Instructor email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-testid="instructor-email" /></label>
      <button type="submit" className="btn primary" data-testid="instructor-send"><Mail size={16} aria-hidden="true" /> Email me a sign-in link</button>
      {msg && <p className="hint" role="status" data-testid="instructor-msg">{msg}</p>}
    </form>
  )
}

/** Rebuild an engine state from the overview so the same planner/reporting code runs in both modes. */
function stateFrom(ov: AdminOverview | null): EngineState {
  if (!ov) return emptyState()
  const capacities: Record<string, number> = {}
  for (const s of ov.students) if (s.capacity) capacities[s.id] = s.capacity
  return {
    ...emptyState(), open: ov.open, allowExtra: ov.allowExtra, capacities,
    nonParticipants: ov.students.filter((s) => !s.participating).map((s) => s.id),
    comments: ov.comments.map((c) => ({ ...c, removedReason: c.removedReason ?? undefined })),
    assignments: ov.assignments.map((a) => ({ ...a })),
    planned: { '1101': ov.assignments.some((a) => a.course === '1101') ? 'yes' : undefined, '2241': ov.assignments.some((a) => a.course === '2241') ? 'yes' : undefined },
  }
}

function CourseBlock({ course, state, roster, onPlan, onAct }: { course: CourseKey; state: EngineState; roster: Student[]; onPlan: (course: CourseKey, mode: 'replace' | 'rebalance') => void; onAct: (fn: () => Promise<void>, ok: string) => void }) {
  const { backend } = useApp()
  const rep = completion(state, roster, course, DEFAULT_SETTINGS)
  const k = rosterCounts({ ...BUNDLED_ROSTER, students: roster }, course)
  const [filter, setFilter] = useState<'all' | 'behind' | 'links' | 'extra'>('all')
  const name = (id: string) => roster.find((s) => s.id === id)?.fullName ?? id
  const rows = rep.rows.filter((r) => filter === 'all' ? true : filter === 'behind' ? r.written < DEFAULT_SETTINGS.perStudent : filter === 'links' ? !r.eligible : r.capacity > DEFAULT_SETTINGS.baseSlots)
  const kpis: [string, string | number, string][] = [
    ['Students', k.total, course === '2241' ? `${k.section01} in 2241-01 · ${k.section02} in 2241-02` : 'one section'],
    ['Working websites', k.working, 'verified by the link audit'],
    ['Missing / broken', k.missing + k.invalid + k.broken + k.unchecked, `${k.missing} missing · ${k.invalid + k.broken} broken${k.unchecked ? ` · ${k.unchecked} unchecked` : ''}`],
    ['Reviews submitted', rep.totalPublished, `of ${rep.demand} required (${rep.participants} × ${DEFAULT_SETTINGS.perStudent})`],
    ['Completed four', `${rep.reviewersComplete} / ${rep.participants}`, 'students'],
    ['Projects with open slots', `${rep.projectsWithRoom} / ${rep.eligibleProjects}`, 'still accepting feedback'],
    ['Extra slots', rep.extraSlots, `${rep.projectsWithExtra} project${rep.projectsWithExtra === 1 ? '' : 's'} with a fifth+ slot`],
  ]
  return (
    <section className="panel course-panel" aria-labelledby={`cp-${course}`} data-testid={`course-panel-${course}`}>
      <h2 id={`cp-${course}`}>{COURSES[course].code} · {COURSES[course].title}</h2>
      <div className="kpis">{kpis.map(([a, v, s]) => <div key={a} className="kpi" data-testid={`kpi-${course}-${a.toLowerCase().replace(/[^a-z]+/g, '-')}`}><span>{a}</span><strong>{v}</strong><small>{s}</small></div>)}</div>
      <div className="capacity-note">
        <p>Required: {rep.participants} participating students × {DEFAULT_SETTINGS.perStudent} = <strong>{rep.demand}</strong> reviews. Standard capacity: {rep.eligibleProjects} working projects × {DEFAULT_SETTINGS.baseSlots} = <strong>{rep.standardCapacity}</strong> slots.
          {rep.demand > rep.standardCapacity ? <> Extra slots needed: <strong data-testid={`extra-needed-${course}`}>{rep.demand - rep.standardCapacity}</strong>.</> : <> No extra slots needed.</>}</p>
        <p>{rep.planned ? <>Assignment plan in place: {rep.assignedTotal} assignments ({rep.pendingTotal} still to do). Slot capacity now {rep.capacity}.</> : <strong className="warn">No assignment plan yet — generate one so students can start.</strong>}</p>
        {rep.structuralShortfall > 0 && <p className="warn">Even with every slot open, {rep.structuralShortfall} required reviews cannot be placed.</p>}
      </div>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => onPlan(course, 'replace')} data-testid={`plan-replace-${course}`}><Shuffle size={16} aria-hidden="true" /> Generate reviewer assignments</button>
        <button type="button" className="btn" onClick={() => onPlan(course, 'rebalance')} data-testid={`plan-rebalance-${course}`}><Scale size={16} aria-hidden="true" /> Rebalance unused assignments</button>
      </div>
      <p className="hint">Generate keeps every completed review and replaces all unfinished assignments with a fresh balanced plan. Rebalance keeps unfinished ones too and only fills the gaps (use it after releasing a student who is not participating).</p>
      <div className="seg" role="group" aria-label="Filter students">
        {([['all', 'Everyone'], ['behind', 'Under 4 written'], ['links', 'No working project'], ['extra', 'Projects with extra slots']] as const).map(([f, l]) =>
          <button key={f} type="button" className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>{l}</button>)}
      </div>
      <div className="table-wrap">
        <table className="dash-table" data-testid={`student-table-${course}`}>
          <thead><tr><th>Student</th><th>Section</th><th>Project</th><th>Feedback received</th><th>Written</th><th>Participating</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const a = AUDIT.results[r.student.id]
              return (
                <tr key={r.student.id} className={r.participating ? '' : 'released'}>
                  <td>{r.student.hidden ? <em>Hidden</em> : r.student.fullName}<small className="id">{r.student.id}</small></td>
                  <td>{r.student.sectionCode.replace('MKTG ', '')}</td>
                  <td className={`url ${r.eligible ? 'valid' : 'missing'}`}>
                    {r.eligible ? <a href={r.student.url!} target="_blank" rel="noopener noreferrer">{r.student.url!.replace(/^https?:\/\//, '').slice(0, 44)}</a> : <span>{r.student.urlStatus === 'missing' ? 'Missing' : r.student.link?.status === 'broken' ? 'Broken' : r.student.urlStatus === 'invalid' ? 'Invalid' : 'Not verified'}</span>}
                    {a && a.status !== 'working' && a.status !== 'missing' && <small className="bad">{a.note}</small>}
                  </td>
                  <td>{r.eligible ? <>{r.received} / {r.capacity}{r.capacity > DEFAULT_SETTINGS.baseSlots && <span className="extra-tag" title="Additional feedback slot(s)">+{r.capacity - DEFAULT_SETTINGS.baseSlots}</span>} <small>({r.assignedTo} assigned)</small></> : '—'}</td>
                  <td>{r.written} / {DEFAULT_SETTINGS.perStudent}{r.pending ? <small> · {r.pending} to do</small> : null}</td>
                  <td>
                    {r.participating
                      ? <button type="button" className="btn small ghost" onClick={() => { if (confirm(`Release ${name(r.student.id)}? Their unfinished assignments are freed; completed reviews stay. Then use “Rebalance”.`)) onAct(() => backend.setParticipating(r.student.id, false), 'Student released — now rebalance to reassign their slots.') }} data-testid={`release-${r.student.id}`}><UserX size={14} aria-hidden="true" /> Release</button>
                      : <button type="button" className="btn small" onClick={() => onAct(() => backend.setParticipating(r.student.id, true), 'Student is participating again — rebalance to give them assignments.')}><UserCheck size={14} aria-hidden="true" /> Re-add</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function InstructorPage() {
  const { backend, roster, rosterOverridden, setRosterOverride, refresh, say } = useApp()
  const [ready, setReady] = useState(MODE === 'demo')
  const [ov, setOv] = useState<AdminOverview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [plan, setPlan] = useState<{ course: CourseKey; mode: 'replace' | 'rebalance'; plan: Plan } | null>(null)
  const [imp, setImp] = useState<{ roster: Roster; report: MergeReport; warnings: string[]; problems: string[] } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [fix, setFix] = useState<{ id: string; url: string }>({ id: '', url: '' })
  const [ping, setPing] = useState<Record<string, string>>({})
  const [hide, setHide] = useState<Set<string>>(() => new Set(roster.students.filter((s) => s.hidden).map((s) => s.id)))

  const load = useCallback(async () => {
    try { setOv(await backend.adminOverview()); setErr(null) } catch (e) { setErr(e instanceof BackendError ? e.message : 'Could not load the dashboard.') }
  }, [backend])
  useEffect(() => { if (ready) load() }, [ready, load])
  useEffect(() => (ready ? backend.subscribe(load) : undefined), [ready, backend, load])

  const state = useMemo(() => stateFrom(ov), [ov])
  useEffect(() => { if (plan) document.querySelector('[data-testid=plan-preview]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [plan])
  const name = (id: string) => roster.students.find((s) => s.id === id)?.fullName ?? roster.removed.find((s) => s.id === id)?.fullName ?? id
  const act = async (fn: () => Promise<void>, ok: string) => { try { await fn(); await load(); await refresh(); say(ok) } catch (e) { say(e instanceof BackendError ? e.message : 'That did not work.') } }

  if (!ready) return <main className="instructor" id="main" tabIndex={-1}><h1>Instructor dashboard</h1><InstructorGate onReady={() => setReady(true)} /></main>

  const both = COURSE_KEYS.map((c) => completion(state, roster.students, c))
  const all = rosterCounts(roster)
  const published = (ov?.comments ?? []).filter((c) => c.status === 'published')
  const removed = (ov?.comments ?? []).filter((c) => c.status === 'removed')

  const exportFeedback = () => {
    const head = ['comment_id', 'status', 'course', 'project_student_id', 'project_student', 'project_section', 'reviewer_student_id', 'reviewer', 'assigned', 'pronouns', 'q1_enjoyed', 'q2_suggestion', 'published_paragraph', 'created_at', 'updated_at', 'removed_reason']
    const lines = (ov?.comments ?? []).map((c) => [c.id, c.status, c.course, c.projectId, name(c.projectId), roster.students.find((s) => s.id === c.projectId)?.sectionCode ?? '', c.reviewerId, c.reviewerName, c.extra ? 'extra' : 'assigned', c.pronouns ?? '', c.enjoyed, c.suggestion,
      composeComment({ reviewerName: c.reviewerName, pronouns: c.pronouns, enjoyed: c.enjoyed, suggestion: c.suggestion }), c.createdAt, c.updatedAt, c.removedReason ?? ''].map(csvCell).join(','))
    downloadFile(`feedback_comments_${MODE}_${today()}.csv`, [head.join(','), ...lines].join('\n'))
  }
  const exportCompletion = () => {
    const head = ['student_id', 'course', 'section', 'first_name', 'last_name', 'participating', 'project_status', 'project_url', 'feedback_received', 'slot_capacity', 'reviews_written', 'reviews_required', 'completed_four', 'assignments_to_do']
    const lines = both.flatMap((rep) => rep.rows.map((r) => [r.student.id, r.student.courseCode, r.student.sectionCode, r.student.firstName, r.student.lastName, r.participating ? 'yes' : 'released',
      r.eligible ? 'working' : r.student.urlStatus === 'valid' ? r.student.link?.status ?? 'unchecked' : r.student.urlStatus, r.student.url ?? '', r.eligible ? r.received : 'n/a', r.eligible ? r.capacity : 'n/a', r.written, DEFAULT_SETTINGS.perStudent, r.written >= DEFAULT_SETTINGS.perStudent ? 'yes' : 'no', r.pending].map(csvCell).join(',')))
    downloadFile(`completion_report_${MODE}_${today()}.csv`, [head.join(','), ...lines].join('\n'))
  }
  const makePlan = (course: CourseKey, mode: 'replace' | 'rebalance') => setPlan({ course, mode, plan: planCourse(state, roster.students, course, mode, DEFAULT_SETTINGS, `fic-${course}-${today()}`) })
  const applyPlan = () => {
    if (!plan) return
    const pending = plan.plan.assignments.filter((a) => a.status === 'pending').map((a) => ({ reviewerId: a.reviewerId, projectId: a.projectId }))
    act(() => backend.applyAssignments(plan.course, plan.plan.capacities, pending), `${COURSES[plan.course].code}: ${pending.length} assignments saved.`).then(() => setPlan(null))
  }
  const onImport = async (f: File) => {
    try {
      const parsed = parseWorkbook(readWorkbook(new Uint8Array(await f.arrayBuffer())))
      const merged = mergeRoster(roster, parsed.rows, { '1101': CREATURES_1101.map((c) => c.id), '2241': CREATURES.map((c) => c.id) }, { file: f.name, sheets: parsed.sheets, importedAt: new Date().toISOString() })
      setImp({ ...merged, warnings: parsed.warnings, problems: countProblems(merged.roster) })
    } catch (e) { say(e instanceof Error ? e.message : 'Could not read that workbook.') }
  }
  const fixedRoster = (): Roster | null => {
    const s = roster.students.find((x) => x.id === fix.id)
    if (!s) return null
    const u = classifyUrl(fix.url)
    return { ...roster, students: roster.students.map((x) => (x.id === s.id ? { ...x, url: u.url, urlStatus: u.status, urlNote: u.note, urlSource: 'corrected by the instructor', link: { status: 'unchecked' } } : x)) }
  }
  /** Reachability only: browsers cannot read another site's content, so `npm run audit-links` stays the real check. */
  const recheck = async () => {
    const out: Record<string, string> = {}
    await Promise.all(roster.students.filter((s) => s.urlStatus === 'valid' && s.url).map(async (s) => {
      try { await fetch(s.url!, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(15000) }); out[s.id] = 'reachable' } catch { out[s.id] = 'unreachable' }
    }))
    setPing(out); say(`Quick check: ${Object.values(out).filter((v) => v === 'reachable').length} reachable, ${Object.values(out).filter((v) => v !== 'reachable').length} unreachable.`)
  }

  return (
    <main className="instructor" id="main" tabIndex={-1} data-testid="instructor">
      <header className="dash-head">
        <div>
          <h1>Instructor dashboard</h1>
          <p className="hint">{MODE === 'demo' ? 'Demo mode: these numbers describe test data stored only in this browser. The controls only affect this browser.' : 'Live classroom data. Every action here is checked again on the server.'}</p>
        </div>
        {MODE === 'live' && <button type="button" className="btn ghost" onClick={() => backend.instructorSignOut().then(() => location.reload())}><LogOut size={16} aria-hidden="true" /> Sign out</button>}
      </header>
      {err && <p className="form-error" role="alert">{err}</p>}

      <section className="panel" aria-labelledby="comb">
        <h2 id="comb">Both courses</h2>
        <div className="kpis">
          {([
            ['Students', all.total, `${all.c1101} in 1101 · ${all.c2241} in 2241`],
            ['Working websites', all.working, `${all.missing} missing · ${all.invalid + all.broken} broken`],
            ['Reviews submitted', published.length, `${removed.length} removed by moderation`],
            ['Reviews required', both.reduce((a, r) => a + r.demand, 0), 'participating students × 4'],
            ['Completed four', both.reduce((a, r) => a + r.reviewersComplete, 0), `of ${both.reduce((a, r) => a + r.participants, 0)} students`],
            ['Feedback', ov?.open ? 'Open' : 'Paused', ov?.allowExtra ? 'extra reviews allowed' : 'assigned reviews only'],
          ] as [string, string | number, string][]).map(([a, v, s]) => <div key={a} className="kpi" data-testid={`kpi-all-${a.toLowerCase().replace(/[^a-z]+/g, '-')}`}><span>{a}</span><strong>{v}</strong><small>{s}</small></div>)}
        </div>
        <div className="row">
          <button type="button" className={`btn${ov?.open ? ' danger' : ' primary'}`} onClick={() => act(() => backend.setOpen(!ov?.open), ov?.open ? 'Feedback paused for everyone.' : 'Feedback reopened.')} data-testid="toggle-open">{ov?.open ? <><Lock size={16} aria-hidden="true" /> Pause feedback submissions</> : <><Unlock size={16} aria-hidden="true" /> Reopen feedback</>}</button>
          <button type="button" className="btn" onClick={() => act(() => backend.setAllowExtra(!ov?.allowExtra), ov?.allowExtra ? 'Extra reviews turned off.' : 'Students who finished four may now leave extra reviews where slots remain.')} data-testid="toggle-extra">{ov?.allowExtra ? 'Stop extra (unassigned) reviews' : 'Allow extra reviews after four'}</button>
          <button type="button" className="btn" onClick={exportCompletion} data-testid="export-completion"><Download size={16} aria-hidden="true" /> Completion report (CSV)</button>
          <button type="button" className="btn" onClick={exportFeedback} data-testid="export-feedback"><Download size={16} aria-hidden="true" /> All comments (CSV)</button>
        </div>
      </section>

      {plan && (
        <section className="panel plan-preview" aria-labelledby="pp" data-testid="plan-preview">
          <h2 id="pp">{plan.mode === 'replace' ? 'New assignment plan' : 'Rebalanced plan'} · {COURSES[plan.course].code}</h2>
          <p>{plan.plan.ok ? <strong className="ok" data-testid="plan-ok">Every participating student gets {DEFAULT_SETTINGS.perStudent} different projects.</strong> : <strong className="warn" data-testid="plan-problem">This plan does NOT give everyone {DEFAULT_SETTINGS.perStudent} reviews: {plan.plan.unassigned} reviews could not be placed.</strong>}</p>
          {plan.plan.problems.map((p) => <p key={p} className="warn">{p}</p>)}
          <ul className="plan-facts">
            <li>Required reviews: <strong>{plan.plan.demand}</strong> · standard capacity {plan.plan.standardCapacity}</li>
            <li>Extra slots opened: <strong data-testid="plan-extra">{plan.plan.extraSlots}</strong> on <strong data-testid="plan-extra-projects">{plan.plan.projectsWithExtra}</strong> projects (max {Math.max(DEFAULT_SETTINGS.baseSlots, ...Object.values(plan.plan.capacities))} per project)</li>
            <li>Assignments: {plan.plan.assignments.filter((a) => a.status === 'pending').length} to do · {plan.plan.assignments.filter((a) => a.status === 'completed').length} already completed (kept)</li>
            <li>Incoming per project: {Math.min(...Object.values(plan.plan.targets))}–{Math.max(...Object.values(plan.plan.targets))} (balanced to within one)</li>
          </ul>
          {plan.plan.projectsWithExtra > 0 && <p className="hint">Projects with an extra slot: {Object.entries(plan.plan.capacities).filter(([, n]) => n > DEFAULT_SETTINGS.baseSlots).map(([id, n]) => `${name(id)} (${n})`).join(', ')}.</p>}
          <div className="row">
            <button type="button" className="btn primary" onClick={applyPlan} disabled={!plan.plan.assignments.length} data-testid="plan-apply">Save this plan</button>
            <button type="button" className="btn" onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </section>
      )}

      {COURSE_KEYS.map((c) => <CourseBlock key={c} course={c} state={state} roster={roster.students} onPlan={makePlan} onAct={act} />)}

      <section className="panel" aria-labelledby="mod">
        <h2 id="mod"><ShieldCheck size={20} aria-hidden="true" /> Moderation</h2>
        {!ov?.comments.length && <p className="hint">No comments yet.</p>}
        <ul className="mod-list">
          {(ov?.comments ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => (
            <li key={c.id} className={c.status} data-testid="mod-item">
              <div><strong>{c.reviewerName}</strong> → {name(c.projectId)} <small>{c.course} · {new Date(c.createdAt).toLocaleString()}{c.extra ? ' · extra review' : ''}{c.status === 'removed' ? ` · removed${c.removedReason ? `: ${c.removedReason}` : ''}` : ''}</small></div>
              <p>{composeComment({ reviewerName: c.reviewerName, pronouns: c.pronouns, enjoyed: c.enjoyed, suggestion: c.suggestion })}</p>
              {c.status === 'published'
                ? <button type="button" className="btn small danger" data-testid="mod-remove" onClick={() => { const reason = prompt('Reason for removing this comment (kept in the record):', 'Inappropriate'); if (reason !== null) act(() => backend.removeComment(c.id, reason), 'Comment removed — the slot is free again.') }}><Trash2 size={14} aria-hidden="true" /> Remove</button>
                : <button type="button" className="btn small" onClick={() => act(() => backend.restoreComment(c.id), 'Comment restored.')}><RotateCcw size={14} aria-hidden="true" /> Restore</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="links">
        <h2 id="links"><Link2 size={20} aria-hidden="true" /> Project links</h2>
        <p>Last full audit: {new Date(AUDIT.checkedAt).toLocaleString()} — every link opened in Chrome and checked for a visible page. Run <code>npm run audit-links</code> to re-verify (it updates the roster and <code>docs/FINAL_PROJECT_LINK_AUDIT.md</code>). Only verified links can receive reviews.</p>
        <div className="row">
          <button type="button" className="btn" onClick={recheck} data-testid="recheck-links"><RefreshCw size={16} aria-hidden="true" /> Quick reachability check (from this browser)</button>
        </div>
        {Object.keys(ping).length > 0 && <p className="hint" data-testid="recheck-result">Unreachable now: {Object.entries(ping).filter(([, v]) => v !== 'reachable').map(([id]) => name(id)).join(', ') || 'none'}. (A browser can only tell whether a site answers, not whether it renders — the audit script checks that.)</p>}
        <h3>Correct a project URL</h3>
        <div className="fix-row">
          <label className="field"><span>Student</span><select value={fix.id} onChange={(e) => setFix({ id: e.target.value, url: roster.students.find((s) => s.id === e.target.value)?.url ?? '' })} data-testid="fix-student"><option value="">Choose…</option>{roster.students.filter((s) => !s.hidden).map((s) => <option key={s.id} value={s.id}>{s.courseCode} · {s.fullName}</option>)}</select></label>
          <label className="field grow"><span>Interactive website URL</span><input value={fix.url} onChange={(e) => setFix({ ...fix, url: e.target.value })} placeholder="https://…" data-testid="fix-url" /></label>
        </div>
        {fix.id && <p className="hint">{classifyUrl(fix.url).status === 'valid' ? 'Looks like a valid public web address.' : classifyUrl(fix.url).note}</p>}
        <div className="row">
          <button type="button" className="btn" disabled={!fix.id} onClick={() => { const r = fixedRoster(); if (r) downloadFile('roster.json', JSON.stringify(publicRoster(r), null, 2) + '\n', 'application/json') }}><Download size={16} aria-hidden="true" /> Download corrected roster.json</button>
          {MODE === 'demo' && <button type="button" className="btn primary" disabled={!fix.id} onClick={() => { const r = fixedRoster(); if (r) { setRosterOverride(r); say('URL corrected in this browser (demo). It needs the link audit before it can receive reviews.') } }} data-testid="fix-apply">Apply in this browser (demo)</button>}
        </div>
        <p className="hint">To publish a correction: change the link in the workbook (or replace <code>src/data/roster.json</code> with the download), run <code>npm run import-roster</code>, <code>npm run audit-links</code>{MODE === 'live' ? ', npm run live-sql (paste into Supabase)' : ''}, then commit and push. A corrected link is “unchecked” until the audit verifies it.</p>
      </section>

      <section className="panel" aria-labelledby="ro">
        <h2 id="ro"><Upload size={20} aria-hidden="true" /> Import an updated roster</h2>
        <p>Choose an updated copy of the exam workbook (.xlsm or .xlsx) to preview what would change. It is read in your browser (macros are never run) and is not uploaded anywhere. Returning students keep their seat, creature and comments.</p>
        <label className="btn file-btn"><Upload size={16} aria-hidden="true" /> Choose workbook<input type="file" accept=".xlsx,.xlsm" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }} data-testid="roster-file" /></label>
        {imp && (
          <div className="import-preview" data-testid="import-preview">
            <p><strong>{imp.roster.students.length}</strong> students ({rosterCounts(imp.roster, '1101').total} in 1101 · {rosterCounts(imp.roster, '2241').total} in 2241) · {rosterCounts(imp.roster).valid} links · {imp.report.added.length} new · <span data-testid="import-changes">{imp.report.urlChanged.length}</span> link changes · {imp.report.removed.length} no longer listed.</p>
            {imp.report.urlChanged.map((id) => <p key={id} className="hint">{name(id)}: {roster.students.find((s) => s.id === id)?.url ?? '(none)'} → {imp.roster.students.find((s) => s.id === id)?.url ?? '(none)'}</p>)}
            {[...imp.problems, ...imp.warnings].map((w) => <p key={w} className="warn">{w}</p>)}
            <div className="row">
              <button type="button" className="btn" onClick={() => downloadFile('roster.json', JSON.stringify(publicRoster(imp.roster), null, 2) + '\n', 'application/json')}><Download size={16} aria-hidden="true" /> Download roster.json</button>
              {MODE === 'demo' && <button type="button" className="btn primary" onClick={() => { setRosterOverride(imp.roster); setImp(null); say('Updated roster applied in this browser (demo).') }} data-testid="apply-roster">Apply in this browser (demo)</button>}
            </div>
          </div>
        )}
        {rosterOverridden && <p className="warn">This browser is using an edited roster ({roster.source.file}). <button type="button" className="btn small" onClick={() => setRosterOverride(null)}>Go back to the published roster ({BUNDLED_ROSTER.students.length} students)</button></p>}
      </section>

      <section className="panel" aria-labelledby="priv">
        <h2 id="priv"><EyeOff size={20} aria-hidden="true" /> Public roster visibility</h2>
        <p>The public website shows, for every student: <strong>first and last name, course and section, and their interactive project link</strong>. It does <em>not</em> show emails, grades, access codes, personal-website links (1101 column D) or any other spreadsheet column. Comments are visible only to signed-in classmates and you (Live mode).</p>
        <p>To hide a student (their desk stays as a “Reserved seat”, with no name or link), tick them, download <code>visibility.json</code>, put it in <code>src/data/</code>, run <code>npm run import-roster</code>, then commit and push.</p>
        <details><summary>Choose students to hide ({hide.size} selected)</summary>
          <ul className="hide-list">{roster.students.map((s) => <li key={s.id}><label><input type="checkbox" checked={hide.has(s.id)} onChange={(e) => { const n = new Set(hide); if (e.target.checked) n.add(s.id); else n.delete(s.id); setHide(n) }} /> {s.hidden ? `Hidden (${s.id})` : s.fullName} <small>{s.sectionCode}</small></label></li>)}</ul>
        </details>
        <button type="button" className="btn" onClick={() => downloadFile('visibility.json', JSON.stringify({ hidden: [...hide].sort() }, null, 2) + '\n', 'application/json')}><Download size={16} aria-hidden="true" /> Download visibility.json</button>
        <p className="hint">Currently public: {roster.students.filter((s) => !s.hidden).length} students · {roster.students.filter((s) => isReviewable(s)).length} project links.</p>
      </section>

      {MODE === 'demo' && (
        <section className="panel" aria-labelledby="dm">
          <h2 id="dm">Demo test controls</h2>
          <p>Reset removes all demo comments, assignments and the demo sign-in stored in <em>this browser</em>. Nothing else is affected. A fresh fair plan is generated automatically.</p>
          {!confirmReset
            ? <button type="button" className="btn danger" onClick={() => setConfirmReset(true)} data-testid="reset-demo"><Trash2 size={16} aria-hidden="true" /> Reset demo data…</button>
            : <div className="row"><span className="warn"><AlertTriangle size={16} aria-hidden="true" /> Delete {state.comments.length} demo comments in this browser?</span><button type="button" className="btn danger" data-testid="reset-demo-confirm" onClick={async () => { resetDemoData(); setConfirmReset(false); await load(); await refresh(); say('Demo data reset.') }}>Yes, reset</button><button type="button" className="btn" onClick={() => setConfirmReset(false)}>Cancel</button></div>}
        </section>
      )}
    </main>
  )
}
