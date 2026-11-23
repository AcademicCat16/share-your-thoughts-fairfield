/**
 * Build supabase/seed/roster_upsert.sql from the roster (npm run live-sql).
 *
 * Reads private/roster_full.json (written by `npm run import-roster`; link results from `npm run audit-links`), or
 * src/data/roster.json when that is absent.
 *
 * - Every student in `students` (both courses) is inserted or updated: course, section, names, project link, URL
 *   status, link-audit status, hidden flag — and set active. The instructor's `participating` choice is kept.
 * - Every student already in the database but NOT in `students` is set active = false (their comments stay linked;
 *   nothing is ever deleted).
 *
 * The file contains names and project links only (no access codes). Paste it into the Supabase SQL editor after the
 * migration, and again whenever the roster is re-imported or the links are re-audited.
 * (testing only: --roster <file> and --out <file> override the default paths)
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Roster, Student } from '../shared/roster.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRIVATE_ROSTER = path.join(ROOT, 'private', 'roster_full.json')
const PUBLIC_ROSTER = path.join(ROOT, 'src', 'data', 'roster.json')

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  if (i < 0) return null
  const v = process.argv[i + 1]
  if (!v) throw new Error(`${name} needs a path`)
  return path.resolve(v)
}

/** SQL string literal (the file sets standard_conforming_strings on, so only ' needs doubling). */
function sqlStr(s: string | null | undefined): string {
  if (s === null || s === undefined) return 'null'
  if (s.includes('\u0000')) throw new Error('A roster value contains a NUL character.')
  return `'${s.replace(/'/g, "''")}'`
}

const COURSES = new Set(['1101', '2241'])
const SECTIONS: Record<string, Set<string>> = { '1101': new Set(['pm']), '2241': new Set(['01', '02']) }
const URL_STATUSES = new Set(['valid', 'missing', 'invalid'])
const LINK_STATUSES = new Set(['working', 'broken', 'unchecked'])

function check(s: Student): void {
  if (typeof s.id !== 'string' || !/^(pm|s0[12])-\d{2,}$/.test(s.id)) throw new Error(`Unexpected student id "${s.id}".`)
  if (!COURSES.has(s.course)) throw new Error(`Student ${s.id}: unknown course "${s.course}".`)
  if (!SECTIONS[s.course].has(s.section)) throw new Error(`Student ${s.id}: section "${s.section}" is not a section of ${s.course}.`)
  if (!URL_STATUSES.has(s.urlStatus)) throw new Error(`Student ${s.id}: unknown urlStatus "${s.urlStatus}".`)
  const link = s.link?.status ?? 'unchecked'
  if (!LINK_STATUSES.has(link)) throw new Error(`Student ${s.id}: unknown link status "${link}".`)
  if (typeof s.fullName !== 'string' || !s.fullName.trim()) throw new Error(`Student ${s.id}: empty fullName.`)
  if (s.url !== null && s.url !== undefined && typeof s.url !== 'string') throw new Error(`Student ${s.id}: url is not text.`)
  if (s.hidden !== undefined && typeof s.hidden !== 'boolean') throw new Error(`Student ${s.id}: hidden must be true/false.`)
}

async function main(): Promise<void> {
  const explicit = arg('--roster')
  const ROSTER = explicit ?? (existsSync(PRIVATE_ROSTER) ? PRIVATE_ROSTER : PUBLIC_ROSTER)
  const OUT = arg('--out') ?? path.join(ROOT, 'supabase', 'seed', 'roster_upsert.sql')
  if (!existsSync(ROSTER)) {
    throw new Error(`Roster not found: ${path.relative(ROOT, ROSTER)}\nRun "npm run import-roster" first to create it from the spreadsheet.`)
  }
  const roster = JSON.parse(await readFile(ROSTER, 'utf8')) as Roster
  if (!roster || !Array.isArray(roster.students)) throw new Error(`${path.relative(ROOT, ROSTER)} has no "students" array.`)
  if (roster.students.length === 0) throw new Error('The roster has no students; refusing to mark everyone inactive.')
  roster.students.forEach(check)
  const ids = new Set(roster.students.map((s) => s.id))
  if (ids.size !== roster.students.length) throw new Error('Duplicate student ids in roster.students.')
  // The public copy redacts hidden students; uploading it would wipe their real names and links.
  if (ROSTER === PUBLIC_ROSTER && roster.students.some((s) => s.hidden)) {
    throw new Error('src/data/roster.json hides some students (names removed). Use private/roster_full.json (npm run import-roster).')
  }
  const removed = Array.isArray(roster.removed) ? roster.removed : []

  const students = [...roster.students].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const values = students.map((s) => '  (' + [
    sqlStr(s.id), sqlStr(s.course), sqlStr(s.section), sqlStr(s.sectionCode ?? ''), sqlStr(s.firstName ?? ''),
    sqlStr(s.lastName ?? ''), sqlStr(s.fullName), sqlStr(s.url ?? null), sqlStr(s.urlStatus),
    sqlStr(s.link?.status ?? 'unchecked'), s.hidden ? 'true' : 'false', 'true',
  ].join(', ') + ')')

  const by = (c: string) => students.filter((s) => s.course === c).length
  const reviewable = students.filter((s) => !s.hidden && s.urlStatus === 'valid' && s.link?.status === 'working').length
  const oneLine = (s: string | undefined) => (s ?? 'unknown').replace(/[\r\n]/g, ' ')
  const lines = [
    `-- Roster upsert generated ${new Date().toISOString()} from ${path.basename(ROSTER)}`,
    `-- (source: ${oneLine(roster.source?.file)}, imported ${oneLine(roster.source?.importedAt)}).`,
    `-- ${students.length} student(s): MKTG 1101 ${by('1101')}, MKTG 2241 ${by('2241')}; ${reviewable} with a working link.`,
    `-- ${removed.length} listed as removed. Students not on this roster are set inactive. Never deletes rows.`,
    '-- Paste into the Supabase SQL editor after supabase/migrations/001_feedback_classroom.sql.',
    'begin;',
    'set local standard_conforming_strings = on;',
    'insert into public.students (id, course, section, section_code, first_name, last_name, full_name, project_url,',
    '                             url_status, link_status, hidden, active) values',
    values.join(',\n'),
    'on conflict (id) do update set course = excluded.course, section = excluded.section,',
    '  section_code = excluded.section_code, first_name = excluded.first_name, last_name = excluded.last_name,',
    '  full_name = excluded.full_name, project_url = excluded.project_url, url_status = excluded.url_status,',
    '  link_status = excluded.link_status, hidden = excluded.hidden, active = true;',
    '-- (participating is not touched: it is the instructor\'s choice on the dashboard)',
    `update public.students set active = false where active and id not in (${students.map((s) => sqlStr(s.id)).join(', ')});`,
    'commit;',
    '',
  ]

  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, lines.join('\n'), 'utf8')
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${students.length} students (1101: ${by('1101')}, 2241: ${by('2241')}), ${reviewable} reviewable; everyone else set inactive.`)
}

main().catch((e: unknown) => {
  console.error(`build-live-sql: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
