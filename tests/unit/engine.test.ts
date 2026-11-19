import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Roster } from '../../shared/roster.ts'
import { emptyState, submitComment, updateComment, recommend, removeComment, restoreComment, completion, receivedCount, writtenCount, RuleViolation, DEFAULT_SETTINGS, type EngineState } from '../../shared/engine.ts'
import { validateFeedback, findBlockedTerm } from '../../shared/rules.ts'

const roster: Roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8'))
const S = roster.students
const valid = S.filter((s) => s.urlStatus === 'valid')
const noLink = S.find((s) => s.urlStatus !== 'valid')!
const good = { pronouns: '', enjoyed: 'I loved the bright colors and the music.', suggestion: 'Add a short tutorial at the start.' }
const code = (fn: () => unknown) => { try { fn(); return 'ok' } catch (e) { return e instanceof RuleViolation ? e.code : String(e) } }
let t = Date.UTC(2026, 10, 20, 15)
const now = () => new Date((t += 60_000))
const submit = (s: EngineState, reviewer: string, project: string) => submitComment(s, S, reviewer, project, good, now()).state

test('self-review, empty desk and duplicate review are refused', () => {
  const me = valid[0].id
  assert.equal(code(() => submitComment(emptyState(), S, me, me, good, now())), 'self_review')
  assert.equal(code(() => submitComment(emptyState(), S, me, noLink.id, good, now())), 'project_unavailable')
  const s1 = submit(emptyState(), me, valid[1].id)
  assert.equal(code(() => submitComment(s1, S, me, valid[1].id, good, now())), 'already_reviewed')
})

test('four-comment limit; a removal frees the slot; restore refused when full', () => {
  const p = valid[0].id
  let s = emptyState()
  for (const r of valid.slice(1, 5)) s = submit(s, r.id, p)
  assert.equal(receivedCount(s, p), 4)
  assert.equal(code(() => submitComment(s, S, valid[5].id, p, good, now())), 'project_full')
  const first = s.comments[0].id
  s = removeComment(s, first, 'test')
  assert.equal(receivedCount(s, p), 3)
  s = submit(s, valid[5].id, p)
  assert.equal(code(() => restoreComment(s, first)), 'project_full')
})

test('each reviewer writes at most four; editing does not use a slot or change identity', () => {
  const me = valid[10].id
  let s = emptyState()
  for (const p of valid.slice(11, 15)) s = submit(s, me, p.id)
  assert.equal(writtenCount(s, me), 4)
  assert.equal(code(() => submitComment(s, S, me, valid[16].id, good, now())), 'reviewer_limit')
  const mine = s.comments[0]
  const r = updateComment(s, me, mine.id, { ...good, suggestion: 'Maybe add a dark mode for night owls.' }, now())
  assert.equal(r.comment.reviewerId, mine.reviewerId); assert.equal(r.comment.projectId, mine.projectId); assert.equal(r.comment.reviewerName, mine.reviewerName)
  assert.equal(r.comment.createdAt, mine.createdAt); assert.notEqual(r.comment.updatedAt, mine.updatedAt)
  assert.equal(r.state.comments.length, s.comments.length)
  assert.equal(code(() => updateComment(s, valid[20].id, mine.id, good, now())), 'not_author')
})

test('text rules: length, blocked words, pronouns optional', () => {
  assert.equal(validateFeedback({ ...good, enjoyed: 'nice' }).ok, false)
  assert.equal(validateFeedback({ ...good, pronouns: '' }).ok, true)
  assert.equal(findBlockedTerm('this is stupid'), 'stupid')
  assert.equal(findBlockedTerm('I loved the tasty fudge'), null)
  const r = validateFeedback({ ...good, enjoyed: 'Honestly this sucks, no offense' })
  assert.ok(!r.ok && r.error === 'inappropriate')
})

test('recommendation excludes own, reviewed, full and linkless projects', () => {
  const me = valid[0].id
  let s = emptyState()
  s = submit(s, me, valid[1].id)
  for (const r of valid.slice(3, 7)) s = submit(s, r.id, valid[2].id) // valid[2] full
  for (let i = 0; i < 60; i++) {
    const r = recommend(s, S, me, now())
    assert.ok(r.projectId)
    assert.ok(![me, valid[1].id, valid[2].id].includes(r.projectId!))
    assert.equal(S.find((x) => x.id === r.projectId)!.urlStatus, 'valid')
    s = { ...r.state, reservations: [] }
  }
})

test('recommendation spreads simultaneous reviewers and favours the least-reviewed', () => {
  let s = emptyState()
  const reviewers = S.slice(0, 20).map((x) => x.id)
  const picks: string[] = []
  for (const r of reviewers) { const out = recommend(s, S, r, now()); s = out.state; picks.push(out.projectId!) }
  assert.equal(new Set(picks).size, picks.length, 'no two concurrent reviewers sent to the same desk while others are untouched')
  // give every project but one a review; the next pick must be that one
  let s2 = emptyState()
  const target = valid[7].id
  let k = 0
  for (const p of valid.filter((x) => x.id !== target)) {
    // next reviewer (any student) who is not the project owner and still under the cap
    while (S[k % S.length].id === p.id || writtenCount(s2, S[k % S.length].id) >= 4 || S[k % S.length].id === noLink.id) k++
    s2 = submit(s2, S[k % S.length].id, p.id); k++
  }
  const pick = recommend(s2, S, noLink.id, now()).projectId
  assert.equal(pick, target)
})

test('completion report never assumes 232 — it reports the structural shortfall', () => {
  const rep = completion(emptyState(), S, DEFAULT_SETTINGS, 4)
  assert.equal(rep.demand, 232)
  assert.equal(rep.capacity, valid.length * 4)
  assert.equal(rep.structuralShortfall, Math.max(0, 232 - valid.length * 4))
  assert.equal(rep.projectsComplete, 0)
})
