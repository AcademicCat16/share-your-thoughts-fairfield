import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import rosterJson from '../data/roster.json'
import { upgradeRoster, type CourseKey, type Roster, type Student } from '../../shared/roster.ts'
import { CREATURES } from '../../shared/creatures.ts'
import { CREATURES_1101 } from '../../shared/creatures1101.ts'
import type { CreatureSpec } from '../../shared/creatureTypes.ts'
import type { QuestItem } from '../../shared/engine.ts'
import type { Backend, Me, PublicStatus } from './backend.ts'
import { createDemoBackend } from './demoBackend.ts'

export const BUNDLED_ROSTER = upgradeRoster(rosterJson)!
export const ROSTER_OVERRIDE_KEY = 'fic.demo.roster.v2'
export const ALL_CREATURES: CreatureSpec[] = [...CREATURES, ...CREATURES_1101]
export const CREATURE_BY_ID = new Map<string, CreatureSpec>(ALL_CREATURES.map((c) => [c.id, c]))

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
      if (raw) { const r = upgradeRoster(JSON.parse(raw)); if (r?.schema === 'fairfield-roster' && Array.isArray(r.students)) return { roster: r, overridden: true } }
    } catch { /* ignore */ }
  }
  return { roster: BUNDLED_ROSTER, overridden: false }
}

export type Route = 'home' | '1101' | '2241' | 'guide' | 'instructor'
const parseRoute = (): Route => {
  const h = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0]
  if (h === 'guide' || h === 'instructor' || h === '1101' || h === '2241') return h
  if (h === 'classroom') return '2241' // links from the first demo
  return 'home'
}
export const routeHref = (r: Route) => (r === 'home' ? '#/' : `#/${r}`)
export const go = (r: Route) => { location.hash = routeHref(r) }
/** A desk to open once the target classroom has loaded (cross-classroom "Find My Next Review"). */
export const PENDING_OPEN_KEY = 'fic.pendingOpen.v1'
const EXPLORED_KEY = 'fic.explored.v1'
/** Projects this visitor opened in this browser tab session (for "Explore Another World" variety). */
export const readExplored = (): string[] => { try { return JSON.parse(sessionStorage.getItem(EXPLORED_KEY) ?? '[]') } catch { return [] } }
export const markExplored = (id: string) => { try { const l = readExplored().filter((x) => x !== id); l.push(id); sessionStorage.setItem(EXPLORED_KEY, JSON.stringify(l.slice(-200))) } catch { /* ignore */ } }
export const isCourseRoute = (r: Route): r is CourseKey => r === '1101' || r === '2241'

export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

interface Ctx {
  backend: Backend
  roster: Roster
  rosterOverridden: boolean
  setRosterOverride(r: Roster | null): void
  students: Student[]
  byId: Map<string, Student>
  status: PublicStatus
  me: Me | null
  quest: QuestItem[]
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
  const [status, setStatus] = useState<PublicStatus>({ open: true, allowExtra: false, projects: {} })
  const [me, setMe] = useState<Me | null>(null)
  const [quest, setQuest] = useState<QuestItem[]>([])
  const [route, setRoute] = useState<Route>(parseRoute)
  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<Ctx['focus']>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [reducedMotion, setRM] = useState(prefersReducedMotion)
  const toastTimer = useRef<number>(0)

  const refresh = useCallback(async () => {
    try {
      const [st, m] = await Promise.all([backend.status(), backend.me()])
      setStatus(st); setMe(m)
      setQuest(m ? await backend.quest() : [])
    } catch { /* surfaced where the user acts */ }
  }, [backend])

  useEffect(() => { refresh(); return backend.subscribe(refresh) }, [backend, refresh])
  useEffect(() => {
    const on = () => { setRoute(parseRoute()); setSelected(null) }
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

  const byId = useMemo(() => new Map(roster.students.map((s) => [s.id, s])), [roster])
  const value = useMemo<Ctx>(() => ({
    backend, roster, rosterOverridden: overridden,
    setRosterOverride(r) {
      try { if (r) localStorage.setItem(ROSTER_OVERRIDE_KEY, JSON.stringify(r)); else localStorage.removeItem(ROSTER_OVERRIDE_KEY) } catch { /* ignore */ }
      setR(r ? { roster: r, overridden: true } : { roster: BUNDLED_ROSTER, overridden: false })
    },
    students: roster.students, byId, status, me, quest, refresh, route, selected,
    select: setSelected,
    focus,
    focusOn: (id) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 })),
    reducedMotion,
    toast,
    say(msg) { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 4500) },
  }), [backend, roster, overridden, byId, status, me, quest, refresh, route, selected, focus, reducedMotion, toast])

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

/** Slot view of a project for display: published, capacity and whether it is full. */
export function slotsOf(status: PublicStatus, id: string, base = 4) {
  const p = status.projects[id]
  const published = p?.published ?? 0
  const capacity = p?.capacity ?? base
  return { published, capacity, full: published >= capacity, extra: Math.max(0, capacity - base) }
}
