import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Search, Compass, RotateCcw, RotateCw, ZoomIn, ZoomOut, Home, Box, LayoutGrid, Users, X, Shuffle, ArrowLeft } from 'lucide-react'
import { useApp, CREATURE_BY_ID, go, slotsOf, PENDING_OPEN_KEY, markExplored, readExplored } from '../lib/app.tsx'
import { BackendError } from '../lib/backend.ts'
import { Classroom2D } from '../components/Classroom2D.tsx'
import { ProfileModal } from '../components/ProfileModal.tsx'
import { Modal } from '../components/Modal.tsx'
import { SignInPanel } from '../components/SignIn.tsx'
import { QuestPanel } from '../components/QuestPanel.tsx'
import { COURSES, isReviewable, type CourseKey, type SectionKey } from '../../shared/roster.ts'
import type { CameraCmd } from '../three/Classroom3D.tsx'

const Classroom3D = lazy(() => import('../three/Classroom3D.tsx'))
const VIEW_KEY = 'fic.view.v1'

export function hasWebGL(): boolean {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
}
function initialView(): '3d' | '2d' {
  const q = new URLSearchParams(location.search).get('view')
  if (q === '2d' || q === '3d') return q === '3d' && !hasWebGL() ? '2d' : q
  try { const v = localStorage.getItem(VIEW_KEY); if (v === '2d' || v === '3d') return v === '3d' && !hasWebGL() ? '2d' : v } catch { /* ignore */ }
  return hasWebGL() && window.innerWidth >= 768 ? '3d' : '2d'
}

export function ClassroomPage({ course }: { course: CourseKey }) {
  const { students: all, status, selected, select, reducedMotion, me, backend, say, quest } = useApp()
  const info = COURSES[course]
  const students = useMemo(() => all.filter((s) => s.course === course), [all, course])
  const [view, setView] = useState<'3d' | '2d'>(initialView)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<'all' | SectionKey>('all')
  const [cmd, setCmd] = useState<CameraCmd | null>(null)
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [signin, setSignin] = useState(false)
  const [finding, setFinding] = useState(false)
  const webgl = useMemo(hasWebGL, [])
  const camera = (kind: CameraCmd['kind'], id?: string) => setCmd((c) => ({ kind, id, n: (c?.n ?? 0) + 1 }))

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch { /* ignore */ } }, [view])
  useEffect(() => { setSection('all'); setQuery('') }, [course])
  // A "Find My Next Review" from the other classroom lands here with the desk to open.
  useEffect(() => {
    try {
      const id = sessionStorage.getItem(PENDING_OPEN_KEY)
      if (id && students.some((s) => s.id === id)) { sessionStorage.removeItem(PENDING_OPEN_KEY); open(id) }
    } catch { /* ignore */ }
  }, [course]) // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => students.filter((s) =>
    (section === 'all' || s.section === section) &&
    (!q || (!s.hidden && s.fullName.toLowerCase().includes(q)) || (isReviewable(s) && CREATURE_BY_ID.get(s.creatureId)?.name.toLowerCase().includes(q)))), [students, section, q])
  const highlight = useMemo(() => (q || section !== 'all' ? new Set(matches.map((s) => s.id)) : null), [matches, q, section])
  const visible2d = view === '2d' && section !== 'all' ? students.filter((s) => s.section === section) : students

  useEffect(() => { if (q && matches.length === 1 && view === '3d') camera('focus', matches[0].id) }, [q, matches, view])

  function open(id: string) { select(id); markExplored(id); if (view === '3d') camera('focus', id) }

  const findNext = async (signedIn = false) => {
    if (!me && !signedIn) { setSignin(true); return }
    setFinding(true)
    try {
      const id = await backend.nextReview()
      if (!id) { say(quest.some((x) => x.status === 'pending') ? 'Could not find your next review right now.' : 'Your Feedback Quest is complete — keep exploring other worlds!'); return }
      const target = all.find((s) => s.id === id)
      if (target && target.course !== course) {
        try { sessionStorage.setItem(PENDING_OPEN_KEY, id) } catch { /* ignore */ }
        go(target.course)
      } else open(id)
    } catch (e) { say(e instanceof BackendError ? e.message : 'Could not find your next review right now.') } finally { setFinding(false) }
  }
  /** Unrestricted discovery: any working project in this classroom (full ones included), unexplored first. */
  const exploreAnother = () => {
    const pool = students.filter((s) => isReviewable(s) && s.id !== selected && s.id !== me?.studentId)
    if (!pool.length) { say('No other worlds to explore here yet.'); return }
    const seen = new Set(readExplored())
    const fresh = pool.filter((s) => !seen.has(s.id))
    const from = fresh.length ? fresh : pool
    open(from[Math.floor(Math.random() * from.length)].id)
  }

  const selectedStudent = students.find((s) => s.id === selected) ?? null
  const tipStudent = tip ? students.find((s) => s.id === tip.id) : null
  const tipCreature = tipStudent ? CREATURE_BY_ID.get(tipStudent.creatureId) : null
  const tipSlots = tipStudent ? slotsOf(status, tipStudent.id) : null

  return (
    <div className={`classroom-page course-${course}`}>
      <div className="room-head">
        <button type="button" className="btn small ghost home-btn" onClick={() => go('home')} data-testid="back-home"><ArrowLeft size={16} aria-hidden="true" /> All classrooms</button>
        <h1 className="room-title"><span>{info.title}</span> <small>{info.code} · {students.length} students</small></h1>
        {!me && <QuestPanel course={course} onSignIn={() => setSignin(true)} />}
      </div>
      {me && <QuestPanel course={course} onSignIn={() => setSignin(true)} />}
      <div className="toolbar" role="toolbar" aria-label="Classroom tools">
        <div className="search">
          <Search size={18} aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a classmate or creature…" aria-label="Search for a student" data-testid="search" />
          {query && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button>}
        </div>
        {info.sections.length > 1 && (
          <div className="seg" role="group" aria-label="Filter by section">
            {[{ key: 'all' as const, label: 'Both Sections' }, ...info.sections.map((s) => ({ key: s.key, label: s.label }))].map((s) => (
              <button key={s.key} type="button" className={section === s.key ? 'on' : ''} aria-pressed={section === s.key} onClick={() => setSection(s.key)} data-testid={`filter-${s.key}`}>{s.label}</button>
            ))}
          </div>
        )}
        <button type="button" className="btn primary find" onClick={() => findNext()} disabled={finding} data-testid="find-next"><Compass size={18} aria-hidden="true" /> {finding ? 'Looking…' : 'Find My Next Review'}</button>
        <button type="button" className="btn explore-another" onClick={exploreAnother} data-testid="explore-another"><Shuffle size={18} aria-hidden="true" /> Explore Another World</button>
        <div className="seg" role="group" aria-label="View">
          <button type="button" className={view === '3d' ? 'on' : ''} aria-pressed={view === '3d'} onClick={() => setView('3d')} disabled={!webgl} title={webgl ? '3D classroom' : '3D is not available on this device'} data-testid="view-3d"><Box size={16} aria-hidden="true" /> 3D</button>
          <button type="button" className={view === '2d' ? 'on' : ''} aria-pressed={view === '2d'} onClick={() => setView('2d')} data-testid="view-2d"><LayoutGrid size={16} aria-hidden="true" /> 2D</button>
        </div>
        <button type="button" className="btn ghost" onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen} aria-controls="seat-list" data-testid="seat-list-toggle"><Users size={18} aria-hidden="true" /> All seats</button>
      </div>

      {(q || section !== 'all') && (
        <p className="match-line" aria-live="polite" data-testid="match-count">{matches.length} {matches.length === 1 ? 'seat matches' : 'seats match'}{q ? ` “${query.trim()}”` : ''}{section !== 'all' ? ` in ${info.sections.find((s) => s.key === section)?.label}` : ''}.
          {q && matches.length > 0 && matches.length <= 6 && <span className="match-chips">{matches.map((s) => <button key={s.id} type="button" className="chip" onClick={() => open(s.id)}>{s.fullName}</button>)}</span>}
        </p>
      )}

      <div className={`stage ${view}`}>
        {view === '3d' && webgl ? (
          <div className="stage3d" data-testid="classroom-3d">
            <Suspense fallback={<div className="loading-3d"><span className="loader" aria-hidden="true" /> Setting up the classroom…</div>}>
              <Classroom3D key={course} course={course} students={students} status={status} selected={selected} highlight={highlight} animate={!reducedMotion} paused={!!selected} cmd={cmd}
                onPick={open} onHover={(id, x, y) => setTip(id ? { id, x, y } : null)} />
            </Suspense>
            <div className="cam-controls" role="group" aria-label="Camera">
              <button type="button" onClick={() => camera('zoomIn')} aria-label="Zoom in" data-testid="cam-zoom-in"><ZoomIn size={18} /></button>
              <button type="button" onClick={() => camera('zoomOut')} aria-label="Zoom out" data-testid="cam-zoom-out"><ZoomOut size={18} /></button>
              <button type="button" onClick={() => camera('rotL')} aria-label="Rotate left" data-testid="cam-rot-l"><RotateCcw size={18} /></button>
              <button type="button" onClick={() => camera('rotR')} aria-label="Rotate right" data-testid="cam-rot-r"><RotateCw size={18} /></button>
              <button type="button" onClick={() => camera('reset')} aria-label="Reset camera" data-testid="cam-reset"><Home size={18} /></button>
            </div>
            <p className="cam-help" aria-hidden="true">Drag to rotate · scroll or pinch to zoom · right-drag or two fingers to pan · click a creature</p>
            {tipStudent && tipSlots && (
              <div className="tooltip" style={{ left: tip!.x, top: tip!.y }} role="status">
                <strong>{tipStudent.hidden ? 'Reserved seat' : tipStudent.fullName}</strong>
                <span>{tipStudent.sectionCode}</span>
                <span>{isReviewable(tipStudent) ? `${tipCreature?.name ?? ''} · ${tipSlots.full ? 'all slots full · still explorable' : `${tipSlots.published}/${tipSlots.capacity} feedback slots`}` : 'Project on its way'}</span>
              </div>
            )}
          </div>
        ) : (
          <Classroom2D course={course} students={visible2d} highlight={q ? highlight : null} onPick={open} />
        )}
        <aside id="seat-list" className={`seat-list${listOpen ? ' open' : ''}`} aria-label="All seats" hidden={!listOpen}>
          <div className="seat-list-head"><h2>All seats</h2><button type="button" className="icon-btn" onClick={() => setListOpen(false)} aria-label="Close seat list"><X size={18} /></button></div>
          <ul>
            {matches.map((s) => {
              const sl = slotsOf(status, s.id)
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => open(s.id)} className={isReviewable(s) ? '' : 'empty'}>
                    <span>{s.hidden ? 'Reserved seat' : s.fullName}</span>
                    <small>{s.sectionCode.replace('MKTG ', '')} · {isReviewable(s) ? (sl.full ? 'slots full' : `${sl.published}/${sl.capacity}`) : 'empty seat'}</small>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>
      </div>

      {selectedStudent && <ProfileModal key={selectedStudent.id} student={selectedStudent} onClose={() => select(null)} onExploreAnother={exploreAnother} onFindNext={() => { select(null); findNext() }} />}
      {signin && <Modal title="Choose your name" onClose={() => setSignin(false)} className="small-modal"><SignInPanel onDone={() => { setSignin(false); findNext(true) }} /></Modal>}
    </div>
  )
}
