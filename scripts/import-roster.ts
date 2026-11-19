/**
 * Re-import the classroom roster from the exam workbook.
 *
 *   npm run import-roster                       # reads "Take-Home Exam.xlsx" in the project folder
 *   npm run import-roster -- "path/to/file.xlsx"
 *   npm run import-roster -- --dry-run          # show what would change, write nothing
 *
 * Safe to run again whenever new submissions arrive: returning students keep their id, seat and creature
 * (so comments stay attached); only URLs are refreshed. Writes src/data/roster.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { readWorkbook } from '../shared/xlsx.ts'
import { parseRosterSheet, mergeRoster, rosterCounts, countProblems, type Roster } from '../shared/roster.ts'
import { CREATURES } from '../shared/creatures.ts'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const file = resolve(args.find((a) => !a.startsWith('--')) ?? 'Take-Home Exam.xlsx')
const OUT = resolve('src/data/roster.json')

if (!existsSync(file)) { console.error(`Workbook not found: ${file}`); process.exit(1) }
const bytes = readFileSync(file)
const parsed = parseRosterSheet(readWorkbook(new Uint8Array(bytes)))
const prev: Roster | null = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null

const { roster, report } = mergeRoster(prev, parsed.rows, CREATURES.map((c) => c.id), {
  file: basename(file), sheet: parsed.sheet, importedAt: new Date().toISOString(),
  sha256: createHash('sha256').update(bytes).digest('hex'),
})

const c = rosterCounts(roster)
console.log(`Sheet: "${parsed.sheet}"  ·  ${c.total} students (Section 01: ${c.section01}, Section 02: ${c.section02})`)
console.log(`URLs: ${c.valid} valid · ${c.missing} missing · ${c.invalid} invalid/local-only`)
for (const s of roster.students.filter((s) => s.urlStatus === 'invalid')) console.log(`  invalid  ${s.id}  ${s.fullName}: ${s.urlNote}`)
console.log(`Changes: ${report.added.length} added · ${report.kept.length} unchanged identity · ${report.urlChanged.length} URL updates · ${report.removed.length} no longer on sheet · ${report.restored.length} restored`)
if (prev) for (const id of report.urlChanged) {
  const a = [...prev.students, ...prev.removed].find((s) => s.id === id); const b = roster.students.find((s) => s.id === id)
  console.log(`  url      ${id}  ${b?.fullName}: ${a?.url ?? '(none)'}  →  ${b?.url ?? '(none)'}`)
}
for (const id of report.removed) console.log(`  removed  ${id} (kept in roster.removed so comments remain linked)`)
for (const w of parsed.warnings) console.log(`WARNING: ${w}`)
const problems = countProblems(roster)
for (const p of problems) console.log(`CHECK FAILED: ${p}`)
if (problems.length === 0) console.log('Count check passed: 58 students, 28 + 30.')

if (dry) console.log('Dry run — nothing written.')
else { writeFileSync(OUT, JSON.stringify(roster, null, 2) + '\n'); console.log(`Wrote ${OUT}`) }
if (problems.length) process.exitCode = 2
