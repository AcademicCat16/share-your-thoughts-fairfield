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
import { hashAccessCode } from '../../shared/accessCode.ts'

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

export type Course = '1101' | '2241'
export type Section = 'pm' | '01' | '02'
export interface SeedStudent {
  id: string; course: Course; section: Section; sectionCode: string; first: string; last: string
  url: string | null; status: 'valid' | 'missing' | 'invalid'; link: 'working' | 'broken' | 'unchecked'
}

/**
 * Two review pools.
 *   MKTG 1101: pm-01 … pm-06, all with working links.
 *   MKTG 2241: s01-01 … s01-05 and s02-01 … s02-05 (sections 01 + 02 form ONE pool). s01-05 has no link
 *              (url_status 'missing'); s02-05 has a valid link that the audit found broken. All others valid + working.
 */
export const STUDENTS: SeedStudent[] = [
  ...Array.from({ length: 6 }, (_, i) => mk('1101', 'pm', i + 1)),
  ...Array.from({ length: 5 }, (_, i) => mk('2241', '01', i + 1)),
  ...Array.from({ length: 5 }, (_, i) => mk('2241', '02', i + 1)),
]
function mk(course: Course, section: Section, n: number): SeedStudent {
  const id = section === 'pm' ? `pm-${String(n).padStart(2, '0')}` : `s${section}-${String(n).padStart(2, '0')}`
  const missing = id === 's01-05'
  const broken = id === 's02-05'
  return {
    id, course, section, sectionCode: course === '1101' ? 'MKTG 1101' : `MKTG 2241-${section}`,
    first: `First${id.replace('-', '')}`, last: `O'Last${n}`,
    url: missing ? null : `https://example.org/${id}/`,
    status: missing ? 'missing' : 'valid',
    link: missing ? 'unchecked' : broken ? 'broken' : 'working',
  }
}
export const seedStudent = (id: string): SeedStudent => {
  const s = STUDENTS.find((x) => x.id === id)
  if (!s) throw new Error(`no seed student ${id}`)
  return s
}
export const fullNameOf = (id: string) => `${seedStudent(id).first} ${seedStudent(id).last}`
export const idsOf = (course: Course) => STUDENTS.filter((s) => s.course === course).map((s) => s.id)
/** Seed projects that may receive reviews (valid link, audit says working). */
export const eligibleOf = (course: Course) =>
  STUDENTS.filter((s) => s.course === course && s.status === 'valid' && s.link === 'working').map((s) => s.id)

/** Deterministic test access code per student: XXXX-XXXX-XXXX from the real alphabet (test data only). */
export function codeFor(id: string): string {
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  let h = 2166136261
  let out = ''
  for (let i = 0; i < 12; i++) {
    for (const ch of `${id}#${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    out += A[h % A.length]
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`
}
export const INSTRUCTOR_EMAIL = 'teacher@example.edu'

/** Settings every test starts from (no write spacing, so tests can submit back to back). */
export const TEST_SETTINGS: Record<string, number | boolean> = {
  base_slots: 4, reviews_per_student: 4, feedback_open: true, allow_extra_reviews: false, min_seconds_between_writes: 0,
  max_writes_per_hour: 1000, max_failed_codes_per_session: 10, max_failed_codes_global: 300,
}

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

export const SUPABASE_STANDINS = `
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

  async connect(database = 'postgres'): Promise<PgClient> {
    const c = new pg.Client({ host: '127.0.0.1', port: this.port, user: 'postgres', password: 'test-only-password', database })
    await c.connect()
    this.extra.push(c)
    return c
  }

  /** Close connections opened with connect() (keeps the server under its connection limit). */
  async disconnect(clients: PgClient[]): Promise<void> {
    for (const c of clients) {
      const i = this.extra.indexOf(c)
      if (i >= 0) { this.extra.splice(i, 1); await c.end().catch(() => {}) }
    }
  }

  private async seed(): Promise<void> {
    for (const s of STUDENTS) {
      await this.admin.query(
        `insert into students (id, course, section, section_code, first_name, last_name, full_name, project_url, url_status, link_status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [s.id, s.course, s.section, s.sectionCode, s.first, s.last, `${s.first} ${s.last}`, s.url, s.status, s.link])
      await this.admin.query(`insert into access_codes (student_id, code_hash) values ($1,$2)`, [s.id, hashAccessCode(codeFor(s.id))])
    }
    await this.admin.query(`insert into instructors (email) values ($1)`, [INSTRUCTOR_EMAIL])
  }

  /** Back to the freshly seeded state (fast; access-code hashes are kept). Removes students that tests added. */
  async reset(settings: Partial<Record<string, number | boolean>> = {}): Promise<void> {
    await this.admin.query(`truncate comments, assignments, project_slots, write_events, student_sessions, audit_log, code_attempts`)
    const ids = STUDENTS.map((s) => s.id)
    await this.admin.query(`delete from access_codes where student_id <> all($1)`, [ids])
    await this.admin.query(`delete from students where id <> all($1)`, [ids])
    await this.admin.query(`update access_codes set revoked_at = null`)
    for (const s of STUDENTS) {
      await this.admin.query(
        `update students set course=$2, section=$3, section_code=$4, first_name=$5, last_name=$6, full_name=$7, project_url=$8,
                url_status=$9, link_status=$10, active=true, participating=true, hidden=false where id=$1`,
        [s.id, s.course, s.section, s.sectionCode, s.first, s.last, `${s.first} ${s.last}`, s.url, s.status, s.link])
    }
    await this.admin.query(`delete from instructors where email <> $1`, [INSTRUCTOR_EMAIL])
    for (const [k, v] of Object.entries({ ...TEST_SETTINGS, ...settings })) {
      if (!/^[a-z_]+$/.test(k)) throw new Error(`bad setting ${k}`)
      await this.admin.query(`update settings set ${k} = $1 where id = 1`, [v])
    }
  }

  /** Add an extra student (valid, working link) for one test; reset() removes it again. */
  async addStudent(id: string, course: Course, section: Section): Promise<void> {
    await this.admin.query(
      `insert into students (id, course, section, section_code, first_name, last_name, full_name, project_url, url_status, link_status)
       values ($1,$2,$3,$4,'Extra',$1,'Extra ' || $1,'https://example.org/' || $1 || '/','valid','working')`,
      [id, course, section, course === '1101' ? 'MKTG 1101' : `MKTG 2241-${section}`])
  }

  /** Bind a fresh anonymous auth user to a student directly (redeem_access_code is tested separately). */
  async bind(studentId: string): Promise<Claims> {
    const sub = randomUUID()
    await this.admin.query(`insert into student_sessions (auth_uid, student_id) values ($1,$2)`, [sub, studentId])
    return anonUser(sub)
  }

  /** Insert a comment directly (bypasses all rules — for setting up scenarios). */
  async addComment(projectId: string, reviewerId: string, status: 'published' | 'removed' = 'published', extra = false): Promise<string> {
    const r = await this.admin.query<{ id: string }>(
      `insert into comments (course, project_id, reviewer_id, reviewer_name, enjoyed, suggestion, status, extra)
       values ((select course from students where id=$1),$1,$2,(select full_name from students where id=$2),
               'I enjoyed the world a lot.','Maybe add more signposts.',$3,$4) returning id`,
      [projectId, reviewerId, status, extra])
    return r.rows[0].id
  }

  /** Insert (or overwrite) an assignment directly. */
  async assign(reviewerId: string, projectId: string, status: 'pending' | 'completed' | 'released' = 'pending',
    commentId: string | null = null): Promise<void> {
    await this.admin.query(
      `insert into assignments (course, reviewer_id, project_id, status, comment_id)
       values ((select course from students where id=$2),$1,$2,$3,$4)
       on conflict (reviewer_id, project_id) do update set status = excluded.status, comment_id = excluded.comment_id`,
      [reviewerId, projectId, status, commentId])
  }

  /** A finished review: published comment plus the completed assignment pointing at it. */
  async completed(reviewerId: string, projectId: string): Promise<string> {
    const id = await this.addComment(projectId, reviewerId)
    await this.assign(reviewerId, projectId, 'completed', id)
    return id
  }

  async setCapacity(projectId: string, capacity: number): Promise<void> {
    await this.admin.query(
      `insert into project_slots (project_id, capacity) values ($1,$2) on conflict (project_id) do update set capacity = excluded.capacity`,
      [projectId, capacity])
  }

  async published(projectId: string): Promise<number> {
    const r = await this.admin.query<{ n: string }>(`select count(*) n from comments where project_id=$1 and status='published'`, [projectId])
    return Number(r.rows[0].n)
  }

  async assignmentStatus(reviewerId: string, projectId: string): Promise<string | null> {
    const r = await this.admin.query<{ status: string }>(`select status from assignments where reviewer_id=$1 and project_id=$2`, [reviewerId, projectId])
    return r.rows[0]?.status ?? null
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
    // Platform package exists only on Windows installs; a variable specifier keeps the type-checker from requiring it elsewhere.
    const winPkg: string = '@embedded-postgres/windows-x64'
    const mod = process.platform === 'win32' ? ((await import(winPkg)) as { pg_ctl: string }) : null
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
