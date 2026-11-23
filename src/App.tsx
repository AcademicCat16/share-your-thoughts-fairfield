import { useEffect, useState } from 'react'
import { BookOpen, ClipboardList, Volume2, VolumeX, LogOut, Info, Store, MonitorSmartphone, Home } from 'lucide-react'
import { AppProvider, useApp, go, routeHref, isCourseRoute, MODE, LIVE_MISCONFIGURED, makeDemoBackend, type Route } from './lib/app.tsx'
import type { Backend } from './lib/backend.ts'
import { ClassroomPage } from './pages/ClassroomPage.tsx'
import { HomePage, HOME_TITLE } from './pages/HomePage.tsx'
import { GuidePage } from './pages/GuidePage.tsx'
import { InstructorPage } from './pages/InstructorPage.tsx'
import { Modal } from './components/Modal.tsx'
import { SignInPanel } from './components/SignIn.tsx'
import { COURSES } from '../shared/roster.ts'
import { startAmbient, stopAmbient } from './lib/sound.ts'

function Header() {
  const { route, me, backend, refresh, say } = useApp()
  const [sound, setSound] = useState(false)
  const [signin, setSignin] = useState(false)
  const toggleSound = async () => { if (sound) { stopAmbient(); setSound(false) } else { await startAmbient(); setSound(true) } }
  const nav: [Route, string, typeof Home][] = [
    ['home', 'Home', Home], ['1101', 'Principles · 1101', Store], ['2241', 'Digital · 2241', MonitorSmartphone],
    ['guide', 'Student Guide', BookOpen], ['instructor', 'Instructor', ClipboardList],
  ]
  return (
    <header className="app-header">
      <a href="#/" className="brand" onClick={(e) => { e.preventDefault(); go('home') }}>
        <span className="brand-mark" aria-hidden="true">🍂</span>
        <span><strong>{HOME_TITLE}</strong><small>Peer feedback · Thanksgiving 2026</small></span>
      </a>
      <nav aria-label="Main">
        {nav.map(([r, label, Icon]) => (
          <a key={r} href={routeHref(r)} className={route === r ? 'active' : ''} aria-current={route === r ? 'page' : undefined} aria-label={label} title={label} data-testid={`nav-${r}`}><Icon size={17} aria-hidden="true" /> <span>{label}</span></a>
        ))}
      </nav>
      <div className="header-right">
        {me ? (
          <div className="me-chip" data-testid="me-chip">
            <span className="progress-ring" style={{ '--p': Math.min(1, me.completed / me.required) } as React.CSSProperties} aria-hidden="true" />
            <span><strong>{me.fullName}</strong><small data-testid="my-progress">Your Feedback Quest: {Math.min(me.completed, me.required)} / {me.required} completed</small></span>
            <button type="button" className="icon-btn" onClick={async () => { await backend.signOut(); await refresh(); say('Signed out.') }} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
          </div>
        ) : (
          <button type="button" className="btn small" onClick={() => setSignin(true)} data-testid="header-signin">{MODE === 'live' ? 'Sign in' : 'Choose who you are (demo)'}</button>
        )}
        <button type="button" className="icon-btn" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Turn ambient sound off' : 'Turn ambient sound on'} title="Ambient sound (off by default)" data-testid="sound-toggle">{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
      </div>
      {signin && <Modal title="Sign in" onClose={() => setSignin(false)} className="small-modal"><SignInPanel onDone={() => setSignin(false)} /></Modal>}
    </header>
  )
}

function Shell() {
  const { route, toast } = useApp()
  useEffect(() => {
    const t = isCourseRoute(route) ? `${COURSES[route].title} classroom` : route === 'guide' ? 'Student Guide' : route === 'instructor' ? 'Instructor' : ''
    document.title = t ? `${t} · ${HOME_TITLE}` : HOME_TITLE
    window.scrollTo(0, 0)
  }, [route])
  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }}>Skip to content</a>
      {MODE === 'demo' && (
        <div className="mode-banner" role="note" data-testid="demo-banner">
          <Info size={16} aria-hidden="true" /> <strong>Demo Mode — Comments are stored only in this browser.</strong> <span>Nobody else can see them. Shared classroom commenting is not switched on yet.</span>
          {LIVE_MISCONFIGURED && <span className="warn"> (Live mode was requested but is not configured, so the site stayed in Demo Mode.)</span>}
        </div>
      )}
      <Header />
      {route === 'home' && <HomePage />}
      {isCourseRoute(route) && <main id="main" tabIndex={-1} className="main-classroom" key={route}><ClassroomPage course={route} /></main>}
      {route === 'guide' && <GuidePage />}
      {route === 'instructor' && <InstructorPage />}
      {toast && <div className="toast" role="status" aria-live="polite" data-testid="toast">{toast}</div>}
    </div>
  )
}

export default function App() {
  // The Supabase client is only downloaded in Live mode.
  const [backend, setBackend] = useState<Backend | null>(() => (MODE === 'demo' ? makeDemoBackend() : null))
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (MODE !== 'live') return
    import('./lib/liveBackend.ts')
      .then((m) => setBackend(m.createLiveBackend(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)))
      .catch(() => setFailed(true))
  }, [])
  if (failed) return <p className="loading-3d">Could not load the classroom. Please refresh the page.</p>
  if (!backend) return <p className="loading-3d"><span className="loader" aria-hidden="true" /> Connecting to the classroom…</p>
  return <AppProvider backend={backend}><Shell /></AppProvider>
}
