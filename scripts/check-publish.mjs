/**
 * Publication safety check (run in CI before deploying):
 *  - the exam workbook, private/ folder and .env files are not tracked by git
 *  - no Supabase service-role key, access-code sheet or bcrypt hash appears in the repo or the built site
 *  - the built site is in Demo mode unless VITE_FEEDBACK_MODE=live was set deliberately
 */
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const problems = []
const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
for (const f of tracked) {
  if (/\.xlsx$/i.test(f)) problems.push(`spreadsheet tracked: ${f}`)
  if (/^private\//.test(f)) problems.push(`private file tracked: ${f}`)
  if (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example')) problems.push(`env file tracked: ${f}`)
}
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const scan = [...tracked.filter((f) => existsSync(f) && !/^tests\/db\//.test(f) && !/check-publish/.test(f)), ...(existsSync('dist') ? walk('dist') : [])]
for (const f of scan) {
  if (/\.(png|jpg|woff2?|ico)$/i.test(f)) continue
  const t = readFileSync(f, 'utf8')
  for (const m of t.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try { if (JSON.parse(Buffer.from(m[1], 'base64url').toString()).role === 'service_role') problems.push(`service_role key in ${f}`) } catch { /* not a JWT */ }
  }
  if (/sb_secret_[A-Za-z0-9]/.test(t)) problems.push(`Supabase secret key in ${f}`)
  if (/\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/.test(t)) problems.push(`bcrypt hash in ${f}`)
  if (!f.endsWith("generate-access-codes.ts") && /student_id,section,first,last,code/.test(t)) problems.push(`access-code sheet in ${f}`)
}
const mode = process.env.VITE_FEEDBACK_MODE === 'live' ? 'live' : 'demo'
if (existsSync('dist') && mode === 'demo') {
  const js = walk('dist').filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n')
  if (!js.includes('Demo Mode — Comments are stored only in this browser.')) problems.push('built site does not contain the Demo Mode banner')
}
if (problems.length) { console.error(problems.map((p) => `✖ ${p}`).join('\n')); process.exit(1) }
console.log(`✔ publication check passed (${scan.length} files scanned, mode: ${mode})`)
