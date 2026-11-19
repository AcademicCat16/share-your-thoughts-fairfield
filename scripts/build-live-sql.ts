/**
 * Build supabase/seed/roster_upsert.sql from src/data/roster.json (npm run live-sql).
 *
 * - Every student in `students` is inserted or updated (names, section, URL, URL status) and set active.
 * - Every student in `removed` is set active = false (their comments stay linked; nothing is ever deleted).
 *
 * The file contains names and project links only (the same data the public site shows) — no access codes.
 * Paste it into the Supabase SQL editor after the migration, and again whenever the roster is re-imported.
 * (testing only: --roster <file> and --out <file> override the default paths)
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Roster, Student } from '../shared/roster.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  if (!v) throw new Error(`${name} needs a path`)
  return path.resolve(v)
}
const ROSTER = arg('--roster', path.join(ROOT, 'src', 'data', 'roster.json'))
const OUT = arg('--out', path.join(ROOT, 'supabase', 'seed', 'roster_upsert.sql'))

const sqlStr = (s: string | null | undefined) => (s === null || s === undefined ? 'null' : `'${s.replace(/'/g, "''")}'`)
const STATUSES = new Set(['valid', 'missing', 'invalid'])

function check(s: Student): void {
  if (!/^s\d{2}-\d{2,}$/.test(s.id)) throw new Error(`Unexpected student id "${s.id}".`)
  if (!STATUSES.has(s.urlStatus)) throw new Error(`Student ${s.id}: unknown urlStatus "${s.urlStatus}".`)
  if (!s.fullName) throw new Error(`Student ${s.id}: empty fullName.`)
}

async function main(): Promise<void> {
  if (!existsSync(ROSTER)) {
    throw new Error(`Roster not found: ${path.relative(ROOT, ROSTER)}\nRun "npm run import-roster" first to create it from the spreadsheet.`)
  }
  const roster = JSON.parse(await readFile(ROSTER, 'utf8')) as Roster
  if (!roster || !Array.isArray(roster.students)) throw new Error(`${path.relative(ROOT, ROSTER)} has no "students" array.`)
  const removed = Array.isArray(roster.removed) ? roster.removed : []
  roster.students.forEach(check)
  const activeIds = new Set(roster.students.map((s) => s.id))
  if (activeIds.size !== roster.students.length) throw new Error('Duplicate student ids in roster.students.')
  const clash = removed.filter((s) => activeIds.has(s.id)).map((s) => s.id)
  if (clash.length) throw new Error(`Ids listed as both active and removed: ${clash.join(', ')}`)

  const values = roster.students.map((s) =>
    `  (${[s.id, s.section, s.sectionCode, s.firstName, s.lastName, s.fullName].map(sqlStr).join(', ')}, ${sqlStr(s.url)}, ${sqlStr(s.urlStatus)}, true)`)

  const lines = [
    `-- Roster upsert generated ${new Date().toISOString()} from src/data/roster.json`,
    `-- (source: ${(roster.source?.file ?? 'unknown').replace(/[\r\n]/g, ' ')}, imported ${(roster.source?.importedAt ?? 'unknown').replace(/[\r\n]/g, ' ')}).`,
    `-- ${roster.students.length} active student(s), ${removed.length} removed. Never deletes rows, so comments survive.`,
    '-- Paste into the Supabase SQL editor after supabase/migrations/001_feedback_classroom.sql.',
    'begin;',
  ]
  if (values.length) {
    lines.push(
      'insert into public.students (id, section, section_code, first_name, last_name, full_name, project_url, url_status, active) values',
      values.join(',\n'),
      'on conflict (id) do update set section = excluded.section, section_code = excluded.section_code,',
      '  first_name = excluded.first_name, last_name = excluded.last_name, full_name = excluded.full_name,',
      '  project_url = excluded.project_url, url_status = excluded.url_status, active = true;',
    )
  }
  if (removed.length) {
    lines.push(`update public.students set active = false where id in (${removed.map((s) => sqlStr(s.id)).join(', ')});`)
  }
  lines.push('commit;', '')

  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, lines.join('\n'), 'utf8')
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${roster.students.length} active, ${removed.length} set inactive.`)
}

main().catch((e: unknown) => {
  console.error(`build-live-sql: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
