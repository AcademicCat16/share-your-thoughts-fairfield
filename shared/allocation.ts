/**
 * Fair review allocation for one review pool (one course).
 *
 * Every active reviewer needs `perReviewer` (4) DISTINCT projects, never their own. Every eligible project starts with
 * `baseSlots` (4) standard slots. When demand (reviewers × 4) is larger than 4 × projects, extra slots are opened —
 * spread so that planned incoming reviews differ by at most one between projects (e.g. 58 reviewers, 53 projects:
 * 232 reviews → 20 projects get a fifth slot, 33 keep four).
 *
 * The plan is computed with a max-flow (Dinic) over reviewer → project edges, which either finds an assignment that
 * meets every reviewer's quota within every project's capacity, or proves none exists (then the plan says so).
 * Edges are explored in a seeded pseudo-random order, so the result is reproducible for the same inputs and seed
 * while still mixing sections. Existing work is never thrown away: completed reviews are always kept, and a
 * "rebalance" also keeps every pending assignment that is still valid.
 *
 * Pure and deterministic; used by the Demo backend, the instructor dashboard (Live mode sends the result to
 * admin_apply_assignments, which re-validates every edge on the server) and the tests.
 */

export interface Edge { reviewerId: string; projectId: string }
export interface ExistingEdge extends Edge { status: 'completed' | 'pending' }

export interface PlanInput {
  /** Active (participating) reviewers in this pool. */
  reviewers: string[]
  /** Projects in this pool that may receive reviews (verified working links). A project id is its owner's id. */
  projects: string[]
  /** Reviews each reviewer must write (4). */
  perReviewer: number
  /** Standard slots per project (4). */
  baseSlots: number
  /** Completed reviews (always kept) and pending assignments (kept when `keepPending`). */
  existing: ExistingEdge[]
  keepPending: boolean
  seed: string
}

export interface Plan {
  ok: boolean
  problems: string[]
  /** All assignments after planning: kept ones + new ones. */
  assignments: (Edge & { status: 'completed' | 'pending'; kept: boolean })[]
  /** Planned incoming reviews per project (balanced to within one where possible). */
  targets: Record<string, number>
  /** Slot capacity per project: max(baseSlots, target). Submissions can never exceed it. */
  capacities: Record<string, number>
  /** Number of slots above the standard four, summed over projects. */
  extraSlots: number
  /** Projects that received at least one extra slot. */
  projectsWithExtra: number
  demand: number
  standardCapacity: number
  /** Reviews that are still missing because no valid assignment exists (0 when ok). */
  unassigned: number
  /** Per-reviewer shortfall (reviewerId → missing count) when not ok. */
  short: Record<string, number>
}

function fnv(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}
const byHash = (seed: string) => (a: string, b: string) => fnv(seed + '|' + a) - fnv(seed + '|' + b) || (a < b ? -1 : a > b ? 1 : 0)

/** Dinic max-flow on a small graph. */
class Flow {
  private to: number[] = []; private cap: number[] = []; private head: number[]; private next: number[] = []
  private level: number[] = []; private it: number[] = []; private n: number
  constructor(n: number) { this.n = n; this.head = new Array(n).fill(-1) }
  add(u: number, v: number, c: number): number {
    const e = this.to.length
    this.to.push(v); this.cap.push(c); this.next.push(this.head[u]); this.head[u] = e
    this.to.push(u); this.cap.push(0); this.next.push(this.head[v]); this.head[v] = e + 1
    return e
  }
  flowOn(e: number) { return this.cap[e ^ 1] }
  private bfs(s: number, t: number) {
    this.level = new Array(this.n).fill(-1); this.level[s] = 0
    const q = [s]
    for (let i = 0; i < q.length; i++) for (let e = this.head[q[i]]; e !== -1; e = this.next[e]) {
      if (this.cap[e] > 0 && this.level[this.to[e]] < 0) { this.level[this.to[e]] = this.level[q[i]] + 1; q.push(this.to[e]) }
    }
    return this.level[t] >= 0
  }
  private dfs(u: number, t: number, f: number): number {
    if (u === t) return f
    for (; this.it[u] !== -1; this.it[u] = this.next[this.it[u]]) {
      const e = this.it[u]; const v = this.to[e]
      if (this.cap[e] > 0 && this.level[v] === this.level[u] + 1) {
        const d = this.dfs(v, t, Math.min(f, this.cap[e]))
        if (d > 0) { this.cap[e] -= d; this.cap[e ^ 1] += d; return d }
      }
    }
    return 0
  }
  max(s: number, t: number) {
    let total = 0
    while (this.bfs(s, t)) {
      // Adjacency lists are LIFO; reverse once so edges are tried in insertion (seeded) order.
      this.it = this.head.slice()
      let f: number
      while ((f = this.dfs(s, t, Infinity)) > 0) total += f
    }
    return total
  }
}

/**
 * Spread `total` incoming reviews over projects as evenly as possible, never below what a project already has
 * (`floor`). Ties for the "+1" go to projects in seeded order, so the extra slots land on different projects.
 */
export function balancedTargets(projects: string[], total: number, floor: Record<string, number>, seed: string): Record<string, number> {
  const out: Record<string, number> = {}
  if (!projects.length) return out
  const order = [...projects].sort(byHash(`${seed}|extra`))
  // Water-filling: find the largest level L with sum(max(floor, L)) <= total.
  let lo = 0, hi = Math.max(total, ...projects.map((p) => floor[p] ?? 0))
  const sumAt = (L: number) => projects.reduce((a, p) => a + Math.max(floor[p] ?? 0, L), 0)
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (sumAt(mid) <= total) lo = mid; else hi = mid - 1 }
  for (const p of projects) out[p] = Math.max(floor[p] ?? 0, lo)
  let left = total - sumAt(lo)
  for (const p of order) { if (left <= 0) break; if (out[p] === lo) { out[p]++; left-- } }
  return out
}

export function planAssignments(input: PlanInput): Plan {
  const { perReviewer, baseSlots, seed } = input
  const reviewers = [...new Set(input.reviewers)].sort()
  const projects = [...new Set(input.projects)].sort()
  const R = new Set(reviewers); const P = new Set(projects)
  const problems: string[] = []

  // Keep: every completed review; pending ones only when rebalancing and still valid.
  const keptKey = new Set<string>()
  const kept: Plan['assignments'] = []
  for (const e of input.existing) {
    const k = `${e.reviewerId}>${e.projectId}`
    if (keptKey.has(k)) continue
    if (e.status === 'pending' && (!input.keepPending || !R.has(e.reviewerId) || !P.has(e.projectId))) continue
    if (e.reviewerId === e.projectId) continue
    keptKey.add(k)
    kept.push({ ...e, kept: true })
  }
  const keptBy = (r: string) => kept.filter((e) => e.reviewerId === r).length
  // A reviewer with more pending than needed (e.g. quota lowered) keeps only the first ones.
  const need: Record<string, number> = {}
  for (const r of reviewers) need[r] = Math.max(0, perReviewer - keptBy(r))
  const load: Record<string, number> = {}
  for (const p of projects) load[p] = 0
  for (const e of kept) if (P.has(e.projectId)) load[e.projectId]++

  const demand = reviewers.length * perReviewer
  const newNeeded = reviewers.reduce((a, r) => a + need[r], 0)
  const totalIncoming = Object.values(load).reduce((a, b) => a + b, 0) + newNeeded

  const finish = (assignments: Plan['assignments'], targets: Record<string, number>, short: Record<string, number>): Plan => {
    const capacities: Record<string, number> = {}
    for (const p of projects) {
      const assigned = assignments.filter((e) => e.projectId === p).length
      capacities[p] = Math.max(baseSlots, targets[p] ?? 0, assigned)
    }
    const extraSlots = projects.reduce((a, p) => a + Math.max(0, capacities[p] - baseSlots), 0)
    const unassigned = Object.values(short).reduce((a, b) => a + b, 0)
    return {
      ok: unassigned === 0 && problems.length === 0, problems, assignments, targets, capacities, extraSlots,
      projectsWithExtra: projects.filter((p) => capacities[p] > baseSlots).length,
      demand, standardCapacity: projects.length * baseSlots, unassigned, short,
    }
  }

  if (!projects.length) {
    if (reviewers.length) problems.push('There are no eligible projects in this course yet, so no reviews can be assigned.')
    const short: Record<string, number> = {}; for (const r of reviewers) if (need[r]) short[r] = need[r]
    return finish(kept, {}, short)
  }
  const maxDistinct = projects.length
  if (perReviewer > maxDistinct - (reviewers.some((r) => P.has(r)) ? 1 : 0)) {
    problems.push(`Each student needs ${perReviewer} different projects, but only ${projects.length} projects are eligible (a student cannot review their own), so the requirement cannot be met for everyone.`)
  }

  // Try balanced targets first; if a reviewer cannot be served (self-exclusion or duplicates), relax by one level.
  const order = byHash(seed)
  for (let slack = 0; slack <= perReviewer + 1; slack++) {
    const base = balancedTargets(projects, totalIncoming, load, seed)
    const targets: Record<string, number> = {}
    for (const p of projects) targets[p] = base[p] + slack
    // Graph: S → reviewer (need) → project (1, not self, not already paired) → T (target − load).
    const ri = new Map(reviewers.map((r, i) => [r, 1 + i]))
    const pi = new Map(projects.map((p, i) => [p, 1 + reviewers.length + i]))
    const S = 0, T = 1 + reviewers.length + projects.length
    const g = new Flow(T + 1)
    for (const r of [...reviewers].sort(order)) if (need[r] > 0) g.add(S, ri.get(r)!, need[r])
    const pairs: { r: string; p: string; e: number }[] = []
    for (const r of [...reviewers].sort(order)) {
      if (!need[r]) continue
      const cand = projects.filter((p) => p !== r && !keptKey.has(`${r}>${p}`)).sort(byHash(`${seed}|${r}`))
      for (const p of cand) pairs.push({ r, p, e: g.add(ri.get(r)!, pi.get(p)!, 1) })
    }
    for (const p of [...projects].sort(order)) g.add(pi.get(p)!, T, Math.max(0, targets[p] - load[p]))
    const flowed = g.max(S, T)
    const added: Plan['assignments'] = pairs.filter((x) => g.flowOn(x.e) > 0).map((x) => ({ reviewerId: x.r, projectId: x.p, status: 'pending', kept: false }))
    if (flowed === newNeeded || slack === perReviewer + 1) {
      const short: Record<string, number> = {}
      for (const r of reviewers) { const got = keptBy(r) + added.filter((a) => a.reviewerId === r).length; if (got < perReviewer) short[r] = perReviewer - got }
      if (slack > 0 && flowed === newNeeded) problems.push(`Balanced targets were not feasible; ${slack} extra slot(s) per project were needed to give everyone ${perReviewer} different projects.`)
      return finish([...kept, ...added], targets, short)
    }
  }
  /* c8 ignore next */
  throw new Error('unreachable')
}

/** Check a set of assignments against the pool rules (used by tests and before sending a plan to the server). */
export function validateAssignments(edges: Edge[], pool: { reviewers: string[]; projects: string[]; perReviewer: number; capacities: Record<string, number> }): string[] {
  const out: string[] = []
  const R = new Set(pool.reviewers); const P = new Set(pool.projects)
  const seen = new Set<string>(); const per: Record<string, number> = {}; const inc: Record<string, number> = {}
  for (const e of edges) {
    const k = `${e.reviewerId}>${e.projectId}`
    if (seen.has(k)) out.push(`duplicate ${k}`)
    seen.add(k)
    if (e.reviewerId === e.projectId) out.push(`self review ${k}`)
    if (!R.has(e.reviewerId)) out.push(`reviewer not in pool ${k}`)
    if (!P.has(e.projectId)) out.push(`project not eligible in pool ${k}`)
    per[e.reviewerId] = (per[e.reviewerId] ?? 0) + 1
    inc[e.projectId] = (inc[e.projectId] ?? 0) + 1
  }
  for (const [p, n] of Object.entries(inc)) if (n > (pool.capacities[p] ?? 0)) out.push(`project ${p} over capacity (${n} > ${pool.capacities[p] ?? 0})`)
  for (const r of pool.reviewers) if ((per[r] ?? 0) > pool.perReviewer) out.push(`reviewer ${r} has ${per[r]} > ${pool.perReviewer}`)
  return out
}
