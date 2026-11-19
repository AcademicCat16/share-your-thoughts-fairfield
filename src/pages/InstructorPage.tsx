import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Upload, Trash2, RotateCcw, ShieldCheck, AlertTriangle, Link2Off, Lock, Unlock, LogOut, Mail } from 'lucide-react'
import urlCheck from '../data/url_check.json'
import { useApp, MODE, BUNDLED_ROSTER } from '../lib/app.tsx'
import { BackendError, type AdminOverview } from '../lib/backend.ts'
import { resetDemoData } from '../lib/demoBackend.ts'
import { completion, emptyState, DEFAULT_SETTINGS, type EngineState } from '../../shared/engine.ts'
import { composeComment } from '../../shared/compose.ts'
import { readWorkbook } from '../../shared/xlsx.ts'
import { parseRosterSheet, mergeRoster, rosterCounts, countProblems, type Roster, type MergeReport } from '../../shared/roster.ts'
import { CREATURES } from '../../shared/creatures.ts'
import { TARGET_REVIEWS_PER_STUDENT } from '../../shared/rules.ts'

type Check = { httpStatus: number; ok: boolean; error?: string; finalUrl?: string }
const CHECK = urlCheck as { checkedAt: string; checked: number; failed: number; results: Record<string, Check> }

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
    <form className="gate" onSubmit={async (e) => { e.preventDefault(); try { setMsg(await backend.instructorSignIn(email.trim())) } catch (x) { setMsg(x instanceof BackendError ? x.message : 'Could not send the link.') } }}>
      <Lock aria-hidden="true" /><h2>Instructor sign-in</h2>
      <p>The dashboard and moderation tools are protected. Enter the instructor email registered in the database and we'll send a one-time sign-in link.</p>
      <label className="field"><span>Instructor email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
      <button type="submit" className="btn primary"><Mail size={16} aria-hidden="true" /> Email me a sign-in link</button>
      {msg && <p className="hint" role="status">{msg}</p>}
    </form>
  )
}

export function InstructorPage() {
  const { backend, roster, rosterOverridden, setRosterOverride, refresh, say } = useApp()
  const [ready, setReady] = useState(MODE === 'demo')
  const [ov, setOv] = useState<AdminOverview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'under' | 'writers' | 'links'>('all')
  const [imp, setImp] = useState<{ roster: Roster; report: MergeReport; warnings: string[]; problems: string[] } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const load = useCallback(async () => {
    try { setOv(await backend.adminOverview()); setErr(null) } catch (e) { setErr(e instanceof BackendError ? e.message : 'Could not load the dashboard.') }
  }, [backend])
  useEffect(() => { if (ready) load() }, [ready, load])
  useEffect(() => (ready ? backend.subscribe(load) : undefined), [ready, backend, load])

  const state: EngineState = useMemo(() => ({ ...emptyState(), comments: (ov?.comments ?? []).map((c) => ({ ...c, removedReason: c.removedReason ?? undefined })) }), [ov])
  const cfg = useMemo(() => ({ ...DEFAULT_SETTINGS, maxPerProject: ov?.maxPerProject ?? 4, maxPerReviewer: ov?.maxPerReviewer ?? 4 }), [ov])
  const rep = useMemo(() => completion(state, roster.students, cfg, TARGET_REVIEWS_PER_STUDENT), [state, roster, cfg])
  const counts = rosterCounts(roster)
  const name = (id: string) => roster.students.find((s) => s.id === id)?.fullName ?? roster.removed.find((s) => s.id === id)?.fullName ?? id
  const brokenChecks = Object.entries(CHECK.results).filter(([, r]) => !r.ok)

  if (!ready) return <main className="instructor" id="main" tabIndex={-1}><h1>Instructor dashboard</h1><InstructorGate onReady={() => setReady(true)} /></main>

  const rows = rep.rows.filter((r) =>
    filter === 'all' ? true : filter === 'under' ? r.eligible && r.received < TARGET_REVIEWS_PER_STUDENT : filter === 'writers' ? r.written < TARGET_REVIEWS_PER_STUDENT : r.student.urlStatus !== 'valid' || CHECK.results[r.student.id]?.ok === false)
  const dist = (key: 'received' | 'written', only?: boolean) => [0, 1, 2, 3, 4].map((k) => rep.rows.filter((r) => (only ? r.eligible : true) && Math.min(4, r[key]) === k).length)
  const recDist = dist('received', true); const wrDist = dist('written')
  const published = (ov?.comments ?? []).filter((c) => c.status === 'published')
  const removed = (ov?.comments ?? []).filter((c) => c.status === 'removed')

  const exportFeedback = () => {
    const head = ['comment_id', 'status', 'project_student_id', 'project_student', 'project_section', 'reviewer_student_id', 'reviewer', 'pronouns', 'q1_enjoyed', 'q2_suggestion', 'published_paragraph', 'created_at', 'updated_at', 'removed_reason']
    const lines = (ov?.comments ?? []).map((c) => [c.id, c.status, c.projectId, name(c.projectId), roster.students.find((s) => s.id === c.projectId)?.sectionCode ?? '', c.reviewerId, c.reviewerName, c.pronouns ?? '', c.enjoyed, c.suggestion,
      composeComment({ reviewerName: c.reviewerName, pronouns: c.pronouns, enjoyed: c.enjoyed, suggestion: c.suggestion }), c.createdAt, c.updatedAt, c.removedReason ?? ''].map(csvCell).join(','))
    downloadFile(`feedback_records_${MODE}_${today()}.csv`, [head.join(','), ...lines].join('\n'))
  }
  const exportCompletion = () => {
    const head = ['student_id', 'first_name', 'last_name', 'section', 'url_status', 'project_url', 'reviews_received', 'reviews_written', 'received_target_met', 'written_target_met']
    const lines = rep.rows.map((r) => [r.student.id, r.student.firstName, r.student.lastName, r.student.sectionCode, r.student.urlStatus, r.student.url ?? '', r.eligible ? r.received : 'n/a (no project)', r.written, r.eligible ? r.received >= 4 : 'n/a', r.written >= 4].map(csvCell).join(','))
    downloadFile(`completion_status_${MODE}_${today()}.csv`, [head.join(','), ...lines].join('\n'))
  }
  const onImport = async (f: File) => {
    try {
      const parsed = parseRosterSheet(readWorkbook(new Uint8Array(await f.arrayBuffer())))
      const merged = mergeRoster(roster, parsed.rows, CREATURES.map((c) => c.id), { file: f.name, sheet: parsed.sheet, importedAt: new Date().toISOString() })
      setImp({ ...merged, warnings: parsed.warnings, problems: countProblems(merged.roster) })
    } catch (e) { say(e instanceof Error ? e.message : 'Could not read that workbook.') }
  }
  const act = async (fn: () => Promise<void>, ok: string) => { try { await fn(); await load(); await refresh(); say(ok) } catch (e) { say(e instanceof BackendError ? e.message : 'That did not work.') } }

  return (
    <main className="instructor" id="main" tabIndex={-1} data-testid="instructor">
      <header className="dash-head">
        <div>
          <h1>Instructor dashboard</h1>
          <p className="hint">{MODE === 'demo' ? 'Demo mode: these numbers describe test comments stored only in this browser. Test controls are available to anyone in demo mode because they only affect this browser.' : 'Live classroom data. Protected by instructor sign-in and server-side checks.'}</p>
        </div>
        {MODE === 'live' && <button type="button" className="btn ghost" onClick={() => backend.instructorSignOut().then(() => location.reload())}><LogOut size={16} aria-hidden="true" /> Sign out</button>}
      </header>
      {err && <p className="form-error" role="alert">{err}</p>}

      <section className="kpis" aria-label="Summary">
        {[
          ['Students', counts.total, `${counts.section01} in 2241-01 · ${counts.section02} in 2241-02`],
          ['Submitted projects', counts.valid, 'valid public links'],
          ['Missing projects', counts.missing, 'no link yet'],
          ['Invalid links', counts.invalid, 'not publicly reachable'],
          ['Comments', published.length, `${removed.length} removed`],
          ['Projects with 4', `${rep.projectsComplete} / ${rep.eligibleProjects}`, 'received target met'],
          ['Reviewers with 4', `${rep.reviewersComplete} / ${counts.total}`, 'written target met'],
        ].map(([k, v, s]) => <div key={k as string} className="kpi" data-testid={`kpi-${String(k).toLowerCase().replace(/\s+/g, '-')}`}><span>{k}</span><strong>{v}</strong><small>{s}</small></div>)}
      </section>

      <section className="panel shortfall" aria-labelledby="cr">
        <h2 id="cr"><AlertTriangle size={20} aria-hidden="true" /> Completion report</h2>
        <p>Target: {counts.total} students × {TARGET_REVIEWS_PER_STUDENT} = <strong>{rep.demand}</strong> reviews written. Open capacity: {rep.eligibleProjects} projects with valid links × {cfg.maxPerProject} = <strong>{rep.capacity}</strong> review slots.</p>
        {rep.structuralShortfall > 0
          ? <p className="warn" data-testid="structural-shortfall">With the current submissions, at most {rep.capacity} reviews can be written, so <strong>{rep.structuralShortfall}</strong> of the {rep.demand} cannot happen even if everyone participates. Not every student can reach 4 reviews written unless more projects arrive (or the per-project limit is raised).</p>
          : <p>There are enough review slots for everyone to write {TARGET_REVIEWS_PER_STUDENT}.</p>}
        <p>So far: <strong>{published.length}</strong> accepted reviews · {rep.projectsUnder.length} projects still under {TARGET_REVIEWS_PER_STUDENT} · {rep.reviewersUnder.length} students have written fewer than {TARGET_REVIEWS_PER_STUDENT}.</p>
        <div className="dists">
          {[['Reviews received (projects with links)', recDist], ['Reviews written (all students)', wrDist]].map(([title, d]) => (
            <figure key={title as string} className="dist">
              <figcaption>{title as string}</figcaption>
              {(d as number[]).map((n, k) => { const max = Math.max(1, ...(d as number[])); return (
                <div key={k} className="bar-row"><span>{k}{k === 4 ? '+' : ''}</span><div className="bar"><i style={{ width: `${(n / max) * 100}%` }} /></div><b>{n}</b></div>) })}
            </figure>
          ))}
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={exportCompletion} data-testid="export-completion"><Download size={16} aria-hidden="true" /> Export completion status (CSV)</button>
          <button type="button" className="btn" onClick={exportFeedback} data-testid="export-feedback"><Download size={16} aria-hidden="true" /> Export feedback records (CSV)</button>
        </div>
      </section>

      <section className="panel" aria-labelledby="st">
        <h2 id="st">Students</h2>
        <div className="seg" role="group" aria-label="Filter students">
          {([['all', 'Everyone'], ['under', 'Projects under 4 reviews'], ['writers', 'Students under 4 written'], ['links', 'Broken / missing links']] as const).map(([k, l]) =>
            <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)} data-testid={`dash-filter-${k}`}>{l}</button>)}
        </div>
        <div className="table-wrap">
          <table className="dash-table" data-testid="student-table">
            <thead><tr><th>Student</th><th>Section</th><th>Project link</th><th>Received</th><th>Written</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const chk = CHECK.results[r.student.id]
                return (
                  <tr key={r.student.id}>
                    <td>{r.student.fullName}<small className="id">{r.student.id}</small></td>
                    <td>{r.student.sectionCode.replace('MKTG ', '')}</td>
                    <td className={`url ${r.student.urlStatus}`}>
                      {r.student.urlStatus === 'valid' ? <a href={r.student.url!} target="_blank" rel="noopener noreferrer">{r.student.url!.replace(/^https?:\/\//, '').slice(0, 48)}</a> : <span>{r.student.urlStatus === 'missing' ? 'Missing' : 'Invalid'}{r.student.url ? `: ${r.student.url.slice(0, 40)}…` : ''}</span>}
                      {r.student.urlStatus === 'invalid' && <small>{r.student.urlNote}</small>}
                      {chk && !chk.ok && <small className="bad"><Link2Off size={12} aria-hidden="true" /> did not load at last check ({chk.error ?? `HTTP ${chk.httpStatus}`})</small>}
                    </td>
                    <td>{r.eligible ? `${r.received} / ${cfg.maxPerProject}` : '—'}</td>
                    <td>{r.written} / {TARGET_REVIEWS_PER_STUDENT}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="hint">Link check: {CHECK.checked} valid links requested on {new Date(CHECK.checkedAt).toLocaleString()} — {CHECK.failed} did not load{brokenChecks.length ? `: ${brokenChecks.map(([id]) => name(id)).join(', ')}` : ''}. Re-run with <code>npm run check-urls</code>.</p>
      </section>

      <section className="panel" aria-labelledby="mod">
        <h2 id="mod"><ShieldCheck size={20} aria-hidden="true" /> Moderation</h2>
        {!ov?.comments.length && <p className="hint">No comments yet.</p>}
        <ul className="mod-list">
          {(ov?.comments ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => (
            <li key={c.id} className={c.status} data-testid="mod-item">
              <div><strong>{c.reviewerName}</strong> → {name(c.projectId)} <small>{new Date(c.createdAt).toLocaleString()}{c.status === 'removed' ? ` · removed${c.removedReason ? `: ${c.removedReason}` : ''}` : ''}</small></div>
              <p>{composeComment({ reviewerName: c.reviewerName, pronouns: c.pronouns, enjoyed: c.enjoyed, suggestion: c.suggestion })}</p>
              {c.status === 'published'
                ? <button type="button" className="btn small danger" data-testid="mod-remove" onClick={() => { const reason = prompt('Reason for removing this comment (kept in the record):', 'Inappropriate'); if (reason !== null) act(() => backend.removeComment(c.id, reason), 'Comment removed — the slot is free again.') }}><Trash2 size={14} aria-hidden="true" /> Remove</button>
                : <button type="button" className="btn small" onClick={() => act(() => backend.restoreComment(c.id), 'Comment restored.')}><RotateCcw size={14} aria-hidden="true" /> Restore</button>}
            </li>
          ))}
        </ul>
        <div className="row">
          <button type="button" className="btn" onClick={() => act(() => backend.setOpen(!ov?.open), ov?.open ? 'Feedback closed.' : 'Feedback opened.')}>{ov?.open ? <><Lock size={16} aria-hidden="true" /> Close feedback</> : <><Unlock size={16} aria-hidden="true" /> Open feedback</>}</button>
        </div>
      </section>

      <section className="panel" aria-labelledby="ro">
        <h2 id="ro"><Upload size={20} aria-hidden="true" /> Update the roster</h2>
        <p>Choose an updated copy of the exam workbook to preview what would change. Returning students keep their seat, creature and comments; only links are refreshed. The file is read in your browser and is not uploaded anywhere.</p>
        <label className="btn file-btn"><Upload size={16} aria-hidden="true" /> Choose workbook (.xlsx)<input type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }} data-testid="roster-file" /></label>
        {imp && (
          <div className="import-preview" data-testid="import-preview">
            <p><strong>{rosterCounts(imp.roster).total}</strong> students · {rosterCounts(imp.roster).valid} valid links · {imp.report.added.length} new · {imp.report.urlChanged.length} link changes · {imp.report.removed.length} no longer listed.</p>
            {imp.report.urlChanged.map((id) => <p key={id} className="hint">{name(id)}: {roster.students.find((s) => s.id === id)?.url ?? '(none)'} → {imp.roster.students.find((s) => s.id === id)?.url ?? '(none)'}</p>)}
            {[...imp.problems, ...imp.warnings].map((w) => <p key={w} className="warn">{w}</p>)}
            <div className="row">
              <button type="button" className="btn" onClick={() => downloadFile('roster.json', JSON.stringify(imp.roster, null, 2) + '\n', 'application/json')}><Download size={16} aria-hidden="true" /> Download roster.json</button>
              {MODE === 'demo' && <button type="button" className="btn primary" onClick={() => { setRosterOverride(imp.roster); setImp(null); say('Updated roster applied in this browser (demo).') }} data-testid="apply-roster">Apply in this browser (demo)</button>}
            </div>
            <p className="hint">To publish it for everyone: run <code>npm run import-roster</code> with the new workbook in the project folder (or replace <code>src/data/roster.json</code> with the download), commit and push. {MODE === 'live' ? 'Then run npm run live-sql and paste supabase/seed/roster_upsert.sql into the Supabase SQL editor.' : ''}</p>
          </div>
        )}
        {rosterOverridden && <p className="warn">This browser is using an imported roster ({roster.source.file}, {new Date(roster.source.importedAt).toLocaleString()}). <button type="button" className="btn small" onClick={() => setRosterOverride(null)}>Go back to the published roster ({BUNDLED_ROSTER.students.length} students)</button></p>}
      </section>

      {MODE === 'demo' && (
        <section className="panel" aria-labelledby="dm">
          <h2 id="dm">Demo test controls</h2>
          <p>Reset removes all demo comments, reservations and the demo sign-in stored in <em>this browser</em>. Nothing else is affected.</p>
          {!confirmReset
            ? <button type="button" className="btn danger" onClick={() => setConfirmReset(true)} data-testid="reset-demo"><Trash2 size={16} aria-hidden="true" /> Reset demo data…</button>
            : <div className="row"><span className="warn">Delete {state.comments.length} demo comments in this browser?</span><button type="button" className="btn danger" data-testid="reset-demo-confirm" onClick={async () => { resetDemoData(); setConfirmReset(false); await load(); await refresh(); say('Demo data reset.') }}>Yes, reset</button><button type="button" className="btn" onClick={() => setConfirmReset(false)}>Cancel</button></div>}
        </section>
      )}
    </main>
  )
}
