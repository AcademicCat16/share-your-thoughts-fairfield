import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isReviewable, type Roster } from '../../shared/roster.ts'
import {
  emptyState, submitComment, updateComment, removeComment, restoreComment, completion, receivedCount, writtenCount, quest, nextReview,
  generateAssignments, applyPlan, setParticipating, submitBlocker, RuleViolation, type EngineState,
} from '../../shared/engine.ts'
import { validateFeedback, findBlockedTerm } from '../../shared/rules.ts'

const roster: Roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8'))
const S = roster.students
const good = { pronouns: '', enjoyed: 'I loved the bright colors and the music.', suggestion: 'Add a short tutorial at the start.' }
const code = (fn: () => unknown) => { try { fn(); return 'ok' } catch (e) { return e instanceof RuleViolation ? e.code : String(e) } }
let t = Date.UTC(2026, 10, 24, 15)
const now = () => new Date((t += 60_000))
const planned = (): EngineState => {
  let s = emptyState()
  s = generateAssignments(s, S, '1101', 'replace', now()).state
  s = generateAssignments(s, S, '2241', 'replace', now()).state
  return s
}
const pendingOf = (s: EngineState, r: string) => s.assignments.filter((a) => a.reviewerId === r && a.status === 'pending').map((a) => a.projectId)
const in2241 = S.filter((s) => s.course === '2241')
const in1101 = S.filter((s) => s.course === '1101')
const noProject = in2241.find((s) => !isReviewable(s))!

test('assigned review succeeds; reviewer name comes from the roster; assignment completed', () => {
  const s0 = planned()
  const r = in2241[1].id
  const p = pendingOf(s0, r)[0]
  const { state, comment } = submitComment(s0, S, r, p, good, now())
  assert.equal(comment.reviewerName, in2241[1].fullName)
  assert.equal(comment.course, '2241')
  assert.equal(state.assignments.find((a) => a.reviewerId === r && a.projectId === p)!.status, 'completed')
  assert.equal(writtenCount(state, r), 1)
})

test('course boundaries: 1101 cannot review 2241 and vice versa (browsing is not restricted)', () => {
  const s = planned()
  const p1101 = in1101.find(isReviewable)!.id
  const p2241 = in2241.find(isReviewable)!.id
  assert.equal(code(() => submitComment(s, S, in1101[0].id, p2241, good, now())), 'wrong_course')
  assert.equal(code(() => submitComment(s, S, in2241[0].id, p1101, good, now())), 'wrong_course')
})

test('self-review, empty desk, unassigned project, duplicate review are refused', () => {
  let s = planned()
  const me = in2241.find((x) => isReviewable(x))!.id
  assert.equal(code(() => submitComment(s, S, me, me, good, now())), 'self_review')
  assert.equal(code(() => submitComment(s, S, me, noProject.id, good, now())), 'project_unavailable')
  const notMine = in2241.find((x) => isReviewable(x) && x.id !== me && !pendingOf(s, me).includes(x.id))!.id
  assert.equal(code(() => submitComment(s, S, me, notMine, good, now())), 'not_assigned')
  const p = pendingOf(s, me)[0]
  s = submitComment(s, S, me, p, good, now()).state
  assert.equal(code(() => submitComment(s, S, me, p, good, now())), 'already_reviewed')
})

test('sections 01 and 02 share one pool: cross-section assignments exist and work', () => {
  const s = planned()
  const cross = s.assignments.find((a) => a.course === '2241' && S.find((x) => x.id === a.reviewerId)!.section !== S.find((x) => x.id === a.projectId)!.section)!
  assert.ok(cross)
  assert.equal(code(() => submitComment(s, S, cross.reviewerId, cross.projectId, good, now())), 'ok')
})

test('a full project refuses new feedback but its record stays (exploration is never blocked here)', () => {
  let s = planned()
  const target = Object.entries(s.capacities).find(([id]) => S.find((x) => x.id === id)!.course === '2241')![0]
  const assigned = s.assignments.filter((a) => a.projectId === target && a.status === 'pending').map((a) => a.reviewerId)
  for (const r of assigned) s = submitComment(s, S, r, target, good, now()).state
  assert.equal(receivedCount(s, target), s.capacities[target])
  // Allow extra reviews: a student who finished four still cannot exceed capacity.
  s = { ...s, allowExtra: true }
  const finisher = in2241.find((x) => !assigned.includes(x.id) && x.id !== target)!.id
  for (const p of pendingOf(s, finisher)) s = submitComment(s, S, finisher, p, good, now()).state
  assert.equal(writtenCount(s, finisher), 4)
  if (!s.comments.some((c) => c.reviewerId === finisher && c.projectId === target)) assert.equal(submitBlocker(s, S, finisher, target), 'project_full')
})

test('extra reviews only after four, only when the instructor allows, only with room beyond pending', () => {
  let s = planned()
  const r = in1101[0].id
  for (const p of pendingOf(s, r)) s = submitComment(s, S, r, p, good, now()).state
  assert.equal(writtenCount(s, r), 4)
  const other = in1101.find((x) => x.id !== r && !s.comments.some((c) => c.reviewerId === r && c.projectId === x.id))!.id
  assert.equal(submitBlocker(s, S, r, other), 'not_assigned', 'not allowed by default')
  s = { ...s, allowExtra: true }
  // In 1101 every slot is reserved by an assignment, so there is no room beyond pending yet.
  assert.equal(submitBlocker(s, S, r, other), 'not_assigned')
  s = { ...s, capacities: { ...s.capacities, [other]: 5 } }
  assert.equal(submitBlocker(s, S, r, other), null)
  const after = submitComment(s, S, r, other, good, now()).state
  assert.equal(after.comments.at(-1)!.extra, true)
  assert.equal(quest(after, r).find((q) => q.projectId === other)!.status, 'extra')
})

test('editing keeps identity and does not use a slot; only the author may edit', () => {
  let s = planned()
  const r = in2241[2].id; const p = pendingOf(s, r)[0]
  const r1 = submitComment(s, S, r, p, good, now()); s = r1.state
  const before = receivedCount(s, p)
  const u = updateComment(s, r, r1.comment.id, { ...good, enjoyed: 'I really loved the interactive map and colors.' }, now())
  assert.equal(receivedCount(u.state, p), before); assert.equal(writtenCount(u.state, r), 1)
  assert.equal(u.comment.reviewerName, r1.comment.reviewerName); assert.equal(u.comment.projectId, p)
  assert.equal(code(() => updateComment(s, in2241[3].id, r1.comment.id, good, now())), 'not_author')
})

test('quest + nextReview: four distinct assigned projects; next is a pending one; completion counted', () => {
  let s = planned()
  const r = in2241[5].id
  const q = quest(s, r)
  assert.equal(q.length, 4); assert.equal(new Set(q.map((x) => x.projectId)).size, 4)
  for (let i = 0; i < 4; i++) {
    const n = nextReview(s, r)!
    assert.ok(pendingOf(s, r).includes(n))
    s = submitComment(s, S, r, n, good, now()).state
  }
  assert.equal(nextReview(s, r), null)
  assert.equal(quest(s, r).filter((x) => x.status === 'completed').length, 4)
})

test('pause blocks submissions and edits', () => {
  let s = planned()
  const r = in1101[3].id; const p = pendingOf(s, r)[0]
  const c = submitComment(s, S, r, p, good, now()); s = { ...c.state, open: false }
  assert.equal(code(() => submitComment(s, S, r, pendingOf(s, r)[0], good, now())), 'closed')
  assert.equal(code(() => updateComment(s, r, c.comment.id, good, now())), 'closed')
})

test('release + rebalance: a non-participant’s unfinished slots go to others; nobody exceeds capacity', () => {
  let s = planned()
  const gone = in2241[7].id
  s = setParticipating(s, gone, false)
  assert.equal(pendingOf(s, gone).length, 0)
  s = generateAssignments(s, S, '2241', 'rebalance', now()).state
  const rep = completion(s, S, '2241')
  assert.equal(rep.participants, 57); assert.equal(rep.demand, 228)
  for (const r of rep.rows) if (r.eligible) assert.ok(r.assignedTo <= r.capacity, `${r.student.id} within capacity`)
  for (const r of rep.rows) if (r.participating) assert.equal(r.pending + r.written, 4)
})

test('applyPlan refuses invalid plans (server mirrors these checks)', () => {
  const s = planned()
  const a = in1101[0].id; const b = in1101[1].id
  assert.equal(code(() => applyPlan(s, S, '1101', {}, [{ reviewerId: a, projectId: a }])), 'invalid_plan')
  assert.equal(code(() => applyPlan(s, S, '1101', {}, [{ reviewerId: a, projectId: in2241.find(isReviewable)!.id }])), 'invalid_plan')
  assert.equal(code(() => applyPlan(s, S, '1101', { [b]: 3 }, [])), 'invalid_plan')
  assert.equal(code(() => applyPlan(s, S, '2241', {}, [{ reviewerId: in2241[0].id, projectId: noProject.id }])), 'invalid_plan')
})

test('moderation: removal frees the slot and releases the assignment; restore refused when full', () => {
  let s = planned()
  const p = in1101.find(isReviewable)!.id
  const reviewers = s.assignments.filter((a) => a.projectId === p).map((a) => a.reviewerId)
  for (const r of reviewers) s = submitComment(s, S, r, p, good, now()).state
  assert.equal(receivedCount(s, p), 4)
  const first = s.comments.find((c) => c.projectId === p)!
  s = removeComment(s, first.id, 'test')
  assert.equal(receivedCount(s, p), 3)
  assert.equal(s.assignments.find((a) => a.commentId === first.id)!.status, 'released')
  s = restoreComment(s, first.id)
  assert.equal(receivedCount(s, p), 4)
  s = removeComment(s, first.id, 'again')
  s = { ...s, capacities: { ...s.capacities, [p]: 3 } }
  assert.equal(code(() => restoreComment(s, first.id)), 'project_full')
})

test('completion report per course counts what is there (never assumes the target)', () => {
  const s = planned()
  const a = completion(s, S, '1101'); const b = completion(s, S, '2241')
  assert.equal(a.demand, 112); assert.equal(a.standardCapacity, 112); assert.equal(a.extraSlots, 0)
  assert.equal(b.demand, 232); assert.equal(b.standardCapacity, 212); assert.equal(b.extraSlots, 20); assert.equal(b.projectsWithExtra, 20)
  assert.equal(a.totalPublished, 0); assert.equal(b.reviewersComplete, 0); assert.equal(b.structuralShortfall, 0)
})

test('feedback validation: length, blocked words, normalisation', () => {
  assert.equal(validateFeedback({ pronouns: '', enjoyed: 'too short', suggestion: 'Add a short tutorial at the start.' }).ok, false)
  assert.equal(findBlockedTerm('This is so stupid honestly'), 'stupid')
  assert.equal(findBlockedTerm('Stupendous colors!'), null)
  const v = validateFeedback({ pronouns: '  they/them ', enjoyed: 'I   loved\r\n\r\n\r\nthe map a lot.', suggestion: 'Add a short tutorial at the start.' })
  assert.ok(v.ok && v.value.enjoyed === 'I loved\n\nthe map a lot.' && v.value.pronouns === 'they/them')
})
