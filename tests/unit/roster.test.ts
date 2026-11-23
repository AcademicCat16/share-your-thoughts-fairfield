import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { readWorkbook } from '../../shared/xlsx.ts'
import {
  parseWorkbook, mergeRoster, classifyUrl, rosterCounts, countProblems, isReviewable, publicRoster, upgradeRoster,
  type Roster, type ParsedRow,
} from '../../shared/roster.ts'
import { CREATURES } from '../../shared/creatures.ts'
import { CREATURES_1101 } from '../../shared/creatures1101.ts'

const roster: Roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8'))
const pools = { '1101': CREATURES_1101.map((c) => c.id), '2241': CREATURES.map((c) => c.id) }
const src = { file: 't.xlsm', sheets: ['x'], importedAt: '2026-11-23T00:00:00Z' }
const S = roster.students
const rowOf = (s: (typeof S)[number]): ParsedRow => ({ course: s.course, section: s.section, firstName: s.firstName, lastName: s.lastName, url: s.url, urlSource: 'test', sheetRow: 0 })

test('published roster: 86 students — 28 in MKTG 1101, 58 in MKTG 2241 (28 + 30)', () => {
  const c = rosterCounts(roster)
  assert.equal(c.total, 86); assert.equal(c.c1101, 28); assert.equal(c.c2241, 58)
  assert.equal(c.section01, 28); assert.equal(c.section02, 30)
  assert.deepEqual(countProblems(roster), [])
  assert.equal(new Set(S.map((s) => s.id)).size, 86)
  for (const s of S) {
    assert.equal(s.id, s.course === '1101' ? `pm-${String(s.position).padStart(2, '0')}` : `s${s.section}-${String(s.position).padStart(2, '0')}`)
    assert.equal(s.courseCode, s.course === '1101' ? 'MKTG 1101' : 'MKTG 2241')
  }
})

test('creatures: unique per student, each course uses only its own creature pool', () => {
  assert.equal(new Set(S.map((s) => s.creatureId)).size, 86)
  for (const s of S) assert.ok(pools[s.course].includes(s.creatureId), `${s.id} uses a ${s.course} creature`)
})

test('the 58 Digital Marketing students kept their original ids and creatures (first demo, commit d6a03e4)', () => {
  // Snapshot of the deployed v1 roster: id → creature for a spread of students.
  const v1: Record<string, [string, string]> = {
    's01-01': ['Ainsley Gondek', 'c52'], 's01-02': ['Antonia Rolo', 'c33'], 's01-18': ["Katherine O'Leary", 'c19'],
    's01-28': ['Zoe Labdon', 'c08'], 's02-03': ['Ava Goldberg', 'c40'], 's02-15': ['John Paul Hayden', 'c44'],
    's02-25': ['Mason Carter', 'c23'], 's02-30': ['Trista Ouellette', 'c26'],
  }
  for (const [id, [name, creature]] of Object.entries(v1)) {
    const s = S.find((x) => x.id === id)!
    assert.equal(s.fullName, name); assert.equal(s.creatureId, creature)
  }
})

test('MKTG 2241: exactly five students without a project, and they are the expected five', () => {
  const none = S.filter((s) => s.course === '2241' && s.urlStatus === 'missing').map((s) => s.fullName).sort()
  assert.deepEqual(none, ['Ainsley Gondek', 'Courtney Shyposh', 'James Honekamp', 'Mason Carter', 'Michael Gallagher'])
  for (const s of S.filter((x) => x.urlStatus === 'missing')) assert.equal(isReviewable(s), false)
})

test('MKTG 1101 uses the interactive-website column only, never the personal website', () => {
  const p = S.filter((s) => s.course === '1101')
  assert.equal(p.filter((s) => s.urlStatus === 'valid').length, 28)
  for (const s of p) assert.match(s.urlSource ?? '', /^Website Link!E\d+/, `${s.fullName} link came from column E`)
  // Personal sites (column D) — none may appear anywhere in the roster.
  const personal = ['https://adambonanno-hash.github.io/', 'https://masonandrews-stack.github.io/', 'https://tylerframpton07.github.io/Personal-Website/', 'lukeryan-maker.github.io/']
  const json = JSON.stringify(roster)
  for (const u of personal) assert.ok(!json.includes(`"${u}"`), `personal site ${u} must not be in the roster`)
  const mason = p.find((s) => s.fullName === 'Mason Andrews')!
  assert.equal(mason.url, 'https://masonandrews-stack.github.io/creative-website/')
  assert.match(mason.urlSource!, /link target/)
  assert.equal(p.find((s) => s.fullName === 'Owen Sullivan')!.url, 'https://boof-brand.netlify.app/', 'non-GitHub hosts are accepted')
})

test('links keep #fragments and ?queries; whitespace trimmed; published site preferred over a repository', () => {
  assert.equal(S.find((s) => s.fullName === 'Eva Plasterer')!.url, 'https://eplasterer.github.io/creative-website/?v=45a2ecb#top')
  assert.equal(S.find((s) => s.fullName === 'Lani Ferreira')!.url, 'https://laniferreira.github.io/outfitplanner/#planner')
  for (const s of S) if (s.url) assert.equal(s.url, s.url.trim())
  for (const n of ['Katie DeBello', 'Connor Rowland', 'Thomas Caruso']) {
    const s = S.find((x) => x.fullName === n)!
    assert.match(s.url!, /\.github\.io\//, `${n}: the published site, not github.com`)
    assert.match(s.urlSource!, /!F\d+ \(published website/)
  }
  assert.ok(!S.some((s) => s.url && /\/\/github\.com\//.test(s.url)))
})

test('eligibility requires a verified working link', () => {
  const s = { ...S.find((x) => x.urlStatus === 'valid')! }
  assert.equal(isReviewable({ ...s, link: { status: 'working' } }), true)
  assert.equal(isReviewable({ ...s, link: { status: 'broken' } }), false)
  assert.equal(isReviewable({ ...s, link: { status: 'unchecked' } }), false)
  assert.equal(isReviewable({ ...s, link: { status: 'working' }, hidden: true }), false)
})

// The workbook itself is never committed (exam material); these run where it exists.
const XLSM = 'Take-Home Exam (final).xlsm'
test('workbook → roster: every name and link exactly as in the final workbook', { skip: !existsSync(XLSM) && 'workbook not present (CI)' }, () => {
  const p = parseWorkbook(readWorkbook(new Uint8Array(readFileSync(XLSM))))
  assert.deepEqual(p.sheets, ['Website Link', 'Your Own Interactive World'])
  assert.equal(p.rows.length, 86)
  for (const r of p.rows) {
    const s = S.find((x) => x.course === r.course && x.firstName === r.firstName && x.lastName === r.lastName && x.section === r.section)
    assert.ok(s, `${r.firstName} ${r.lastName} present`)
    assert.equal(s!.url, classifyUrl(r.url).url)
  }
  // The personal-website column is never read into rows.
  assert.ok(!p.rows.some((r) => r.urlSource.includes('!D')))
})

test('classifyUrl: trims, never repairs, rejects local/private links and repository pages', () => {
  assert.equal(classifyUrl('  https://a.github.io/x/  ').url, 'https://a.github.io/x/')
  assert.equal(classifyUrl('https://a.netlify.app/').status, 'valid')
  assert.equal(classifyUrl(null).status, 'missing')
  assert.equal(classifyUrl('   ').status, 'missing')
  assert.equal(classifyUrl('file:///Users/x/site/index.html').status, 'invalid')
  assert.equal(classifyUrl('a.github.io/x').status, 'invalid', 'no scheme → reported, not guessed')
  assert.equal(classifyUrl('http://localhost:5173/').status, 'invalid')
  assert.equal(classifyUrl('http://192.168.1.4/').status, 'invalid')
  assert.equal(classifyUrl('javascript:alert(1)').status, 'invalid')
  assert.equal(classifyUrl('https://user:pw@a.github.io/').status, 'invalid')
  assert.equal(classifyUrl('https://github.com/someone/repo').status, 'invalid')
})

test('re-import keeps ids, positions and creatures; changed link becomes unchecked; new students append per course', () => {
  const rows = S.map(rowOf)
  const changed = [...rows].reverse().map((r) => (r.firstName === 'Ainsley' ? { ...r, url: ' https://ainsley.github.io/world/ ' } : r))
  changed.push({ course: '1101', section: 'pm', firstName: 'New', lastName: 'Principles', url: null, urlSource: 't', sheetRow: 0 })
  const { roster: next, report } = mergeRoster(roster, changed, { '1101': [...pools['1101'], 'c87'], '2241': pools['2241'] }, src)
  for (const s of S) {
    const n = next.students.find((x) => x.id === s.id)!
    assert.equal(n.creatureId, s.creatureId); assert.equal(n.position, s.position); assert.equal(n.fullName, s.fullName)
    if (s.firstName !== 'Ainsley') assert.deepEqual(n.link, s.link, 'unchanged link keeps its audit result')
  }
  const ainsley = next.students.find((s) => s.firstName === 'Ainsley')!
  assert.equal(ainsley.url, 'https://ainsley.github.io/world/'); assert.equal(ainsley.urlStatus, 'valid')
  assert.equal(ainsley.link.status, 'unchecked', 'a new link must be verified before it can be reviewed')
  assert.deepEqual(report.urlChanged, [ainsley.id])
  const ns = next.students.find((s) => s.lastName === 'Principles')!
  assert.equal(ns.id, 'pm-29'); assert.equal(ns.creatureId, 'c87')
})

test('a student who disappears is kept in `removed` and gets the same id back later', () => {
  const rows = S.filter((s) => s.id !== 's02-05').map(rowOf)
  const a = mergeRoster(roster, rows, pools, src)
  assert.equal(a.roster.students.length, 85); assert.deepEqual(a.roster.removed.map((s) => s.id), ['s02-05'])
  const back = S.find((s) => s.id === 's02-05')!
  const b = mergeRoster(a.roster, [...rows, rowOf(back)], pools, src)
  assert.ok(b.roster.students.some((s) => s.id === 's02-05' && s.creatureId === back.creatureId))
  assert.deepEqual(b.report.restored, ['s02-05'])
})

test('same name in two courses is two different students; duplicates within a section are refused', () => {
  const a: ParsedRow = { course: '1101', section: 'pm', firstName: 'Sam', lastName: 'Lee', url: null, urlSource: 't', sheetRow: 1 }
  const b: ParsedRow = { course: '2241', section: '01', firstName: 'Sam', lastName: 'Lee', url: null, urlSource: 't', sheetRow: 2 }
  const r = mergeRoster(null, [a, b], pools, src)
  assert.equal(new Set(r.roster.students.map((s) => s.id)).size, 2)
  assert.throws(() => mergeRoster(null, [a, { ...a, sheetRow: 3 }], pools, src), /Duplicate/)
})

test('v1 roster (Digital Marketing only) upgrades in place', () => {
  const v1 = { schema: 'fairfield-roster', version: 1, source: { file: 'x', sheet: 'y', importedAt: '' }, students: [{ id: 's01-01', section: '01', sectionCode: 'MKTG 2241-01', position: 1, firstName: 'A', lastName: 'B', fullName: 'A B', url: null, urlStatus: 'missing', urlNote: '', creatureId: 'c01' }], removed: [] }
  const u = upgradeRoster(v1)!
  assert.equal(u.version, 2); assert.equal(u.students[0].course, '2241'); assert.equal(u.students[0].link.status, 'unchecked')
})

test('public copy redacts hidden students but keeps their seat', () => {
  const r: Roster = { ...roster, students: S.map((s, i) => (i === 0 ? { ...s, hidden: true } : s)) }
  const p = publicRoster(r)
  assert.equal(p.students.length, 86)
  assert.equal(p.students[0].fullName, 'Reserved seat'); assert.equal(p.students[0].url, null); assert.equal(p.students[0].firstName, '')
})
