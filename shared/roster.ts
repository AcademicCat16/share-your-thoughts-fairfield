/**
 * Roster model for the two classrooms, URL classification and the stable merge used when the instructor re-imports
 * the workbook. Pure functions — shared by scripts/import-roster.ts, the instructor dashboard and the tests.
 *
 * Two courses, two separate review pools:
 *   MKTG 1101 Principles of Marketing — sheet "Website Link": B first name, C last name, D personal site (NEVER used),
 *                                        E interactive website (the only link used).
 *   MKTG 2241 Digital Marketing       — sheet "Your Own Interactive World": B section, C first, D last,
 *                                        E project link, F "Published Website Link" (used when present, see projectCell).
 */
import { cellRef, type Cell, type Sheet } from './xlsx.ts'

export type CourseKey = '1101' | '2241'
export type SectionKey = 'pm' | '01' | '02'

export interface CourseInfo {
  key: CourseKey
  code: string
  title: string
  sheet: string
  expected: number
  sections: { key: SectionKey; code: string; label: string; expected: number }[]
}

export const COURSES: Record<CourseKey, CourseInfo> = {
  '1101': {
    key: '1101', code: 'MKTG 1101', title: 'Principles of Marketing', sheet: 'Website Link', expected: 28,
    sections: [{ key: 'pm', code: 'MKTG 1101', label: '1101', expected: 28 }],
  },
  '2241': {
    key: '2241', code: 'MKTG 2241', title: 'Digital Marketing', sheet: 'Your Own Interactive World', expected: 58,
    sections: [
      { key: '01', code: 'MKTG 2241-01', label: '2241-01', expected: 28 },
      { key: '02', code: 'MKTG 2241-02', label: '2241-02', expected: 30 },
    ],
  },
}
export const COURSE_KEYS: CourseKey[] = ['1101', '2241']
export const TOTAL_EXPECTED = 86
/** Kept for older imports/tests: the Digital Marketing sheet name. */
export const ROSTER_SHEET = COURSES['2241'].sheet
export const SECTIONS = COURSES['2241'].sections

export type UrlStatus = 'valid' | 'missing' | 'invalid'
/** Result of the browser-level link audit (scripts/audit-links.mjs). Only 'working' projects can receive reviews. */
export type LinkStatus = 'working' | 'broken' | 'unchecked'

export interface LinkCheck {
  status: LinkStatus
  checkedAt?: string
  /** Where the browser ended up after redirects. */
  resolvedUrl?: string
  /** Plain-language explanation (why it is broken, or what was seen). */
  note?: string
}

export interface Student {
  /** Deterministic and never reused. 2241: "s01-07" (section + position at first import). 1101: "pm-07". */
  id: string
  course: CourseKey
  courseCode: string
  section: SectionKey
  sectionCode: string
  position: number
  firstName: string
  lastName: string
  fullName: string
  /** The interactive project link (whitespace trimmed, otherwise exactly as submitted). */
  url: string | null
  urlStatus: UrlStatus
  urlNote: string
  /** Which workbook cell the link came from, e.g. "Website Link!E16 (link target; the cell showed a page title)". */
  urlSource?: string
  creatureId: string
  link: LinkCheck
  /** Hidden from the public gallery by the instructor (name and link are not published). */
  hidden?: boolean
}

export interface Roster {
  schema: 'fairfield-roster'
  version: 2
  source: { file: string; sheets: string[]; importedAt: string; sha256?: string }
  students: Student[]
  /** Students present in an earlier import but absent from the latest workbook (kept so their comments stay linked). */
  removed: Student[]
}

export interface ParsedRow {
  course: CourseKey
  section: SectionKey
  firstName: string
  lastName: string
  /** Raw chosen link text (untrimmed) or null. */
  url: string | null
  urlSource: string
  sheetRow: number
}

const str = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c))
/** Trim and collapse inner whitespace (non-breaking spaces included). Spelling is never altered. */
export const cleanName = (s: string) => s.replace(/[\s\u00a0]+/g, ' ').trim()
const trimUrl = (s: string) => s.replace(/^[\s\u00a0\u200b\ufeff]+|[\s\u00a0\u200b\ufeff]+$/g, '')

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?)$/i

/** A link to a GitHub *repository page* (source code), not a published website. */
export function isRepositoryLink(u: URL): boolean {
  return /^(www\.)?github\.com$/i.test(u.hostname)
}

/** Classify a submitted URL. Nothing is guessed or repaired: a URL without https:// is reported, not fixed. */
export function classifyUrl(raw: string | null | undefined): { url: string | null; status: UrlStatus; note: string } {
  const url = trimUrl(raw ?? '')
  if (!url) return { url: null, status: 'missing', note: 'No project link submitted yet.' }
  if (/^file:/i.test(url)) return { url, status: 'invalid', note: "A file:/// link points to a file on the student's own computer — nobody else can open it." }
  let u: URL
  try { u = new URL(url) } catch {
    return { url, status: 'invalid', note: 'Not a complete web address (it should start with https://).' }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { url, status: 'invalid', note: `Unsupported link type "${u.protocol}".` }
  if (u.username || u.password) return { url, status: 'invalid', note: 'Link contains embedded credentials.' }
  if (PRIVATE_HOST.test(u.hostname) || !u.hostname.includes('.')) return { url, status: 'invalid', note: 'Link points to a local or private address, not a public website.' }
  if (isRepositoryLink(u)) return { url, status: 'invalid', note: 'This is a GitHub repository (source code) page, not the published interactive website.' }
  return { url, status: 'valid', note: u.protocol === 'http:' ? 'Public link (not https).' : 'Public web address.' }
}

const looksLikeUrl = (s: string) => /^(https?:|file:)/i.test(trimUrl(s))

/**
 * The link in one cell. The cell's own text is used when it is a web address (it keeps #fragments, which Excel drops
 * from hyperlink targets). When the text is something else — e.g. a page title pasted as a rich link — the cell's
 * hyperlink target is used instead, and the source note says so.
 */
export function linkFromCell(sheet: Sheet, row0: number, col0: number): { url: string | null; source: string } {
  const ref = cellRef(col0, row0 + 1)
  const text = str(sheet.rows[row0]?.[col0])
  const link = sheet.links?.[ref]
  const at = `${sheet.name}!${ref}`
  if (trimUrl(text) && looksLikeUrl(text)) return { url: text, source: at }
  if (link) return { url: link, source: trimUrl(text) ? `${at} (link target; the cell showed "${cleanName(text).slice(0, 60)}")` : `${at} (link target)` }
  if (trimUrl(text)) return { url: text, source: `${at} (text is not a web address)` }
  return { url: null, source: at }
}

function findSheet(sheets: Sheet[], name: string, fallbackIndex: number, warnings: string[]): Sheet {
  const s = sheets.find((x) => x.name.trim().toLowerCase() === name.toLowerCase())
  if (s) return s
  const f = sheets[fallbackIndex]
  if (!f) throw new Error(`Worksheet "${name}" not found.`)
  warnings.push(`Worksheet "${name}" not found by name; used worksheet ${fallbackIndex + 1} "${f.name}".`)
  return f
}

const lower = (c: Cell | undefined) => str(c).trim().toLowerCase()

/** Sheet 1 "Website Link" (MKTG 1101). Column E only. */
function parse1101(sheet: Sheet, warnings: string[]): ParsedRow[] {
  const header = sheet.rows.findIndex((r) => r.some((c) => /interactive website link/i.test(str(c))))
  if (header < 0) throw new Error(`Could not find the "Interactive Website Link" header in "${sheet.name}".`)
  const h = sheet.rows[header]
  // The mapping is fixed (B, C, D, E); verify the headers so a re-arranged sheet is caught instead of silently misread.
  if (!/interactive website link/i.test(str(h[4]))) throw new Error(`"${sheet.name}": column E should be "Interactive Website Link" but is "${str(h[4])}".`)
  if (!/personal website link/i.test(str(h[3]))) warnings.push(`"${sheet.name}": column D header is "${str(h[3])}" (expected "Personal Website Link"); column D is ignored either way.`)
  if (lower(h[1]) !== 'name' && lower(h[1]) !== 'first name') warnings.push(`"${sheet.name}": column B header is "${str(h[1])}" (expected "Name").`)
  const rows: ParsedRow[] = []
  for (let i = header + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] ?? []
    const first = cleanName(str(r[1])); const last = cleanName(str(r[2]))
    const e = linkFromCell(sheet, i, 4)
    if (!first && !last && !e.url) continue
    if (!first || !last) warnings.push(`${sheet.name} row ${i + 1}: name is incomplete ("${first}" "${last}") — kept exactly as written.`)
    rows.push({ course: '1101', section: 'pm', firstName: first, lastName: last, url: e.url, urlSource: e.source, sheetRow: i + 1 })
  }
  return rows
}

/** Sheet 2 "Your Own Interactive World" (MKTG 2241). */
function parse2241(sheet: Sheet, warnings: string[]): ParsedRow[] {
  const header = sheet.rows.findIndex((r) => r.some((c) => /^class$/i.test(str(c).trim())))
  if (header < 0) throw new Error(`Could not find the header row (a "Class" column) in "${sheet.name}".`)
  const h = sheet.rows[header].map((c) => lower(c))
  const cSection = h.indexOf('class')
  const cFirst = h.findIndex((x) => x === 'name' || x === 'first name')
  const cLast = h.indexOf('last name') >= 0 ? h.indexOf('last name') : cFirst + 1
  const cE = h.findIndex((x) => /link|url/.test(x))
  const cPublished = h.findIndex((x) => /published/.test(x))
  if (cFirst < 0 || cE < 0) throw new Error(`"${sheet.name}": expected "Name" and "...Link" columns in the header row.`)
  const rows: ParsedRow[] = []
  for (let i = header + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] ?? []
    const first = cleanName(str(r[cFirst])); const last = cleanName(str(r[cLast]))
    const m = str(r[cSection]).match(/2241\s*-\s*0?([12])\b/)
    const sec = m ? (`0${m[1]}` as SectionKey) : null
    const e = linkFromCell(sheet, i, cE)
    const f = cPublished >= 0 && cPublished !== cE ? linkFromCell(sheet, i, cPublished) : { url: null, source: '' }
    if (!first && !last && !sec && !e.url && !f.url) continue
    if (!sec) { warnings.push(`${sheet.name} row ${i + 1}: unknown class section "${str(r[cSection])}" — skipped.`); continue }
    if (!first || !last) warnings.push(`${sheet.name} row ${i + 1}: name is incomplete ("${first}" "${last}") — kept exactly as written.`)
    // A "Published Website Link" (column F) is the interactive site itself; column E then usually holds the
    // repository. Only when F is empty is column E used.
    const chosen = f.url && trimUrl(f.url) ? { ...f, source: `${f.source} (published website; ${cellRef(cE, i + 1)} held ${trimUrl(e.url ?? '') || 'nothing'})` } : e
    rows.push({ course: '2241', section: sec, firstName: first, lastName: last, url: chosen.url, urlSource: chosen.source, sheetRow: i + 1 })
  }
  return rows
}

export interface ParsedWorkbook { sheets: string[]; rows: ParsedRow[]; warnings: string[] }

/** Read both classroom sheets. Throws (rather than guessing) when the layout is not recognised. */
export function parseWorkbook(sheets: Sheet[]): ParsedWorkbook {
  const warnings: string[] = []
  const s1 = findSheet(sheets, COURSES['1101'].sheet, 0, warnings)
  const s2 = findSheet(sheets, COURSES['2241'].sheet, 1, warnings)
  return { sheets: [s1.name, s2.name], rows: [...parse1101(s1, warnings), ...parse2241(s2, warnings)], warnings }
}

const nameKey = (course: string, section: string, first: string, last: string) => `${course}|${section}|${cleanName(`${first} ${last}`).toLowerCase()}`

/** Fixed, seeded order in which creatures are handed out the first time. */
export function creatureOrder(ids: string[], seed = 'fairfield-thanksgiving-2026'): string[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  const rand = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296 }
  const a = [...ids]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
/** Creature hand-out seed per course (2241 keeps the original seed, so its order never changes). */
export const CREATURE_SEED: Record<CourseKey, string> = { '2241': 'fairfield-thanksgiving-2026', '1101': 'fairfield-harvest-market-1101' }

export interface MergeReport { added: string[]; kept: string[]; urlChanged: string[]; removed: string[]; restored: string[] }

const sectionInfo = (course: CourseKey, section: SectionKey) => COURSES[course].sections.find((s) => s.key === section)!
const newId = (course: CourseKey, section: SectionKey, position: number) =>
  course === '1101' ? `pm-${String(position).padStart(2, '0')}` : `s${section}-${String(position).padStart(2, '0')}`

/** Upgrade a version-1 (Digital Marketing only) roster in memory. */
export function upgradeRoster(r: unknown): Roster | null {
  if (!r || typeof r !== 'object') return null
  const x = r as { version?: number; students?: Partial<Student>[]; removed?: Partial<Student>[]; source?: { file?: string; sheet?: string; sheets?: string[]; importedAt?: string; sha256?: string } }
  if (x.version === 2) return x as unknown as Roster
  const fix = (s: Partial<Student>): Student => ({
    ...(s as Student), course: '2241', courseCode: 'MKTG 2241', link: s.link ?? { status: 'unchecked' },
  })
  return {
    schema: 'fairfield-roster', version: 2,
    source: { file: x.source?.file ?? '', sheets: x.source?.sheets ?? (x.source?.sheet ? [x.source.sheet] : []), importedAt: x.source?.importedAt ?? '', sha256: x.source?.sha256 },
    students: (x.students ?? []).map(fix), removed: (x.removed ?? []).map(fix),
  }
}

/**
 * Merge freshly parsed rows into the previous roster.
 * - A returning student (same course + section + name) keeps id, position and creature — so comments and the
 *   creature never move. Only the link fields are refreshed; the last link-audit result is kept when the link is
 *   unchanged and reset to "unchecked" when it changed (so a new link must be verified before it can be reviewed).
 * - A new student gets the next unused position and the next unused creature from their course's pool.
 * - A student missing from the new workbook is moved to `removed` (never deleted, never re-numbered).
 */
export function mergeRoster(prevIn: Roster | null, rows: ParsedRow[], pools: Record<CourseKey, string[]>, source: Roster['source']): { roster: Roster; report: MergeReport } {
  const prev = prevIn ? upgradeRoster(prevIn) : null
  const report: MergeReport = { added: [], kept: [], urlChanged: [], removed: [], restored: [] }
  const old = new Map<string, Student>()
  for (const s of [...(prev?.removed ?? []), ...(prev?.students ?? [])]) {
    if (s.hidden && !s.firstName && !s.lastName) throw new Error(`Previous roster has a redacted hidden student (${s.id}); re-import from private/roster_full.json instead.`)
    old.set(nameKey(s.course, s.section, s.firstName, s.lastName), s)
  }
  const wasRemoved = new Set((prev?.removed ?? []).map((s) => s.id))
  const usedPos: Record<string, number> = {}
  const usedCreatures = new Set<string>()
  for (const s of old.values()) { const k = `${s.course}|${s.section}`; usedPos[k] = Math.max(usedPos[k] ?? 0, s.position); usedCreatures.add(s.creatureId) }
  const free: Record<CourseKey, string[]> = {
    '1101': creatureOrder(pools['1101'], CREATURE_SEED['1101']).filter((c) => !usedCreatures.has(c)),
    '2241': creatureOrder(pools['2241'], CREATURE_SEED['2241']).filter((c) => !usedCreatures.has(c)),
  }

  const seen = new Set<string>()
  const students: Student[] = []
  for (const r of rows) {
    const key = nameKey(r.course, r.section, r.firstName, r.lastName)
    if (seen.has(key)) throw new Error(`Duplicate student in ${sectionInfo(r.course, r.section).code}: "${r.firstName} ${r.lastName}" (sheet row ${r.sheetRow}).`)
    seen.add(key)
    const u = classifyUrl(r.url)
    const before = old.get(key)
    const fullName = cleanName(`${r.firstName} ${r.lastName}`)
    if (before) {
      const changed = before.url !== u.url || before.urlStatus !== u.status
      if (changed) report.urlChanged.push(before.id)
      if (wasRemoved.has(before.id)) report.restored.push(before.id); else report.kept.push(before.id)
      students.push({
        ...before, firstName: r.firstName, lastName: r.lastName, fullName,
        url: u.url, urlStatus: u.status, urlNote: u.note, urlSource: r.urlSource,
        link: changed || u.status !== 'valid' ? { status: 'unchecked' } : before.link ?? { status: 'unchecked' },
      })
    } else {
      const pk = `${r.course}|${r.section}`
      const position = (usedPos[pk] = (usedPos[pk] ?? 0) + 1)
      const creatureId = free[r.course].shift()
      if (!creatureId) throw new Error(`More ${COURSES[r.course].code} students than creatures — add creatures before importing.`)
      const sec = sectionInfo(r.course, r.section)
      const s: Student = {
        id: newId(r.course, r.section, position), course: r.course, courseCode: COURSES[r.course].code, section: r.section, sectionCode: sec.code, position,
        firstName: r.firstName, lastName: r.lastName, fullName,
        url: u.url, urlStatus: u.status, urlNote: u.note, urlSource: r.urlSource, creatureId, link: { status: 'unchecked' },
      }
      report.added.push(s.id)
      students.push(s)
    }
  }
  const nowIds = new Set(students.map((s) => s.id))
  const removed = [...old.values()].filter((s) => !nowIds.has(s.id))
  for (const s of removed) if (!wasRemoved.has(s.id)) report.removed.push(s.id)
  const order = (s: Student) => `${s.course}|${s.section}|${String(s.position).padStart(4, '0')}`
  students.sort((a, b) => order(a).localeCompare(order(b)))
  return { roster: { schema: 'fairfield-roster', version: 2, source, students, removed }, report }
}

/** A project that may receive reviews: valid link, verified working by the audit, not hidden. */
export const isReviewable = (s: Student | undefined | null): boolean =>
  !!s && !s.hidden && s.urlStatus === 'valid' && !!s.url && s.link?.status === 'working'

/** Why a desk has an empty chair (for the friendly message). */
export function unavailableReason(s: Student): 'missing' | 'invalid' | 'broken' | 'unchecked' | 'hidden' | null {
  if (s.hidden) return 'hidden'
  if (s.urlStatus === 'missing') return 'missing'
  if (s.urlStatus === 'invalid') return 'invalid'
  if (s.link?.status === 'broken') return 'broken'
  if (s.link?.status !== 'working') return 'unchecked'
  return null
}

export const studentsOf = (r: Roster | Student[], course: CourseKey) => (Array.isArray(r) ? r : r.students).filter((s) => s.course === course)

export function rosterCounts(r: Roster, course?: CourseKey) {
  const list = course ? studentsOf(r, course) : r.students
  const by = (sec: SectionKey) => list.filter((s) => s.section === sec).length
  return {
    total: list.length,
    c1101: list.filter((s) => s.course === '1101').length,
    c2241: list.filter((s) => s.course === '2241').length,
    section01: by('01'),
    section02: by('02'),
    valid: list.filter((s) => s.urlStatus === 'valid').length,
    missing: list.filter((s) => s.urlStatus === 'missing').length,
    invalid: list.filter((s) => s.urlStatus === 'invalid').length,
    working: list.filter((s) => isReviewable(s)).length,
    broken: list.filter((s) => s.urlStatus === 'valid' && s.link?.status === 'broken').length,
    unchecked: list.filter((s) => s.urlStatus === 'valid' && s.link?.status === 'unchecked').length,
    hidden: list.filter((s) => s.hidden).length,
  }
}

export function countProblems(r: Roster): string[] {
  const out: string[] = []
  for (const c of COURSE_KEYS) {
    const info = COURSES[c]
    const list = studentsOf(r, c)
    if (list.length !== info.expected) out.push(`${info.code}: expected ${info.expected} students, found ${list.length}.`)
    if (info.sections.length > 1) for (const s of info.sections) {
      const n = list.filter((x) => x.section === s.key).length
      if (n !== s.expected) out.push(`${s.code}: expected ${s.expected} students, found ${n}.`)
    }
  }
  if (r.students.length !== TOTAL_EXPECTED) out.push(`Expected ${TOTAL_EXPECTED} students in total, found ${r.students.length}.`)
  return out
}

/** The public copy: hidden students keep their seat but lose name and link. */
export function publicRoster(r: Roster): Roster {
  const redact = (s: Student): Student => (s.hidden
    ? { ...s, firstName: '', lastName: '', fullName: 'Reserved seat', url: null, urlStatus: 'missing', urlNote: 'Hidden from the public gallery by the instructor.', urlSource: undefined, link: { status: 'unchecked' } }
    : s)
  return { ...r, students: r.students.map(redact), removed: r.removed.map(redact) }
}
