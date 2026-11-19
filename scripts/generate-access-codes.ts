/**
 * Generate one private access code per active student for Live mode.
 *
 *   npm run access-codes                       # every student in src/data/roster.json
 *   npm run access-codes -- --only s01-03,s02-07   # rotate just these students (their old codes stop working)
 *   (testing only: --roster <file> reads another roster, --out-dir <dir> writes somewhere other than private/)
 *
 * Writes (both inside the git-ignored private/ folder):
 *   private/access_codes_<YYYY-MM-DD>.csv  student_id, section, first, last, code — hand these out privately.
 *   private/access_codes_upsert.sql        bcrypt hashes only — paste into the Supabase SQL editor.
 *
 * Codes are never printed to the terminal and nothing is sent anywhere.
 */
import { randomInt } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import type { Roster, Student } from '../shared/roster.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_ROSTER = path.join(ROOT, 'src', 'data', 'roster.json')
const DEFAULT_OUT = path.join(ROOT, 'private')
/** No 0/O, 1/I/L — easy to read aloud and type. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const BCRYPT_COST = 10

function newCode(): string {
  let s = ''
  for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return `${s.slice(0, 5)}-${s.slice(5)}`
}

/**
 * bcrypt hash in the "$2a$" spelling: pgcrypto's crypt() (used by redeem_access_code) does not understand "$2b$",
 * the prefix bcryptjs writes. For inputs this short the two are the same algorithm, only the label differs.
 */
function hashCode(code: string): string {
  const h = bcrypt.hashSync(code, BCRYPT_COST)
  return h.startsWith('$2b$') ? `$2a$${h.slice(4)}` : h
}

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`
const csvCell = (s: string) => (/[",\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface Args { only: string[] | null; roster: string; outDir: string }

function parseArgs(argv: string[]): Args {
  let only: string[] | null = null
  let roster = DEFAULT_ROSTER
  let outDir = DEFAULT_OUT
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--roster' || a === '--out-dir') {
      const v = argv[++i]
      if (!v) throw new Error(`${a} needs a path`)
      if (a === '--roster') roster = path.resolve(v); else outDir = path.resolve(v)
    } else if (a === '--only' || a.startsWith('--only=')) {
      const v = a === '--only' ? argv[++i] : a.slice('--only='.length)
      if (!v) throw new Error('--only needs a comma-separated list of student ids, e.g. --only s01-03,s02-07')
      only = v.split(',').map((x) => x.trim()).filter(Boolean)
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: npm run access-codes [-- --only s01-03,s02-07]')
      process.exit(0)
    } else throw new Error(`Unknown option "${a}". Usage: npm run access-codes [-- --only s01-03,s02-07]`)
  }
  return { only, roster, outDir }
}

async function main(): Promise<void> {
  const { only, roster: ROSTER, outDir: PRIVATE } = parseArgs(process.argv.slice(2))
  if (!existsSync(ROSTER)) {
    throw new Error(`Roster not found: ${path.relative(ROOT, ROSTER)}\nRun "npm run import-roster" first to create it from the spreadsheet.`)
  }
  const roster = JSON.parse(await readFile(ROSTER, 'utf8')) as Roster
  if (!roster || !Array.isArray(roster.students)) throw new Error(`${path.relative(ROOT, ROSTER)} has no "students" array.`)

  let chosen: Student[] = roster.students
  if (only) {
    const byId = new Map(roster.students.map((s) => [s.id, s]))
    const unknown = only.filter((id) => !byId.has(id))
    if (unknown.length) throw new Error(`Not active students in the roster: ${unknown.join(', ')}`)
    chosen = [...new Set(only)].map((id) => byId.get(id)!)
  }
  if (chosen.length === 0) throw new Error('No students to generate codes for.')

  const rows = chosen.map((s) => ({ s, code: newCode() }))
  const hashed = rows.map(({ s, code }) => ({ id: s.id, hash: hashCode(code) }))

  await mkdir(PRIVATE, { recursive: true })
  // Never overwrite an earlier code sheet (a partial --only run must not wipe the full list).
  let csvPath = path.join(PRIVATE, `access_codes_${localDate()}.csv`)
  for (let n = 2; existsSync(csvPath); n++) csvPath = path.join(PRIVATE, `access_codes_${localDate()}_${n}.csv`)
  const csv = ['student_id,section,first,last,code',
    ...rows.map(({ s, code }) => [s.id, s.section, s.firstName, s.lastName, code].map(csvCell).join(','))].join('\r\n') + '\r\n'
  await writeFile(csvPath, '﻿' + csv, 'utf8')   // BOM so Excel opens accented names correctly

  const sqlPath = path.join(PRIVATE, 'access_codes_upsert.sql')
  const sql = [
    `-- Access-code hashes generated ${new Date().toISOString()} for ${hashed.length} student(s)${only ? ' (rotation)' : ''}.`,
    '-- Paste into the Supabase SQL editor AFTER supabase/seed/roster_upsert.sql. Contains bcrypt hashes only, no codes.',
    '-- Running it replaces these students\' previous codes and clears any lock-out.',
    'begin;',
    'insert into public.access_codes (student_id, code_hash) values',
    hashed.map(({ id, hash }) => `  (${sqlStr(id)}, ${sqlStr(hash)})`).join(',\n'),
    'on conflict (student_id) do update set code_hash = excluded.code_hash, revoked_at = null, failed_attempts = 0,',
    '  locked_until = null, created_at = now();',
    'commit;',
    '',
  ].join('\n')
  await writeFile(sqlPath, sql, 'utf8')

  console.log(`Generated ${rows.length} access code(s)${only ? ` (rotation: ${only.length} requested)` : ` for all ${roster.students.length} active students`}.`)
  console.log(`  Codes (keep private, hand out individually): ${path.relative(ROOT, csvPath)}`)
  console.log(`  Hashes for Supabase SQL editor:              ${path.relative(ROOT, sqlPath)}`)
  console.log('Nothing was uploaded. Codes were not printed.')
}

main().catch((e: unknown) => {
  console.error(`generate-access-codes: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
