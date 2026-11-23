import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planAssignments, validateAssignments, balancedTargets, type Plan } from '../../shared/allocation.ts'
import { isReviewable, type Roster } from '../../shared/roster.ts'

const roster: Roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8'))
const pool = (course: '1101' | '2241') => {
  const st = roster.students.filter((s) => s.course === course)
  return { reviewers: st.map((s) => s.id), projects: st.filter(isReviewable).map((s) => s.id) }
}
const incoming = (p: Plan) => { const m: Record<string, number> = {}; for (const a of p.assignments) m[a.projectId] = (m[a.projectId] ?? 0) + 1; return m }
const perReviewer = (p: Plan) => { const m: Record<string, number> = {}; for (const a of p.assignments) m[a.reviewerId] = (m[a.reviewerId] ?? 0) + 1; return m }
const plan = (reviewers: string[], projects: string[], extra: Partial<Parameters<typeof planAssignments>[0]> = {}) =>
  planAssignments({ reviewers, projects, perReviewer: 4, baseSlots: 4, existing: [], keepPending: false, seed: 'test', ...extra })

test('MKTG 1101 (28 students, 28 projects): 112 reviews, exactly 4 per project, no extra slots', () => {
  const { reviewers, projects } = pool('1101')
  assert.equal(reviewers.length, 28); assert.equal(projects.length, 28)
  const p = plan(reviewers, projects)
  assert.ok(p.ok, p.problems.join(' '))
  assert.equal(p.assignments.length, 112); assert.equal(p.extraSlots, 0)
  assert.deepEqual(new Set(Object.values(incoming(p))), new Set([4]))
  assert.deepEqual(validateAssignments(p.assignments, { reviewers, projects, perReviewer: 4, capacities: p.capacities }), [])
})

test('MKTG 2241 (58 students, 53 projects): 232 reviews, 20 projects with a fifth slot, 33 with four', () => {
  const { reviewers, projects } = pool('2241')
  assert.equal(reviewers.length, 58); assert.equal(projects.length, 53)
  const p = plan(reviewers, projects)
  assert.ok(p.ok, p.problems.join(' '))
  assert.equal(p.demand, 232); assert.equal(p.standardCapacity, 212)
  assert.equal(p.assignments.length, 232); assert.equal(p.extraSlots, 20); assert.equal(p.projectsWithExtra, 20)
  const inc = Object.values(incoming(p))
  assert.equal(inc.filter((n) => n === 5).length, 20); assert.equal(inc.filter((n) => n === 4).length, 33)
  for (const n of Object.values(perReviewer(p))) assert.equal(n, 4)
  assert.deepEqual(validateAssignments(p.assignments, { reviewers, projects, perReviewer: 4, capacities: p.capacities }), [])
  // Students without a project still review four classmates.
  for (const s of roster.students.filter((x) => x.course === '2241' && !isReviewable(x))) assert.equal(perReviewer(p)[s.id], 4)
})

test('every plan: no self-review, no duplicates, only own-course projects, deterministic for a seed', () => {
  for (const c of ['1101', '2241'] as const) {
    const { reviewers, projects } = pool(c)
    const a = plan(reviewers, projects); const b = plan(reviewers, projects)
    assert.deepEqual(a.assignments, b.assignments, 'same inputs + seed → same plan')
    const pairs = new Set(a.assignments.map((x) => `${x.reviewerId}>${x.projectId}`))
    assert.equal(pairs.size, a.assignments.length)
    for (const x of a.assignments) { assert.notEqual(x.reviewerId, x.projectId); assert.ok(projects.includes(x.projectId)) }
  }
})

test('fewer working projects: extra capacity is recalculated, still balanced within one', () => {
  const { reviewers, projects } = pool('2241')
  const p = plan(reviewers, projects.slice(0, 40)) // 232 reviews over 40 projects → 5.8 each
  assert.ok(p.ok)
  const inc = Object.values(incoming(p))
  assert.ok(Math.max(...inc) - Math.min(...inc) <= 1, 'balanced within one')
  assert.equal(Math.max(...inc), 6, 'a five-comment maximum is not assumed')
  assert.equal(inc.reduce((a, b) => a + b, 0), 232)
})

test('impossible requirement is reported, not faked', () => {
  const p = plan(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']) // each can only review 3 others
  assert.equal(p.ok, false)
  assert.ok(p.unassigned > 0)
  assert.ok(p.problems.length > 0)
  const none = plan(['a', 'b'], [])
  assert.equal(none.ok, false); assert.equal(none.unassigned, 8)
})

test('rebalance keeps completed reviews and valid pending assignments; replace keeps only completed', () => {
  const { reviewers, projects } = pool('2241')
  const first = plan(reviewers, projects)
  const done = first.assignments.slice(0, 30).map((a) => ({ reviewerId: a.reviewerId, projectId: a.projectId, status: 'completed' as const }))
  const pending = first.assignments.slice(30).map((a) => ({ reviewerId: a.reviewerId, projectId: a.projectId, status: 'pending' as const }))
  // One student stops participating: their unfinished work must be redistributed.
  const gone = pending[0].reviewerId
  const active = reviewers.filter((r) => r !== gone)
  const re = plan(active, projects, { existing: [...done, ...pending], keepPending: true })
  assert.ok(re.ok)
  for (const d of done) assert.ok(re.assignments.some((a) => a.reviewerId === d.reviewerId && a.projectId === d.projectId && a.status === 'completed'))
  const keptPending = pending.filter((x) => x.reviewerId !== gone)
  for (const k of keptPending) assert.ok(re.assignments.some((a) => a.reviewerId === k.reviewerId && a.projectId === k.projectId), 'pending kept on rebalance')
  assert.equal(re.assignments.filter((a) => a.reviewerId === gone && a.status === 'pending').length, 0)
  const rep = plan(active, projects, { existing: [...done, ...pending], keepPending: false })
  assert.ok(rep.ok)
  for (const d of done) assert.ok(rep.assignments.some((a) => a.reviewerId === d.reviewerId && a.projectId === d.projectId))
  for (const n of Object.entries(perReviewer(rep))) assert.ok(n[1] <= 4)
})

test('balancedTargets never lowers an existing load and spreads the remainder', () => {
  const t = balancedTargets(['a', 'b', 'c'], 10, { a: 6 }, 's')
  assert.equal(t.a, 6); assert.equal(t.b + t.c, 4); assert.ok(Math.abs(t.b - t.c) <= 1)
})
