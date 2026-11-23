/**
 * Generate one private access code per student for Live mode (both courses).
 *
 *   npm run access-codes                            # every student on the roster (MKTG 1101 and MKTG 2241)
 *   npm run access-codes -- --only s01-03,pm-07     # rotate just these students (their old codes stop working)
 *   (testing only: --roster <file> reads another roster, --out-dir <dir> writes somewhere other than private/)
 *
 * Reads private/roster_full.json (written by `npm run import-roster`), or src/data/roster.json when that is absent.
 * Only students listed in `students` get codes (students in `removed` have left).
 *
 * Writes (both inside the git-ignored private/ folder):
 *   private/access_codes_<YYYY-MM-DD>.csv  student_id, course, section, first_name, last_name, code — hand these out
 *                                          privately, one per student.
 *   private/access_codes_upsert.sql        SHA-256 hashes only — paste into the Supabase SQL editor.
 *
 * Codes come from newAccessCode() and are hashed with hashAccessCode() (shared/accessCode.ts) exactly the way the
 * database function redeem_access_code() hashes what a student types. Codes are never printed to the terminal and
 * nothing is sent anywhere.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashAccessCode, newAccessCode } from '../shared/accessCode.ts'
import type { Roster, Student } from '../shared/roster.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRIVATE_ROSTER = path.join(ROOT, 'private', 'roster_full.json')
const PUBLIC_ROSTER = path.join(ROOT, 'src', 'data', 'roster.json')
const DEFAULT_OUT = path.join(ROOT, 'private')
const USAGE = 'Usage: npm run access-codes [-- --only s01-03,pm-07]'

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`
/** CSV cell; quotes when needed, and defuses spreadsheet formulas (a cell starting with = + - @ or a tab). */
const csvCell = (s: string) => (/[",\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface Args { only: string[] | null; roster: string | null; outDir: string }

function parseArgs(argv: string[]): Args {
  let only: string[] | null = null
  let roster: string | null = null
  let outDir = DEFAULT_OUT
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--roster' || a === '--out-dir') {
      const v = argv[++i]
      if (!v) throw new Error(`${a} needs a path`)
      if (a === '--roster') roster = path.resolve(v); else outDir = path.resolve(v)
    } else if (a === '--only' || a.startsWith('--only=')) {
      const v = a === '--only' ? argv[++i] : a.slice('--only='.length)
      if (!v) throw new Error('--only needs a comma-separated list of student ids, e.g. --only s01-03,pm-07')
      only = v.split(',').map((x) => x.trim()).filter(Boolean)
    } else if (a === '--help' || a === '-h') {
      console.log(USAGE)
      process.exit(0)
    } else throw new Error(`Unknown option "${a}". ${USAGE}`)
  }
  return { only, roster, outDir }
}

function pickRoster(explicit: string | null): string {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`Roster not found: ${path.relative(ROOT, explicit)}`)
    return explicit
  }
  if (existsSync(PRIVATE_ROSTER)) return PRIVATE_ROSTER
  if (existsSync(PUBLIC_ROSTER)) return PUBLIC_ROSTER
  throw new Error(`Roster not found: ${path.relative(ROOT, PRIVATE_ROSTER)}\nRun "npm run import-roster" first to create it from the spreadsheet.`)
}

async function main(): Promise<void> {
  const { only, roster: explicitRoster, outDir: PRIVATE } = parseArgs(process.argv.slice(2))
  const ROSTER = pickRoster(explicitRoster)
  const roster = JSON.parse(await readFile(ROSTER, 'utf8')) as Roster
  if (!roster || !Array.isArray(roster.students)) throw new Error(`${path.relative(ROOT, ROSTER)} has no "students" array.`)
  const ids = new Set<string>()
  for (const s of roster.students) {
    if (!s || typeof s.id !== 'string' || !s.id) throw new Error('A student in the roster has no id.')
    if (ids.has(s.id)) throw new Error(`Duplicate student id in the roster: ${s.id}`)
    ids.add(s.id)
  }

  let chosen: Student[] = roster.students
  if (only) {
    const byId = new Map(roster.students.map((s) => [s.id, s]))
    const unknown = only.filter((id) => !byId.has(id))
    if (unknown.length) throw new Error(`Not students on the roster: ${unknown.join(', ')}`)
    chosen = [...new Set(only)].map((id) => byId.get(id)!)
  }
  if (chosen.length === 0) throw new Error('No students to generate codes for.')

  // Fresh random codes; never two equal codes in one batch (the database also requires unique hashes).
  const used = new Set<string>()
  const rows = chosen.map((s) => {
    let code = newAccessCode()
    while (used.has(code)) code = newAccessCode()
    used.add(code)
    return { s, code }
  })
  const hashed = rows.map(({ s, code }) => ({ id: s.id, hash: hashAccessCode(code) }))

  await mkdir(PRIVATE, { recursive: true })
  // Never overwrite an earlier code sheet (a partial --only run must not wipe the full list).
  let csvPath = path.join(PRIVATE, `access_codes_${localDate()}.csv`)
  for (let n = 2; existsSync(csvPath); n++) csvPath = path.join(PRIVATE, `access_codes_${localDate()}_${n}.csv`)
  const csv = ['student_id,course,section,first_name,last_name,code',
    ...rows.map(({ s, code }) => [s.id, s.course ?? '', s.section ?? '', s.firstName ?? '', s.lastName ?? '', code].map(csvCell).join(','))]
    .join('\r\n') + '\r\n'
  await writeFile(csvPath, '\uFEFF' + csv, 'utf8')   // BOM so Excel opens accented names correctly

  const sqlPath = path.join(PRIVATE, 'access_codes_upsert.sql')
  const sql = [
    `-- Access-code hashes generated ${new Date().toISOString()} for ${hashed.length} student(s)${only ? ' (rotation)' : ''}.`,
    '-- Paste into the Supabase SQL editor AFTER supabase/seed/roster_upsert.sql. Contains SHA-256 hashes only, no codes.',
    "-- Running it replaces these students' previous codes (the old ones stop working) and un-revokes them.",
    'begin;',
    'insert into public.access_codes (student_id, code_hash) values',
    hashed.map(({ id, hash }) => `  (${sqlStr(id)}, ${sqlStr(hash)})`).join(',\n'),
    'on conflict (student_id) do update set code_hash = excluded.code_hash, revoked_at = null, created_at = now();',
    'commit;',
    '',
  ].join('\n')
  await writeFile(sqlPath, sql, 'utf8')

  console.log(`Generated ${rows.length} access code(s)${only ? ` (rotation: ${only.length} requested)` : ` for all ${roster.students.length} students on the roster`}.`)
  console.log(`  Roster read:                                 ${path.relative(ROOT, ROSTER)}`)
  console.log(`  Codes (keep private, hand out individually): ${path.relative(ROOT, csvPath)}`)
  console.log(`  Hashes for Supabase SQL editor:              ${path.relative(ROOT, sqlPath)}`)
  console.log('Nothing was uploaded. Codes were not printed.')
}

main().catch((e: unknown) => {
  console.error(`generate-access-codes: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
