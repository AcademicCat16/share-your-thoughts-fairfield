import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { readWorkbook } from '../../shared/xlsx.ts'
import { parseRosterSheet, mergeRoster, classifyUrl, rosterCounts, countProblems, type Roster } from '../../shared/roster.ts'
import { CREATURES } from '../../shared/creatures.ts'

const roster: Roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8'))
const ids = CREATURES.map((c) => c.id)
const src = { file: 't.xlsx', sheet: 'x', importedAt: '2026-11-19T00:00:00Z' }

test('published roster: exactly 58 students, 28 + 30, ids unique and deterministic', () => {
  const c = rosterCounts(roster)
  assert.equal(c.total, 58); assert.equal(c.section01, 28); assert.equal(c.section02, 30)
  assert.deepEqual(countProblems(roster), [])
  assert.equal(new Set(roster.students.map((s) => s.id)).size, 58)
  for (const s of roster.students) assert.equal(s.id, `s${s.section}-${String(s.position).padStart(2, '0')}`)
  assert.equal(new Set(roster.students.map((s) => s.creatureId)).size, 58, 'every student has a different creature')
})

test('published roster: URL classification counts and the file:/// link', () => {
  const c = rosterCounts(roster)
  assert.equal(c.valid + c.missing + c.invalid, 58)
  const ava = roster.students.find((s) => s.fullName === 'Ava Goldberg')!
  assert.equal(ava.urlStatus, 'invalid'); assert.match(ava.url!, /^file:/)
  for (const s of roster.students) if (s.url) assert.equal(s.url, s.url.trim(), `${s.id} url trimmed`)
})

// The workbook itself is not in the repository (it is exam material); these run where it exists.
const XLSX = 'Take-Home Exam.xlsx'
test('workbook → roster: names and links exactly as in the spreadsheet', { skip: !existsSync(XLSX) && 'workbook not present (CI)' }, () => {
  const p = parseRosterSheet(readWorkbook(new Uint8Array(readFileSync(XLSX))))
  assert.equal(p.sheet, 'Your Own Interactive World')
  assert.equal(p.rows.length, 58)
  p.rows.forEach((r) => {
    const s = roster.students.find((x) => x.firstName === r.firstName && x.lastName === r.lastName && x.section === r.section)
    assert.ok(s, `${r.firstName} ${r.lastName} present`)
    assert.equal(s!.url, classifyUrl(r.url).url)
  })
  // spot checks of tricky values
  assert.ok(roster.students.some((s) => s.firstName === 'Katherine' && s.lastName === "O'Leary"))
  assert.ok(roster.students.some((s) => s.lastName === 'Van Wickler'))
  assert.equal(roster.students.find((s) => s.lastName === 'Tello')!.url, 'https://josselly.github.io/dreamgarage/index.html')
})

test('classifyUrl: trims, never repairs, rejects local/private links', () => {
  assert.deepEqual(classifyUrl('  https://a.github.io/x/  ').url, 'https://a.github.io/x/')
  assert.equal(classifyUrl('https://a.github.io/x/').status, 'valid')
  assert.equal(classifyUrl(null).status, 'missing')
  assert.equal(classifyUrl('   ').status, 'missing')
  assert.equal(classifyUrl('file:///Users/x/site/index.html').status, 'invalid')
  assert.equal(classifyUrl('a.github.io/x').status, 'invalid', 'no scheme → reported, not guessed')
  assert.equal(classifyUrl('a.github.io/x').url, 'a.github.io/x')
  assert.equal(classifyUrl('http://localhost:5173/').status, 'invalid')
  assert.equal(classifyUrl('http://192.168.1.4/').status, 'invalid')
  assert.equal(classifyUrl('javascript:alert(1)').status, 'invalid')
  assert.equal(classifyUrl('https://user:pw@a.github.io/').status, 'invalid')
})

test('re-import keeps ids, positions and creatures; only URLs change; new students append', () => {
  const rows = roster.students.map((s) => ({ section: s.section, firstName: s.firstName, lastName: s.lastName, url: s.url, sheetRow: 0 }))
  // a missing project arrives, the order of the sheet changes, and one new student joins Section 01
  const changed = [...rows].reverse().map((r) => (r.firstName === 'Ainsley' ? { ...r, url: ' https://ainsley.github.io/world/ ' } : r))
  changed.push({ section: '01', firstName: 'New', lastName: 'Student', url: null, sheetRow: 0 })
  const { roster: next, report } = mergeRoster(roster, changed, ids.concat(['c59']), src)
  for (const s of roster.students) {
    const n = next.students.find((x) => x.id === s.id)!
    assert.equal(n.creatureId, s.creatureId); assert.equal(n.position, s.position); assert.equal(n.fullName, s.fullName)
  }
  const ainsley = next.students.find((s) => s.firstName === 'Ainsley')!
  assert.equal(ainsley.url, 'https://ainsley.github.io/world/'); assert.equal(ainsley.urlStatus, 'valid')
  assert.deepEqual(report.urlChanged, [ainsley.id])
  const ns = next.students.find((s) => s.lastName === 'Student')!
  assert.equal(ns.id, 's01-29'); assert.equal(ns.creatureId, 'c59')
})

test('a student who disappears is kept in `removed` and gets the same id back later', () => {
  const rows = roster.students.filter((s) => s.id !== 's02-05').map((s) => ({ section: s.section, firstName: s.firstName, lastName: s.lastName, url: s.url, sheetRow: 0 }))
  const a = mergeRoster(roster, rows, ids, src)
  assert.equal(a.roster.students.length, 57); assert.deepEqual(a.roster.removed.map((s) => s.id), ['s02-05'])
  const back = roster.students.find((s) => s.id === 's02-05')!
  const b = mergeRoster(a.roster, [...rows, { section: back.section, firstName: back.firstName, lastName: back.lastName, url: back.url, sheetRow: 0 }], ids, src)
  assert.ok(b.roster.students.some((s) => s.id === 's02-05' && s.creatureId === back.creatureId))
  assert.deepEqual(b.report.restored, ['s02-05'])
})

test('duplicate names in one section are refused rather than merged', () => {
  const r = { section: '01' as const, firstName: 'A', lastName: 'B', url: null, sheetRow: 1 }
  assert.throws(() => mergeRoster(null, [r, { ...r, sheetRow: 2 }], ids, src), /Duplicate/)
})
