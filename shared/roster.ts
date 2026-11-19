/**
 * Roster model, URL classification and the stable merge used when the instructor re-imports
 * the spreadsheet. Pure functions — shared by scripts/import-roster.ts, the dashboard and tests.
 */
import type { Cell, Sheet } from './xlsx.ts'

export const ROSTER_SHEET = 'Your Own Interactive World'
export const SECTIONS = [
  { key: '01', code: 'MKTG 2241-01', expected: 28 },
  { key: '02', code: 'MKTG 2241-02', expected: 30 },
] as const
export type SectionKey = (typeof SECTIONS)[number]['key']
export const TOTAL_EXPECTED = 58

export type UrlStatus = 'valid' | 'missing' | 'invalid'

export interface Student {
  /** Deterministic: section + position in that section at first import, e.g. "s01-07". Never reused. */
  id: string
  section: SectionKey
  sectionCode: string
  position: number
  firstName: string
  lastName: string
  fullName: string
  url: string | null
  urlStatus: UrlStatus
  urlNote: string
  creatureId: string
}

export interface Roster {
  schema: 'fairfield-roster'
  version: 1
  source: { file: string; sheet: string; importedAt: string; sha256?: string }
  students: Student[]
  /** Students present in an earlier import but absent from the latest spreadsheet (kept so their comments stay linked). */
  removed: Student[]
}

export interface ParsedRow { section: SectionKey; firstName: string; lastName: string; url: string | null; sheetRow: number }

const str = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c))
/** Trim and collapse inner whitespace (non-breaking spaces included). Spelling is never altered. */
export const cleanName = (s: string) => s.replace(/[\s ]+/g, ' ').trim()

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?)$/i

/** Classify a submitted URL. Nothing is guessed or repaired: a URL without https:// is reported, not fixed. */
export function classifyUrl(raw: string | null | undefined): { url: string | null; status: UrlStatus; note: string } {
  const url = (raw ?? '').replace(/^[\s ​]+|[\s ​]+$/g, '')
  if (!url) return { url: null, status: 'missing', note: 'No project link submitted yet.' }
  if (/^file:/i.test(url)) return { url, status: 'invalid', note: "A file:/// link points to a file on the student's own computer — nobody else can open it." }
  let u: URL
  try { u = new URL(url) } catch {
    return { url, status: 'invalid', note: 'Not a complete web address (it should start with https://).' }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { url, status: 'invalid', note: `Unsupported link type "${u.protocol}".` }
  if (u.username || u.password) return { url, status: 'invalid', note: 'Link contains embedded credentials.' }
  if (PRIVATE_HOST.test(u.hostname) || !u.hostname.includes('.')) return { url, status: 'invalid', note: 'Link points to a local or private address, not a public website.' }
  return { url, status: 'valid', note: u.protocol === 'http:' ? 'Public link (not https).' : 'Public web address.' }
}

function normSection(c: Cell): SectionKey | null {
  const m = str(c).match(/2241\s*-\s*0?([12])\b/)
  return m ? (`0${m[1]}` as SectionKey) : null
}

/** Find the roster sheet by name (falls back to the second worksheet) and read its rows. */
export function parseRosterSheet(sheets: Sheet[]): { sheet: string; rows: ParsedRow[]; warnings: string[] } {
  const warnings: string[] = []
  let sheet = sheets.find((s) => s.name.trim().toLowerCase() === ROSTER_SHEET.toLowerCase())
  if (!sheet) {
    sheet = sheets[1]
    if (!sheet) throw new Error(`Worksheet "${ROSTER_SHEET}" not found and the workbook has no second worksheet.`)
    warnings.push(`Worksheet "${ROSTER_SHEET}" not found by name; used the second worksheet "${sheet.name}".`)
  }
  const header = sheet.rows.findIndex((r) => r.some((c) => /^class$/i.test(str(c).trim())))
  if (header < 0) throw new Error(`Could not find the header row (a "Class" column) in "${sheet.name}".`)
  const h = sheet.rows[header].map((c) => str(c).trim().toLowerCase())
  const cSection = h.indexOf('class')
  const cFirst = h.findIndex((x) => x === 'name' || x === 'first name')
  const cLast = h.findIndex((x) => x === 'last name') >= 0 ? h.findIndex((x) => x === 'last name') : cFirst + 1
  const cUrl = h.findIndex((x) => /link|url/.test(x))
  if (cFirst < 0 || cUrl < 0) throw new Error('Expected "Name" and "...Link" columns in the header row.')

  const rows: ParsedRow[] = []
  sheet.rows.slice(header + 1).forEach((r, i) => {
    const sheetRow = header + 2 + i
    const first = cleanName(str(r[cFirst])); const last = cleanName(str(r[cLast]))
    const sec = normSection(r[cSection])
    const url = str(r[cUrl])
    if (!first && !last && !sec && !url.trim()) return // blank row
    if (!sec) { warnings.push(`Row ${sheetRow}: unknown class section "${str(r[cSection])}" — skipped.`); return }
    if (!first || !last) warnings.push(`Row ${sheetRow}: name is incomplete ("${first}" "${last}") — kept exactly as written.`)
    rows.push({ section: sec, firstName: first, lastName: last, url: url || null, sheetRow })
  })
  return { sheet: sheet.name, rows, warnings }
}

const nameKey = (section: string, first: string, last: string) => `${section}|${cleanName(`${first} ${last}`).toLowerCase()}`

/** Fixed, seeded order in which creatures are handed out the first time. */
export function creatureOrder(ids: string[], seed = 'fairfield-thanksgiving-2026'): string[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  const rand = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296 }
  const a = [...ids]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

export interface MergeReport { added: string[]; kept: string[]; urlChanged: string[]; removed: string[]; restored: string[] }

/**
 * Merge freshly parsed rows into the previous roster.
 * - A returning student (same section + same name) keeps id, position and creature — so comments and the
 *   creature never move. Only the URL fields are refreshed.
 * - A new student gets the next unused position in their section and the next unused creature.
 * - A student missing from the new sheet is moved to `removed` (never deleted, never re-numbered).
 */
export function mergeRoster(prev: Roster | null, rows: ParsedRow[], creatureIds: string[], source: Roster['source']): { roster: Roster; report: MergeReport } {
  const report: MergeReport = { added: [], kept: [], urlChanged: [], removed: [], restored: [] }
  const old = new Map<string, Student>()
  for (const s of [...(prev?.removed ?? []), ...(prev?.students ?? [])]) old.set(nameKey(s.section, s.firstName, s.lastName), s)
  const wasRemoved = new Set((prev?.removed ?? []).map((s) => s.id))
  const usedPos: Record<string, number> = {}
  const usedCreatures = new Set<string>()
  for (const s of old.values()) { usedPos[s.section] = Math.max(usedPos[s.section] ?? 0, s.position); usedCreatures.add(s.creatureId) }
  const freeCreatures = creatureOrder(creatureIds).filter((c) => !usedCreatures.has(c))

  const seen = new Set<string>()
  const students: Student[] = []
  for (const r of rows) {
    const key = nameKey(r.section, r.firstName, r.lastName)
    if (seen.has(key)) throw new Error(`Duplicate student in section ${r.section}: "${r.firstName} ${r.lastName}" (sheet row ${r.sheetRow}).`)
    seen.add(key)
    const u = classifyUrl(r.url)
    const before = old.get(key)
    if (before) {
      if (before.url !== u.url || before.urlStatus !== u.status) report.urlChanged.push(before.id)
      if (wasRemoved.has(before.id)) report.restored.push(before.id); else report.kept.push(before.id)
      students.push({ ...before, firstName: r.firstName, lastName: r.lastName, fullName: cleanName(`${r.firstName} ${r.lastName}`), url: u.url, urlStatus: u.status, urlNote: u.note })
    } else {
      const position = (usedPos[r.section] = (usedPos[r.section] ?? 0) + 1)
      const creatureId = freeCreatures.shift()
      if (!creatureId) throw new Error('More students than creatures — add creatures to shared/creatures.ts before importing.')
      const sec = SECTIONS.find((s) => s.key === r.section)!
      const s: Student = {
        id: `s${r.section}-${String(position).padStart(2, '0')}`, section: r.section, sectionCode: sec.code, position,
        firstName: r.firstName, lastName: r.lastName, fullName: cleanName(`${r.firstName} ${r.lastName}`),
        url: u.url, urlStatus: u.status, urlNote: u.note, creatureId,
      }
      report.added.push(s.id)
      students.push(s)
    }
  }
  const nowIds = new Set(students.map((s) => s.id))
  const removed = [...old.values()].filter((s) => !nowIds.has(s.id))
  for (const s of removed) if (!wasRemoved.has(s.id)) report.removed.push(s.id)
  students.sort((a, b) => a.section.localeCompare(b.section) || a.position - b.position)
  return { roster: { schema: 'fairfield-roster', version: 1, source, students, removed }, report }
}

export function rosterCounts(r: Roster) {
  const by = (sec: string) => r.students.filter((s) => s.section === sec).length
  return {
    total: r.students.length,
    section01: by('01'),
    section02: by('02'),
    valid: r.students.filter((s) => s.urlStatus === 'valid').length,
    missing: r.students.filter((s) => s.urlStatus === 'missing').length,
    invalid: r.students.filter((s) => s.urlStatus === 'invalid').length,
  }
}

export function countProblems(r: Roster): string[] {
  const c = rosterCounts(r); const out: string[] = []
  for (const s of SECTIONS) {
    const n = s.key === '01' ? c.section01 : c.section02
    if (n !== s.expected) out.push(`${s.code}: expected ${s.expected} students, found ${n}.`)
  }
  if (c.total !== TOTAL_EXPECTED) out.push(`Expected ${TOTAL_EXPECTED} students in total, found ${c.total}.`)
  return out
}
