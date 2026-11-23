/**
 * A local stand-in for a Supabase project, for the Live-mode browser tests (tests/live/run.mjs).
 *
 *   • Postgres 17 (embedded-postgres) with Supabase's roles (anon / authenticated / service_role), auth.uid() and
 *     auth.jwt(), then supabase/migrations/001_feedback_classroom.sql, the REAL roster (private/roster_full.json via
 *     scripts/build-live-sql.ts) and freshly generated access codes (scripts/generate-access-codes.ts → a temp folder).
 *   • An HTTP server that answers the two Supabase endpoints the app uses:
 *       /rest/v1/rpc/<fn>  — like PostgREST: verify the HS256 JWT, then inside ONE transaction
 *                             `set local role <role>` + `set_config('request.jwt.claims', …)` and call the function.
 *                             Each request has its own connection, so concurrent requests really run concurrently.
 *       /auth/v1/…         — like GoTrue: anonymous sign-up, refresh, user, logout, e-mail magic link with PKCE
 *                             (the "e-mail" is read back from /__test/mail).
 *
 * NOT a real Supabase project: no PostgREST, GoTrue, Kong or Supabase rate limits. It proves the browser code + SQL
 * together, from separate browsers; a real project must still be checked with supabase/SETUP.md.
 */
import http from 'node:http'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { createServer as netServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'

const require = createRequire(import.meta.url)
const pg = require('pg')
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const STANDINS = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create or replace function auth.jwt() returns jsonb language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$f$;
create or replace function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
export function signJwt(claims, secret) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const p = b64u(JSON.stringify(claims))
  return `${h}.${p}.${b64u(createHmac('sha256', secret).update(`${h}.${p}`).digest())}`
}
export function verifyJwt(token, secret) {
  const [h, p, s] = String(token ?? '').split('.')
  if (!h || !p || !s) return null
  if (b64u(createHmac('sha256', secret).update(`${h}.${p}`).digest()) !== s) return null
  const claims = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  if (claims.exp && claims.exp < Date.now() / 1000) return null
  return claims
}

async function freePort() {
  return new Promise((resolve, reject) => { const s = netServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) }) })
}
const node = (args, opts = {}) => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', ...opts })
  if (r.status !== 0) throw new Error(`node ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}

export async function startStack({ instructorEmail = 'teacher@example.edu' } = {}) {
  const secret = randomBytes(32).toString('hex')
  const dbPort = await freePort(); const apiPort = await freePort()
  const dir = path.join(ROOT, '.pg-test', `live-${process.pid}-${Date.now()}`)
  mkdirSync(path.dirname(dir), { recursive: true })
  const epg = new EmbeddedPostgres({ databaseDir: dir, port: dbPort, user: 'postgres', password: 'live-test-only', persistent: false, initdbFlags: ['--encoding=UTF8', '--no-locale'], onLog: () => {}, onError: () => {} })
  await epg.initialise(); await epg.start()
  const cfg = { host: '127.0.0.1', port: dbPort, user: 'postgres', password: 'live-test-only', database: 'postgres' }
  const admin = new pg.Client(cfg); await admin.connect()
  await admin.query(STANDINS)
  await admin.query(readFileSync(path.join(ROOT, 'supabase', 'migrations', '001_feedback_classroom.sql'), 'utf8'))
  // Real roster + real access codes (into a temp folder that is deleted at the end).
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fic-live-'))
  node(['scripts/build-live-sql.ts', '--out', path.join(tmp, 'roster.sql')])
  await admin.query(readFileSync(path.join(tmp, 'roster.sql'), 'utf8'))
  node(['scripts/generate-access-codes.ts', '--out-dir', tmp])
  await admin.query(readFileSync(path.join(tmp, 'access_codes_upsert.sql'), 'utf8'))
  const csv = readdirSync(tmp).find((f) => /^access_codes_.*\.csv$/.test(f))
  const codes = {}
  for (const line of readFileSync(path.join(tmp, csv), 'utf8').trim().split(/\r?\n/).slice(1)) { const cols = line.split(','); codes[cols[0]] = cols[cols.length - 1] }
  await admin.query('insert into public.instructors (email) values ($1) on conflict do nothing', [instructorEmail])
  await admin.query('update public.settings set min_seconds_between_writes = 0, max_writes_per_hour = 1000 where id = 1')

  const pool = new pg.Pool({ ...cfg, max: 40 })
  const anonKey = signJwt({ role: 'anon', iss: 'fic-live-test', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 }, secret)
  const users = new Map() // id → user
  const refresh = new Map() // token → user id
  const codesPkce = new Map() // auth code → { email, challenge, method }
  const mail = new Map() // email → link
  const requests = []

  const session = (user) => {
    const now = Math.floor(Date.now() / 1000)
    const access = signJwt({ sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email ?? '', is_anonymous: !!user.is_anonymous, session_id: randomUUID(), iat: now, exp: now + 3600 }, secret)
    const r = randomBytes(16).toString('hex'); refresh.set(r, user.id)
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: r, user }
  }
  const newUser = (email, anon) => {
    const u = { id: randomUUID(), aud: 'authenticated', role: 'authenticated', email: email ?? '', phone: '', is_anonymous: anon, app_metadata: { provider: anon ? 'anonymous' : 'email', providers: anon ? [] : ['email'] }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    users.set(u.id, u); return u
  }
  const knownEmails = new Set([instructorEmail.toLowerCase(), 'not-an-instructor@example.edu'])

  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' }
  const send = (res, status, body) => { res.writeHead(status, { ...cors, 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)) }
  const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d ? JSON.parse(d) : {})) })
  const procCache = new Map()

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
      const url = new URL(req.url, `http://127.0.0.1:${apiPort}`)
      requests.push(`${req.method} ${url.pathname}`)
      if (url.pathname === '/__test/mail') return send(res, 200, { link: mail.get((url.searchParams.get('email') ?? '').toLowerCase()) ?? null })
      if (req.headers.apikey !== anonKey) return send(res, 401, { message: 'Invalid API key' })
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')

      // ---------------- auth (GoTrue-like) ----------------
      if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
        const b = await readBody(req)
        if (b.email || b.password) return send(res, 422, { msg: 'Signups not allowed in this test stand-in' })
        return send(res, 200, session(newUser(null, true)))
      }
      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        const b = await readBody(req); const g = url.searchParams.get('grant_type')
        if (g === 'refresh_token') { const id = refresh.get(b.refresh_token); refresh.delete(b.refresh_token); return id ? send(res, 200, session(users.get(id))) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }) }
        if (g === 'pkce') {
          const p = codesPkce.get(b.auth_code); codesPkce.delete(b.auth_code)
          if (!p) return send(res, 404, { error: 'invalid_grant', error_description: 'invalid flow state' })
          const ok = p.method === 'plain' ? b.code_verifier === p.challenge : b64u(createHash('sha256').update(b.code_verifier ?? '').digest()) === p.challenge
          if (!ok) return send(res, 403, { error: 'invalid_grant', error_description: 'code challenge does not match' })
          const u = [...users.values()].find((x) => x.email === p.email) ?? newUser(p.email, false)
          return send(res, 200, session(u))
        }
        return send(res, 400, { error: 'unsupported_grant_type' })
      }
      if (url.pathname === '/auth/v1/otp' && req.method === 'POST') {
        const b = await readBody(req); const email = String(b.email ?? '').toLowerCase()
        if (!knownEmails.has(email)) return send(res, 422, { msg: 'Signups not allowed for otp' })
        const code = randomUUID()
        codesPkce.set(code, { email, challenge: b.code_challenge, method: (b.code_challenge_method ?? 's256').toLowerCase() })
        const redirect = url.searchParams.get('redirect_to') ?? ''
        mail.set(email, `${redirect}${redirect.includes('?') ? '&' : '?'}code=${code}`)
        return send(res, 200, {})
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
        const c = verifyJwt(bearer, secret); const u = c && users.get(c.sub)
        return u ? send(res, 200, u) : send(res, 401, { msg: 'invalid JWT' })
      }
      if (url.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end() }

      // ---------------- RPC (PostgREST-like) ----------------
      const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/)
      if (m && req.method === 'POST') {
        const claims = verifyJwt(bearer, secret)
        if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid' })
        const role = claims.role === 'authenticated' ? 'authenticated' : 'anon'
        const fn = m[1]; const args = await readBody(req)
        let proc = procCache.get(fn)
        if (!proc) {
          const r = await admin.query(`select p.proretset, t.typname, t.typtype from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype where n.nspname = 'public' and p.proname = $1 limit 1`, [fn])
          if (!r.rowCount) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}` })
          proc = r.rows[0]; procCache.set(fn, proc)
        }
        const names = Object.keys(args).filter((k) => /^[a-z_][a-z0-9_]*$/.test(k))
        const call = `public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')})`
        const params = names.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]))
        const set = proc.proretset || proc.typtype === 'c'
        const sql = set ? `select * from ${call}` : `select ${call} as r`
        const c = await pool.connect()
        try {
          await c.query('begin')
          await c.query(`set local role ${role}`)
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
          const r = await c.query(sql, params)
          await c.query('commit')
          return send(res, 200, set ? r.rows : (r.rows[0]?.r ?? null))
        } catch (e) {
          await c.query('rollback').catch(() => {})
          const perm = /permission denied/.test(e.message)
          return send(res, perm ? (role === 'anon' ? 401 : 403) : 400, { code: e.code ?? 'P0001', message: e.message, details: null, hint: null })
        } finally { c.release() }
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        // Direct table access: run it as the caller's role, the way PostgREST would — the grants decide.
        const claims = verifyJwt(bearer, secret); const role = claims?.role === 'authenticated' ? 'authenticated' : 'anon'
        const table = url.pathname.slice('/rest/v1/'.length)
        if (!/^[a-z_][a-z0-9_]*$/.test(table)) return send(res, 404, { message: 'not found' })
        const c = await pool.connect()
        try {
          await c.query('begin'); await c.query(`set local role ${role}`)
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role })])
          const r = req.method === 'GET' ? await c.query(`select * from public.${table} limit 5`) : await c.query(`insert into public.${table} default values returning *`)
          await c.query('commit'); return send(res, 200, r.rows)
        } catch (e) { await c.query('rollback').catch(() => {}); return send(res, /permission denied/.test(e.message) ? 401 : 400, { code: e.code, message: e.message }) } finally { c.release() }
      }
      return send(res, 404, { message: 'not found' })
    } catch (e) { send(res, 500, { message: String(e.message ?? e) }) }
  })
  await new Promise((r) => server.listen(apiPort, '127.0.0.1', r))

  return {
    url: `http://127.0.0.1:${apiPort}`, anonKey, codes, admin, requests, instructorEmail,
    sql: (q, p) => admin.query(q, p),
    async stop() {
      server.close(); await pool.end().catch(() => {}); await admin.end().catch(() => {})
      rmSync(tmp, { recursive: true, force: true })
      await epg.stop().catch(() => {})
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    },
  }
}
