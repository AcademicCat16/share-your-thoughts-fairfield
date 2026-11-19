/**
 * Test harness for the Live-mode database: a throw-away embedded Postgres 17 with stand-ins for the parts of
 * Supabase the migration relies on (roles anon / authenticated / service_role, auth.uid(), auth.jwt(), the
 * `extensions` schema and Supabase's default privileges that grant new objects to anon/authenticated).
 *
 * This is plain Postgres, NOT a real Supabase project: PostgREST, GoTrue and Supabase's own rate limits are absent.
 */
import { createRequire } from 'node:module'
import { spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import bcrypt from 'bcryptjs'

// `pg` ships without type declarations (and @types/pg is not installed), so describe the small surface we use.
export interface QueryResult<R = Record<string, unknown>> { rows: R[]; rowCount: number | null }
export interface PgClient {
  connect(): Promise<void>
  end(): Promise<void>
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<R>>
}
interface PgModule { Client: new (cfg: Record<string, unknown>) => PgClient }
const pg = createRequire(import.meta.url)('pg') as PgModule

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '001_feedback_classroom.sql')

export interface SeedStudent { id: string; section: string; first: string; last: string; url: string | null; status: 'valid' | 'missing' | 'invalid' }

/** 16 students in two sections. s01-08 has no URL, s02-08 an invalid one. */
export const STUDENTS: SeedStudent[] = [
  ...Array.from({ length: 8 }, (_, i) => mk('01', i + 1)),
  ...Array.from({ length: 8 }, (_, i) => mk('02', i + 1)),
]
function mk(section: string, n: number): SeedStudent {
  const id = `s${section}-${String(n).padStart(2, '0')}`
  const missing = section === '01' && n === 8
  const invalid = section === '02' && n === 8
  return {
    id, section, first: `First${section}${n}`, last: `O'Last${n}`,
    url: missing ? null : invalid ? 'file:///C:/Users/me/world.html' : `https://example.org/${id}/`,
    status: missing ? 'missing' : invalid ? 'invalid' : 'valid',
  }
}
/** Deterministic test access codes, XXXXX-XXXXX. */
export const codeFor = (id: string) => `T${id.replace(/\D/g, '').padEnd(4, '9').slice(0, 4)}-ABCDE`
export const INSTRUCTOR_EMAIL = 'teacher@example.edu'

export interface Claims { sub?: string; role?: string; email?: string; is_anonymous?: boolean; [k: string]: unknown }

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

const SUPABASE_STANDINS = `
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
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$f$;
create or replace function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
-- Supabase grants every new object in public to the API roles by default; reproduce that so the migration's revokes
-- are actually tested.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`

export class TestDb {
  private epg: EmbeddedPostgres | null = null
  private dir = ''
  port = 0
  admin!: PgClient
  private extra: PgClient[] = []

  async start(): Promise<void> {
    this.port = await freePort()
    this.dir = path.join(ROOT, '.pg-test', `run-${process.pid}-${Date.now()}`)
    await mkdir(path.dirname(this.dir), { recursive: true })
    this.epg = new EmbeddedPostgres({
      databaseDir: this.dir, port: this.port, user: 'postgres', password: 'test-only-password', persistent: false,
      initdbFlags: ['--encoding=UTF8', '--no-locale'],
      onLog: () => {}, onError: (e) => { if (process.env.PG_TEST_VERBOSE) console.error(e) },
    })
    await this.epg.initialise()
    await this.epg.start()
    this.admin = await this.connect()
    await this.admin.query(SUPABASE_STANDINS)
    await this.admin.query(await readFile(MIGRATION, 'utf8'))
    await this.seed()
  }

  async connect(): Promise<PgClient> {
    const c = new pg.Client({ host: '127.0.0.1', port: this.port, user: 'postgres', password: 'test-only-password', database: 'postgres' })
    await c.connect()
    this.extra.push(c)
    return c
  }

  private async seed(): Promise<void> {
    for (const [i, s] of STUDENTS.entries()) {
      // bcryptjs writes "$2b$"; scripts/generate-access-codes.ts writes "$2a$". Seed both spellings.
      const hash = bcrypt.hashSync(codeFor(s.id), 10)
      const codeHash = i % 2 === 0 ? hash : `$2a$${hash.slice(4)}`
      await this.admin.query(
        `insert into students (id, section, section_code, first_name, last_name, full_name, project_url, url_status, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [s.id, s.section, `MKTG 2241-${s.section}`, s.first, s.last, `${s.first} ${s.last}`, s.url, s.status])
      await this.admin.query(`insert into access_codes (student_id, code_hash) values ($1,$2)`, [s.id, codeHash])
    }
    await this.admin.query(`insert into instructors (email) values ($1)`, [INSTRUCTOR_EMAIL])
  }

  /** Back to the freshly seeded state (fast; access-code hashes are kept). */
  async reset(settings: Partial<Record<string, number | boolean>> = {}): Promise<void> {
    await this.admin.query(`truncate comments, reservations, write_events, student_sessions, audit_log`)
    await this.admin.query(`update access_codes set failed_attempts = 0, locked_until = null, revoked_at = null`)
    await this.admin.query(`update students set active = true`)
    await this.admin.query(`update settings set max_comments_per_project = 4, max_reviews_per_reviewer = 4, feedback_open = true,
                            reservation_minutes = 20, min_seconds_between_writes = 0, max_writes_per_hour = 1000 where id = 1`)
    for (const [k, v] of Object.entries(settings)) {
      if (!/^[a-z_]+$/.test(k)) throw new Error(`bad setting ${k}`)
      await this.admin.query(`update settings set ${k} = $1 where id = 1`, [v])
    }
  }

  /** Bind a fresh anonymous auth user to a student directly (redeem_access_code is tested separately). */
  async bind(studentId: string): Promise<Claims> {
    const sub = randomUUID()
    await this.admin.query(`insert into student_sessions (auth_uid, student_id) values ($1,$2)`, [sub, studentId])
    return anonUser(sub)
  }

  /** Insert a published comment directly (bypasses all rules — for setting up scenarios). */
  async addComment(projectId: string, reviewerId: string, status: 'published' | 'removed' = 'published'): Promise<string> {
    const r = await this.admin.query<{ id: string }>(
      `insert into comments (project_id, reviewer_id, reviewer_name, enjoyed, suggestion, status)
       values ($1,$2,(select full_name from students where id=$2),'I enjoyed the world a lot.','Maybe add more signposts.',$3) returning id`,
      [projectId, reviewerId, status])
    return r.rows[0].id
  }

  async stop(): Promise<void> {
    for (const c of this.extra.splice(0)) await c.end().catch(() => {})
    const epg = this.epg
    this.epg = null
    if (!epg) return
    // Clean shutdown with pg_ctl (embedded-postgres' own stop() uses `taskkill /f` on Windows).
    const proc = Reflect.get(epg, 'process') as ChildProcess | undefined
    let clean = false
    if (proc && proc.exitCode === null) {
      const exited = new Promise<void>((r) => proc.once('exit', () => r()))
      const pgCtl = await pgCtlPath()
      if (pgCtl) {
        const res = spawnSync(pgCtl, ['stop', '-D', this.dir, '-m', 'fast', '-w', '-t', '30'], { stdio: 'ignore' })
        if (res.status === 0) { await Promise.race([exited, new Promise((r) => setTimeout(r, 10000))]); clean = proc.exitCode !== null }
      }
    }
    if (clean) Reflect.set(epg, 'process', undefined)
    else await epg.stop()
    await rm(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}

async function pgCtlPath(): Promise<string | null> {
  try {
    const mod = process.platform === 'win32' ? await import('@embedded-postgres/windows-x64') : null
    return mod ? mod.pg_ctl : null
  } catch { return null }
}

export const anonUser = (sub: string): Claims => ({ sub, role: 'authenticated', is_anonymous: true, aud: 'authenticated' })
export const emailUser = (email: string, sub: string = randomUUID()): Claims => ({ sub, role: 'authenticated', email, is_anonymous: false, aud: 'authenticated' })

/**
 * Run one statement as an API role with the given JWT claims, inside its own transaction — the way PostgREST does
 * it (`set local role ...; set_config('request.jwt.claims', ..., true)`). Commits on success, rolls back on error.
 */
export async function runAs<R = Record<string, unknown>>(client: PgClient, role: 'anon' | 'authenticated', claims: Claims | null,
  sql: string, params: unknown[] = []): Promise<R[]> {
  await client.query('begin')
  try {
    await client.query(`set local role ${role}`)
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role })])
    const r = await client.query<R>(sql, params)
    await client.query('commit')
    return r.rows
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  }
}

/** The error message of a rejected promise (our RAISE codes, or Postgres' own messages). */
export async function errorOf(p: Promise<unknown>): Promise<string> {
  try { await p } catch (e) { return e instanceof Error ? e.message : String(e) }
  return '(no error)'
}
