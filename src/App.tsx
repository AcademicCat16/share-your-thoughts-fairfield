import { useEffect, useMemo, useState } from 'react'
import { BookOpen, School, ClipboardList, Volume2, VolumeX, LogOut, Info } from 'lucide-react'
import { AppProvider, useApp, go, MODE, LIVE_MISCONFIGURED, makeDemoBackend } from './lib/app.tsx'
import type { Backend } from './lib/backend.ts'
import { ClassroomPage } from './pages/ClassroomPage.tsx'
import { GuidePage } from './pages/GuidePage.tsx'
import { InstructorPage } from './pages/InstructorPage.tsx'
import { CreatureSvg } from './components/CreatureSvg.tsx'
import { Modal } from './components/Modal.tsx'
import { SignInPanel } from './components/SignIn.tsx'
import { CREATURES } from '../shared/creatures.ts'
import { MAX_REVIEWS_PER_REVIEWER } from '../shared/rules.ts'
import { startAmbient, stopAmbient } from './lib/sound.ts'

const WELCOME_KEY = 'fic.welcomed.v1'

function Welcome({ onEnter }: { onEnter: () => void }) {
  const { reducedMotion } = useApp()
  const parade = useMemo(() => [0, 7, 13, 21, 28, 36, 42, 50, 55].map((i) => CREATURES[i]).filter(Boolean), [])
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" data-testid="welcome">
      <div className="leaves" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <span key={i} style={{ left: `${(i * 7.3) % 100}%`, animationDelay: `${(i * 0.7) % 6}s`, animationDuration: `${7 + (i % 5)}s` }}>{i % 3 ? '🍂' : '🍁'}</span>)}</div>
      <div className="welcome-card">
        <p className="eyebrow">Fairfield Interactive World</p>
        <h1 id="welcome-title" className="floating-title">The Feedback Classroom</h1>
        <p className="welcome-sub">A Thanksgiving peer-feedback adventure for MKTG 2241 — visit your classmates’ interactive worlds and leave them something kind and helpful.</p>
        <div className="parade" aria-hidden="true">{parade.map((c, i) => <span key={c.id} style={{ animationDelay: `${i * 0.12}s` }}><CreatureSvg spec={c} size={78} animate={!reducedMotion} /></span>)}</div>
        <div className="row center">
          <button type="button" className="btn primary big" onClick={onEnter} data-testid="enter-classroom" autoFocus>Enter the Classroom</button>
          <button type="button" className="btn big" onClick={() => { onEnter(); go('guide') }}>How it works</button>
        </div>
        {MODE === 'demo' && <p className="demo-note">Demo Mode — comments are stored only in this browser.</p>}
      </div>
    </div>
  )
}

function Header() {
  const { route, me, backend, refresh, say } = useApp()
  const [sound, setSound] = useState(false)
  const [signin, setSignin] = useState(false)
  const toggleSound = async () => { if (sound) { stopAmbient(); setSound(false) } else { await startAmbient(); setSound(true) } }
  const nav: [typeof route, string, typeof School][] = [['classroom', 'Classroom', School], ['guide', 'Student Guide', BookOpen], ['instructor', 'Instructor', ClipboardList]]
  return (
    <header className="app-header">
      <a href="#/" className="brand" onClick={(e) => { e.preventDefault(); go('classroom') }}>
        <span className="brand-mark" aria-hidden="true">🍂</span>
        <span><strong>The Feedback Classroom</strong><small>Fairfield Interactive World</small></span>
      </a>
      <nav aria-label="Main">
        {nav.map(([r, label, Icon]) => (
          <a key={r} href={r === 'classroom' ? '#/' : `#/${r}`} className={route === r ? 'active' : ''} aria-current={route === r ? 'page' : undefined}><Icon size={17} aria-hidden="true" /> <span>{label}</span></a>
        ))}
      </nav>
      <div className="header-right">
        {me ? (
          <div className="me-chip" data-testid="me-chip">
            <span className="progress-ring" style={{ '--p': Math.min(1, me.reviewsWritten / MAX_REVIEWS_PER_REVIEWER) } as React.CSSProperties} aria-hidden="true" />
            <span><strong>{me.fullName}</strong><small data-testid="my-progress">Your reviews: {me.reviewsWritten} / {MAX_REVIEWS_PER_REVIEWER}</small></span>
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
  const [welcome, setWelcome] = useState(() => { try { return !sessionStorage.getItem(WELCOME_KEY) && !new URLSearchParams(location.search).has('nowelcome') } catch { return true } })
  const enter = () => { try { sessionStorage.setItem(WELCOME_KEY, '1') } catch { /* ignore */ } setWelcome(false) }
  useEffect(() => { document.title = route === 'guide' ? 'Student Guide · The Feedback Classroom' : route === 'instructor' ? 'Instructor · The Feedback Classroom' : 'The Feedback Classroom · Fairfield Interactive World' }, [route])
  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }}>Skip to content</a>
      {MODE === 'demo' && (
        <div className="mode-banner" role="note" data-testid="demo-banner">
          <Info size={16} aria-hidden="true" /> <strong>Demo Mode — Comments are stored only in this browser.</strong> <span>Nobody else can see them. The shared classroom version is not switched on yet.</span>
          {LIVE_MISCONFIGURED && <span className="warn"> (Live mode was requested but is not configured, so the site stayed in Demo Mode.)</span>}
        </div>
      )}
      <Header />
      {route === 'classroom' && <main id="main" tabIndex={-1} className="main-classroom"><h1 className="sr-only">The Feedback Classroom</h1><ClassroomPage /></main>}
      {route === 'guide' && <GuidePage />}
      {route === 'instructor' && <InstructorPage />}
      {toast && <div className="toast" role="status" aria-live="polite" data-testid="toast">{toast}</div>}
      {welcome && route === 'classroom' && <Welcome onEnter={enter} />}
    </div>
  )
}

export default function App() {
  // The Supabase client is only downloaded in Live mode.
  const [backend, setBackend] = useState<Backend | null>(() => (MODE === 'demo' ? makeDemoBackend() : null))
  useEffect(() => {
    if (MODE !== 'live') return
    import('./lib/liveBackend.ts').then((m) => setBackend(m.createLiveBackend(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)))
  }, [])
  if (!backend) return <p className="loading-3d">Connecting to the classroom…</p>
  return <AppProvider backend={backend}><Shell /></AppProvider>
}
