import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import rosterJson from '../data/roster.json'
import type { Roster, Student } from '../../shared/roster.ts'
import { CREATURES } from '../../shared/creatures.ts'
import type { CreatureSpec } from '../../shared/creatureTypes.ts'
import type { Backend, Me } from './backend.ts'
import { createDemoBackend } from './demoBackend.ts'

export const BUNDLED_ROSTER = rosterJson as Roster
export const ROSTER_OVERRIDE_KEY = 'fic.demo.roster.v1'
export const CREATURE_BY_ID = new Map<string, CreatureSpec>(CREATURES.map((c) => [c.id, c]))

const env = import.meta.env
const wantsLive = env.VITE_FEEDBACK_MODE === 'live'
const liveConfigured = !!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY)
/** Live mode only when explicitly requested AND configured. Never switches silently. */
export const MODE: 'demo' | 'live' = wantsLive && liveConfigured ? 'live' : 'demo'
export const LIVE_MISCONFIGURED = wantsLive && !liveConfigured

function loadRoster(): { roster: Roster; overridden: boolean } {
  if (MODE === 'demo') {
    try {
      const raw = localStorage.getItem(ROSTER_OVERRIDE_KEY)
      if (raw) { const r = JSON.parse(raw) as Roster; if (r?.schema === 'fairfield-roster' && Array.isArray(r.students)) return { roster: r, overridden: true } }
    } catch { /* ignore */ }
  }
  return { roster: BUNDLED_ROSTER, overridden: false }
}

export type Route = 'classroom' | 'guide' | 'instructor'
const parseRoute = (): Route => {
  const h = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0]
  return h === 'guide' || h === 'instructor' ? h : 'classroom'
}
export const go = (r: Route) => { location.hash = r === 'classroom' ? '#/' : `#/${r}` }

export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

interface Ctx {
  backend: Backend
  roster: Roster
  rosterOverridden: boolean
  setRosterOverride(r: Roster | null): void
  students: Student[]
  byId: Map<string, Student>
  counts: Record<string, number>
  me: Me | null
  refresh(): Promise<void>
  route: Route
  selected: string | null
  select(id: string | null): void
  /** bump to tell views to fly the camera to a desk */
  focus: { id: string; n: number } | null
  focusOn(id: string): void
  reducedMotion: boolean
  toast: string | null
  say(msg: string): void
}
const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  const [{ roster, overridden }, setR] = useState(loadRoster)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [me, setMe] = useState<Me | null>(null)
  const [route, setRoute] = useState<Route>(parseRoute)
  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<Ctx['focus']>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [reducedMotion, setRM] = useState(prefersReducedMotion)
  const rosterRef = useRef(roster); rosterRef.current = roster
  const toastTimer = useRef<number>(0)

  const refresh = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([backend.counts(), backend.me()])
      setCounts(c); setMe(m)
    } catch { /* surfaced where the user acts */ }
  }, [backend])

  useEffect(() => { refresh(); return backend.subscribe(refresh) }, [backend, refresh])
  useEffect(() => {
    const on = () => setRoute(parseRoute())
    window.addEventListener('hashchange', on)
    if (new URLSearchParams(location.search).get('instructor') === '1') go('instructor')
    return () => window.removeEventListener('hashchange', on)
  }, [])
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setRM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const value = useMemo<Ctx>(() => ({
    backend, roster, rosterOverridden: overridden,
    setRosterOverride(r) {
      try { if (r) localStorage.setItem(ROSTER_OVERRIDE_KEY, JSON.stringify(r)); else localStorage.removeItem(ROSTER_OVERRIDE_KEY) } catch { /* ignore */ }
      setR(r ? { roster: r, overridden: true } : { roster: BUNDLED_ROSTER, overridden: false })
    },
    students: roster.students,
    byId: new Map(roster.students.map((s) => [s.id, s])),
    counts, me, refresh, route, selected,
    select: setSelected,
    focus,
    focusOn: (id) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 })),
    reducedMotion,
    toast,
    say(msg) { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 4000) },
  }), [backend, roster, overridden, counts, me, refresh, route, selected, focus, reducedMotion, toast])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp outside AppProvider')
  return c
}

/** Demo backend needs the *current* roster (which the instructor may override in demo). */
export function makeDemoBackend() {
  return createDemoBackend(() => loadRoster().roster.students)
}
