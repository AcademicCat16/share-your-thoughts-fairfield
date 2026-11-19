/**
 * Instructor link check: requests each *valid* project URL once and records whether it answered.
 *   npm run check-urls
 * Writes src/data/url_check.json (shown on the instructor dashboard under "Broken links").
 * A failed check does NOT change a student's classification — it is flagged for the instructor to look at.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Roster } from '../shared/roster.ts'

const roster: Roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8'))
const targets = roster.students.filter((s) => s.urlStatus === 'valid' && s.url)

async function check(url: string) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': 'FeedbackClassroom-LinkCheck/1.0' } })
    await r.body?.cancel()
    return { httpStatus: r.status, ok: r.ok, finalUrl: r.url !== url ? r.url : undefined }
  } catch (e) {
    return { httpStatus: 0, ok: false, error: e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : String(e) }
  } finally { clearTimeout(t) }
}

const results: Record<string, Awaited<ReturnType<typeof check>>> = {}
for (let i = 0; i < targets.length; i += 4) {
  const batch = targets.slice(i, i + 4)
  const out = await Promise.all(batch.map((s) => check(s.url!)))
  batch.forEach((s, j) => { results[s.id] = out[j]; console.log(`${out[j].ok ? 'ok  ' : 'FAIL'} ${out[j].httpStatus}  ${s.id}  ${s.fullName}  ${s.url}${out[j].error ? `  (${out[j].error})` : ''}`) })
}
const bad = Object.values(results).filter((r) => !r.ok).length
writeFileSync('src/data/url_check.json', JSON.stringify({ checkedAt: new Date().toISOString(), checked: targets.length, failed: bad, results }, null, 2) + '\n')
console.log(`${targets.length} checked · ${bad} did not answer with a success status → src/data/url_check.json`)
