/** Run SQL on the LINKED production Supabase project through the official CLI (`supabase db query --remote`). */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const tmp = mkdtempSync(join(tmpdir(), 'fic-prod-'))
let n = 0
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))

/** Read-only unless { write: true } (writes need the operator's prior approval; the CLI requires --yes for them). */
export function sql(text, { write = false } = {}) {
  const file = join(tmp, `q${++n}.sql`)
  writeFileSync(file, text)
  const args = ['supabase', 'db', 'query', '--remote', write ? '--yes' : '--read-only', '--file', `"${file}"`]
  const r = spawnSync(npx, args, { encoding: 'utf8', shell: process.platform === 'win32', input: '' })
  const so = r.stdout ?? ''
  let j
  try { j = JSON.parse(so.slice(so.indexOf('{'), so.lastIndexOf('}') + 1)) } catch { throw new Error(`could not parse CLI output:\n${(so + (r.stderr ?? '')).slice(0, 600)}`) }
  if (j._tag === 'Error' || !Array.isArray(j.rows)) throw new Error(`query failed: ${JSON.stringify(j.error ?? j).slice(0, 400)}`)
  return j.rows
}

/** The project's PUBLISHABLE key (the one already in the public site bundle). Never returns a secret key. */
export function publishableKey(ref) {
  const r = spawnSync(npx, ['supabase', 'projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32', input: '' })
  const so = r.stdout ?? ''
  const keys = JSON.parse(so.slice(so.indexOf('['), so.lastIndexOf(']') + 1))
  const k = keys.find((x) => x.type === 'publishable')
  if (!k || !/^sb_publishable_/.test(k.api_key)) throw new Error('no publishable key found')
  return k.api_key
}
