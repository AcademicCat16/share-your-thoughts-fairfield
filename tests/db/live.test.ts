/**
 * Live-mode database tests (contract v2): supabase/migrations/001_feedback_classroom.sql against an embedded
 * Postgres 17 with Supabase stand-ins (see harness.ts). This proves the SQL, not a real Supabase project.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { BLOCKED_TERMS, validateFeedback } from '../../shared/rules.ts'
import { hashAccessCode, newAccessCode, normalizeAccessCode } from '../../shared/accessCode.ts'
import { planAssignments, type Edge, type ExistingEdge, type Plan } from '../../shared/allocation.ts'
import {
  TestDb, runAs, errorOf, codeFor, anonUser, emailUser, fullNameOf, idsOf, eligibleOf, INSTRUCTOR_EMAIL, allMigrationsSql, ROOT,
  STUDENTS, SUPABASE_STANDINS, type Claims, type Course, type PgClient,
} from './harness.ts'

const db = new TestDb()
before(async () => { await db.start() }, { timeout: 240_000 })
after(async () => { await db.stop() }, { timeout: 60_000 })
beforeEach(async () => { await db.reset() })

const U = (...cps: number[]) => String.fromCodePoint(...cps)
const BOM = U(0xfeff)
const ENJOY = 'I loved the glowing lanterns in the forest.'
const SUGGEST = 'Maybe add a short guide at the entrance.'
const TABLES = ['settings', 'students', 'access_codes', 'code_attempts', 'student_sessions', 'project_slots', 'assignments',
  'comments', 'write_events', 'instructors', 'audit_log', 'blocked_terms', 'source_events']
const ANON_FUNCTIONS = ['get_public_status', 'get_feedback_open', 'get_public_settings',
  'get_project_comments', 'get_student_quest', 'submit_feedback', 'edit_feedback'] // + migration 002 (honor system)
const AUTH_FUNCTIONS = [...ANON_FUNCTIONS, 'redeem_access_code', 'whoami', 'sign_out_student', 'my_quest', 'next_review',
  'get_comments', 'my_reviews', 'submit_comment', 'update_comment', 'is_instructor', 'admin_overview',
  'admin_apply_assignments', 'admin_set_participating', 'admin_remove_comment', 'admin_restore_comment', 'admin_set_open',
  'admin_set_allow_extra']

type Row = Record<string, unknown>
const as = (claims: Claims | null, sql: string, params: unknown[] = []) => runAs<Row>(db.admin, 'authenticated', claims, sql, params)
const asOn = (c: PgClient, claims: Claims, sql: string, params: unknown[] = []) => runAs<Row>(c, 'authenticated', claims, sql, params)
const asAnon = (sql: string, params: unknown[] = []) => runAs<Row>(db.admin, 'anon', null, sql, params)
const SUBMIT = 'select * from submit_comment($1, $2, $3, $4)'
const UPDATE = 'select * from update_comment($1, $2, $3, $4)'
const REDEEM = 'select * from redeem_access_code($1)'
const APPLY = 'select * from admin_apply_assignments($1, $2::jsonb, $3::jsonb)'
const submit = (claims: Claims, project: string, enjoyed = ENJOY, suggestion = SUGGEST, pronouns = '') =>
  as(claims, SUBMIT, [project, pronouns, enjoyed, suggestion])
const instructor = () => emailUser(INSTRUCTOR_EMAIL.toUpperCase())
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')
const count = async (sql: string, params: unknown[] = []) => Number((await db.admin.query<{ n: string }>(sql, params)).rows[0].n)
const setSetting = (k: string, v: number | boolean) => db.admin.query(`update settings set ${k} = $1 where id = 1`, [v])

const pairsJson = (edges: Edge[]) => JSON.stringify(edges.map((e) => ({ reviewer_id: e.reviewerId, project_id: e.projectId })))
const apply = (claims: Claims, course: string, caps: Record<string, number>, edges: Edge[]) =>
  as(claims, APPLY, [course, JSON.stringify(caps), pairsJson(edges)])
const pendingOf = (plan: Plan): Edge[] => plan.assignments.filter((a) => a.status === 'pending').map((a) => ({ reviewerId: a.reviewerId, projectId: a.projectId }))
function planFor(course: Course, seed: string, existing: ExistingEdge[] = [], keepPending = false): Plan {
  return planAssignments({ reviewers: idsOf(course), projects: eligibleOf(course), perReviewer: 4, baseSlots: 4, existing, keepPending, seed })
}
async function pendingPairs(course: string): Promise<string[]> {
  const r = await db.admin.query<{ k: string }>(`select reviewer_id || '>' || project_id k from assignments where course=$1 and status='pending' order by 1`, [course])
  return r.rows.map((x) => x.k)
}
const keys = (edges: Edge[]) => edges.map((e) => `${e.reviewerId}>${e.projectId}`).sort()

async function bindAll(ids: string[]): Promise<Claims[]> {
  const out: Claims[] = []
  for (const id of ids) out.push(await db.bind(id))
  return out
}

/** The lock-down checks, against any database of the cluster (used again after re-running the migration). */
async function assertLockedDown(c: PgClient): Promise<void> {
  for (const t of TABLES) {
    assert.match(await errorOf(runAs(c, 'anon', null, `select * from public.${t}`)), /permission denied/, `anon select ${t}`)
    assert.match(await errorOf(runAs(c, 'anon', null, `insert into public.${t} default values`)), /permission denied/, `anon insert ${t}`)
    const u = anonUser(randomUUID())
    assert.match(await errorOf(runAs(c, 'authenticated', u, `select * from public.${t}`)), /permission denied/, `auth select ${t}`)
    assert.match(await errorOf(runAs(c, 'authenticated', u, `delete from public.${t}`)), /permission denied/, `auth delete ${t}`)
  }
  const rel = await c.query<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`)
  assert.deepEqual(rel.rows.map((x) => x.relname).sort(), [...TABLES].sort())
  for (const x of rel.rows) assert.equal(x.relrowsecurity, true, `${x.relname} RLS`)
  assert.equal((await c.query(`select * from pg_policies where schemaname='public'`)).rowCount, 0, 'no policies')
  const seq = await c.query<{ n: string }>(
    `select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'
        and (has_sequence_privilege('anon', c.oid, 'usage,select,update') or has_sequence_privilege('authenticated', c.oid, 'usage,select,update'))`)
  assert.equal(Number(seq.rows[0].n), 0, 'no sequence privileges')
  const fns = await c.query<{ proname: string; anon: boolean; authn: boolean; pub: boolean; definer: boolean; cfg: string[] | null }>(
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') authn,
            exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) pub,
            p.prosecdef definer, p.proconfig cfg
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)
  for (const f of fns.rows) {
    assert.equal(f.anon, ANON_FUNCTIONS.includes(f.proname), `anon execute ${f.proname}`)
    assert.equal(f.authn, AUTH_FUNCTIONS.includes(f.proname), `authenticated execute ${f.proname}`)
    assert.equal(f.pub, false, `PUBLIC execute ${f.proname}`)
    assert.equal(f.definer, true, `${f.proname} security definer`)
    assert.deepEqual(f.cfg, ['search_path=public, extensions, pg_temp'], `${f.proname} search_path`)
  }
  for (const name of AUTH_FUNCTIONS) assert.ok(fns.rows.some((f) => f.proname === name), `function ${name} exists`)
  assert.equal(fns.rows.filter((f) => f.proname === 'redeem_access_code').length, 1, 'only the v2 redeem_access_code(text)')
}

describe('lock-down', () => {
  test('no table access, RLS on, no policies; anon executes only get_public_status + get_feedback_open; all definer + search_path', async () => {
    await assertLockedDown(db.admin)
    assert.equal((await asAnon('select * from get_public_status()')).length, eligibleOf('1101').length + eligibleOf('2241').length)
    assert.deepEqual(await asAnon('select get_feedback_open() v'), [{ v: true }])
    assert.deepEqual(await asAnon('select * from get_public_settings()'), [{ feedback_open: true, allow_extra_reviews: false }])
    for (const sql of ['select * from whoami()', 'select is_instructor()', `select * from redeem_access_code('x')`,
      'select admin_overview()', 'select * from my_quest()', `select * from submit_comment('pm-01','','x','y')`,
      `select _normalize_text('x')`, `select _access_code_hash('x')`, `select * from admin_apply_assignments('1101','{}','[]')`]) {
      assert.match(await errorOf(asAnon(sql)), /permission denied for function/, sql)
    }
    const u = await db.bind('pm-01')
    for (const sql of [`select _normalize_text('x')`, `select _access_code_hash('x')`, `select _lock_pair('pm-01','pm-02')`,
      `select _check_rate('pm-01')`, `select _require_instructor()`]) {
      assert.match(await errorOf(as(u, sql)), /permission denied for function/, sql)
    }
  })

  test('blocked_terms mirrors BLOCKED_TERMS', async () => {
    const r = await db.admin.query<{ term: string }>(`select term from blocked_terms order by term`)
    assert.deepEqual(r.rows.map((x) => x.term), [...BLOCKED_TERMS].sort())
  })

  test('settings defaults match the contract', async () => {
    const fresh = await db.admin.query<Row>(
      `select column_name, column_default from information_schema.columns where table_schema='public' and table_name='settings' and column_name <> 'id'`)
    const d = Object.fromEntries(fresh.rows.map((r) => [r.column_name, r.column_default]))
    assert.deepEqual(d, { base_slots: '4', reviews_per_student: '4', feedback_open: 'true', allow_extra_reviews: 'false',
      min_seconds_between_writes: '15', max_writes_per_hour: '20', max_failed_codes_per_session: '10', max_failed_codes_global: '300',
      max_anon_writes_per_source_hour: '240', max_anon_writes_global_hour: '600' })
  })
})

describe('text rules (parity with shared/rules.ts)', () => {
  test('SQL _validate_feedback matches validateFeedback on a corpus', async () => {
    const long = 'a'.repeat(800)
    const smile = U(0x1f600)
    const nbsp = U(0xa0); const ideo = U(0x3000); const ogham = U(0x1680); const enq = U(0x2000); const hair = U(0x200a)
    const ls = U(0x2028); const ps = U(0x2029); const nnbsp = U(0x202f); const mmsp = U(0x205f); const zwsp = U(0x200b)
    const corpus: Array<[string, string, string]> = [
      ['', ENJOY, SUGGEST], ['he/him', ENJOY, SUGGEST], ['  x  ', `\r\n\r\n${ENJOY}\r\n\r\n\r\n\r\nend`, SUGGEST],
      ['', 'fourteen chars', SUGGEST], ['', 'fifteen chars!!', SUGGEST], ['', '      short      ', SUGGEST],
      ['', long, SUGGEST], ['', long + 'b', SUGGEST], ['', smile.repeat(7) + 'a', SUGGEST], ['', smile.repeat(8), SUGGEST],
      ['', smile.repeat(400), SUGGEST], ['', smile.repeat(401), SUGGEST],
      ['', 'a   b' + ENJOY, SUGGEST], ['', ideo + ideo + ENJOY + BOM, SUGGEST],
      ['', `${nbsp}${ogham}${enq}${hair}${ls}${ps}${nnbsp}${mmsp}${ENJOY}${mmsp}${nnbsp}${ps}${ls}${hair}${enq}${ogham}${nbsp}`, SUGGEST],
      ['', `${zwsp}${ENJOY}${zwsp}`, SUGGEST], ['', `a${nbsp}${nbsp}\t b ${enq} c and more words here`, SUGGEST],
      ['', '\v\f' + ENJOY + '\f\v', SUGGEST], ['', `line one\r\rline two is here\n\n\n\nthree`, SUGGEST],
      ['', 'This is dumb, honestly speaking.', SUGGEST], ['', 'Dumbledore would be proud of this.', SUGGEST],
      ['', 'Please do not kill yourself over it.', SUGGEST], ['', 'Please do not kill  yourself over it.', SUGGEST],
      ['', 'kill, yourself is what it said there', SUGGEST], ["", "The idiot's guide was useful for me.", SUGGEST],
      ['', 'I would not call it ugly at all!', SUGGEST], ['', 'It looked UGLYED? weird word anyway.', SUGGEST],
      ['', 'the scunthorpe problem is avoided', SUGGEST], ['', 'Losers weepers, finders keepers ok', SUGGEST],
      ['', ENJOY, `Your design is st${U(0x130)}upid? not really, fine.`], ['', ENJOY, `${U(0x130)}diot, that is what I typed here`],
      ['', ENJOY, `Nice. Su${U(0x212a)}cks? no, it rocks really.`], ['', ENJOY, `It really su${U(0x212a)}s, sorry, kidding`],
      ['', ENJOY, 'i' + 'K'.repeat(20)], ['dumb', ENJOY, SUGGEST], ['x'.repeat(40), ENJOY, SUGGEST], ['x'.repeat(41), ENJOY, SUGGEST],
      [smile.repeat(20), ENJOY, SUGGEST], [smile.repeat(21), ENJOY, SUGGEST], ['', ENJOY, 'tab\t\t\tseparated words go here'],
      ['', 'STUPID!!! really, the colours', SUGGEST], ['', 'so stupided by the maze lol', SUGGEST], ['', ENJOY, 'kys'.padEnd(20, '.')],
      ['', `caf${U(0xe9)} stupid ${U(0xe9)}clair dessert world`, SUGGEST], ['', 'Ünïcödé wörds äre fïne hëre!', SUGGEST],
      ['', ENJOY, 'x'.repeat(15)], ['', ENJOY, ' '.repeat(30)], ['', 'a\n\nb', SUGGEST],
    ]
    for (const [p, e, s] of corpus) {
      const js = validateFeedback({ pronouns: p, enjoyed: e, suggestion: s })
      let sql: string
      try {
        const r = await db.admin.query<{ pronouns: string | null; enjoyed: string; suggestion: string }>(
          'select * from _validate_feedback($1,$2,$3)', [p, e, s])
        sql = JSON.stringify({ ok: true, value: { pronouns: r.rows[0].pronouns ?? '', enjoyed: r.rows[0].enjoyed, suggestion: r.rows[0].suggestion } })
      } catch (err) { sql = (err as Error).message }
      const expected = js.ok ? JSON.stringify({ ok: true, value: js.value }) : js.error
      assert.equal(sql, expected, `corpus ${JSON.stringify([p, e, s]).slice(0, 100)}`)
    }
  })
})

describe('access codes', () => {
  test('SQL normalisation + hash equal shared/accessCode.ts for every BMP character and random codes', async () => {
    const inputs: string[] = []
    for (let c = 1; c <= 0xffff; c++) if (c < 0xd800 || c > 0xdfff) inputs.push(U(c))
    for (const c of [0x10000, 0x1d400, 0x1f600, 0xe0041, 0x10ffff]) inputs.push(U(c))
    for (let i = 0; i < 300; i++) {
      const code = newAccessCode()
      inputs.push(code, code.toLowerCase(), code.replace(/-/g, ''), ` ${code.replace(/-/g, ' ')} `, code.replace(/-/g, '--'),
        code.slice(0, 13), code + 'X', `${code.slice(0, 5)}${U(0xdf)}${code.slice(5)}`)
    }
    inputs.push('', '-', 'abcd-efgh-ijkl', `${U(0xfb01)}${U(0xfb03)}${U(0xdf)}${U(0x131)}${U(0x17f)}${U(0x149)}abcdef`, 'ÉÀ-1234-ABCD-wxyz')
    const r = await db.admin.query<{ n: string; norm: string; hash: string }>(
      `select n, _normalize_access_code(x) norm, _access_code_hash(x) hash from unnest($1::text[]) with ordinality u(x, n) order by n`, [inputs])
    assert.equal(r.rows.length, inputs.length)
    let mismatches = 0
    for (const [i, row] of r.rows.entries()) {
      const js = normalizeAccessCode(inputs[i])
      if (row.norm !== js || row.hash !== hashAccessCode(inputs[i])) {
        mismatches++
        if (mismatches < 5) assert.fail(`input U+${inputs[i].codePointAt(0)!.toString(16)} ${JSON.stringify(inputs[i])}: SQL ${row.norm} vs JS ${js}`)
      }
    }
    assert.equal(mismatches, 0)
  })

  test('the correct code binds with any case, dashes or spaces (code only, no name or id)', async () => {
    const code = codeFor('s02-03')
    for (const typed of [code, code.toLowerCase(), code.replace(/-/g, ''), ` ${code.slice(0, 4)} ${code.slice(5, 9)} ${code.slice(10)} `,
      code.replace(/-/g, '').split('').join('-'), `${code.toLowerCase()}\n`]) {
      const u = anonUser(randomUUID())
      assert.deepEqual(await as(u, REDEEM, [typed]), [{ ok: true, error: null, student_id: 's02-03', full_name: fullNameOf('s02-03') }], typed)
      assert.equal((await as(u, 'select * from whoami()'))[0].student_id, 's02-03')
    }
    assert.equal(await count(`select count(*) n from code_attempts where ok`), 6)
  })

  test('a wrong code returns (false, bad_code) without raising, and the attempt row persists', async () => {
    const u = anonUser(randomUUID())
    assert.deepEqual(await as(u, REDEEM, ['ZZZZ-ZZZZ-ZZZZ']), [{ ok: false, error: 'bad_code', student_id: null, full_name: null }])
    assert.deepEqual(await as(u, REDEEM, ['']), [{ ok: false, error: 'bad_code', student_id: null, full_name: null }])
    assert.deepEqual(await as(u, REDEEM, [null]), [{ ok: false, error: 'bad_code', student_id: null, full_name: null }])
    assert.equal(await count(`select count(*) n from code_attempts where auth_uid=$1 and not ok`, [u.sub]), 3)
    assert.deepEqual(await as(u, 'select * from whoami()'), [])
    assert.equal(await errorOf(as({ role: 'authenticated' }, REDEEM, [codeFor('pm-01')])), 'not_signed_in')
  })

  test('per-session throttle: after max_failed_codes_per_session failures even the correct code is rate_limited', async () => {
    await setSetting('max_failed_codes_per_session', 3)
    const u = anonUser(randomUUID())
    for (let i = 0; i < 3; i++) assert.equal((await as(u, REDEEM, [`WRNG-WRNG-WRN${i + 2}`]))[0].error, 'bad_code')
    assert.deepEqual(await as(u, REDEEM, [codeFor('pm-02')]), [{ ok: false, error: 'rate_limited', student_id: null, full_name: null }])
    assert.deepEqual(await as(u, 'select * from whoami()'), [])
    assert.equal(await count(`select count(*) n from code_attempts where auth_uid=$1`, [u.sub]), 3, 'rate-limited calls are not checked or recorded')
    // Another browser is not affected.
    assert.equal((await as(anonUser(randomUUID()), REDEEM, [codeFor('pm-02')]))[0].ok, true)
    // 15 minutes later the session may try again.
    await db.admin.query(`update code_attempts set at = at - interval '16 minutes' where auth_uid=$1`, [u.sub])
    assert.equal((await as(u, REDEEM, [codeFor('pm-02')]))[0].student_id, 'pm-02')
  })

  test('per-session throttle holds under parallel requests from one session', async () => {
    await setSetting('max_failed_codes_per_session', 5)
    const u = anonUser(randomUUID())
    const clients = await Promise.all(Array.from({ length: 12 }, () => db.connect()))
    const out = await Promise.all(clients.map((c, i) => asOn(c, u, REDEEM, [`PAR${i}-XXXX-XXXX`])))
    await db.disconnect(clients)
    const errors = out.map((r) => r[0].error)
    assert.equal(errors.filter((e) => e === 'bad_code').length, 5, errors.join(','))
    assert.equal(errors.filter((e) => e === 'rate_limited').length, 7)
    assert.equal(await count(`select count(*) n from code_attempts where auth_uid=$1`, [u.sub]), 5)
  })

  test('global throttle across all sessions', async () => {
    await setSetting('max_failed_codes_global', 4)
    for (let i = 0; i < 4; i++) assert.equal((await as(anonUser(randomUUID()), REDEEM, ['NOPE-NOPE-NOPE']))[0].error, 'bad_code')
    assert.equal((await as(anonUser(randomUUID()), REDEEM, [codeFor('s01-01')]))[0].error, 'rate_limited')
    await db.admin.query(`update code_attempts set at = at - interval '16 minutes'`)
    assert.equal((await as(anonUser(randomUUID()), REDEEM, [codeFor('s01-01')]))[0].ok, true)
  })

  test('revoked code and inactive student → bad_code; re-binding a session moves it; sign_out_student', async () => {
    const u = anonUser(randomUUID())
    await db.admin.query(`update access_codes set revoked_at = now() where student_id='s01-02'`)
    assert.equal((await as(u, REDEEM, [codeFor('s01-02')]))[0].error, 'bad_code')
    await db.admin.query(`update students set active = false where id='s01-03'`)
    assert.equal((await as(u, REDEEM, [codeFor('s01-03')]))[0].error, 'bad_code')
    assert.equal((await as(u, REDEEM, [codeFor('s01-04')]))[0].student_id, 's01-04')
    assert.equal((await as(u, REDEEM, [codeFor('pm-04')]))[0].student_id, 'pm-04')
    assert.equal((await as(u, 'select * from whoami()'))[0].student_id, 'pm-04')
    assert.equal(await count(`select count(*) n from student_sessions where auth_uid=$1`, [u.sub]), 1)
    // A student who leaves the roster is signed out everywhere (their binding no longer counts).
    await db.admin.query(`update students set active = false where id='pm-04'`)
    assert.deepEqual(await as(u, 'select * from whoami()'), [])
    await db.admin.query(`update students set active = true where id='pm-04'`)
    await as(u, 'select sign_out_student()')
    assert.deepEqual(await as(u, 'select * from whoami()'), [])
  })

  test('whoami returns the contract fields; zero rows when unbound', async () => {
    assert.deepEqual(await as(anonUser(randomUUID()), 'select * from whoami()'), [])
    const u = await db.bind('s02-02')
    await db.completed('s02-02', 's01-01')
    await db.addComment('s01-02', 's02-02', 'removed')
    await setSetting('reviews_per_student', 5)
    assert.deepEqual(await as(u, 'select * from whoami()'), [{
      student_id: 's02-02', full_name: fullNameOf('s02-02'), first_name: 'Firsts0202', last_name: "O'Last2", course: '2241',
      section_code: 'MKTG 2241-02', reviews_completed: 1, reviews_required: 5, participating: true,
    }])
  })

  test('no function ever returns an access-code hash', async () => {
    const hashes = (await db.admin.query<{ code_hash: string }>(`select code_hash from access_codes`)).rows.map((r) => r.code_hash)
    const u = anonUser(randomUUID())
    const t = instructor()
    const outputs: unknown[] = []
    outputs.push(await as(u, REDEEM, [codeFor('pm-01')]))
    outputs.push(await as(u, REDEEM, ['nope']))
    outputs.push(await as(u, 'select * from whoami()'))
    await db.assign('pm-01', 'pm-02')
    outputs.push(await as(u, 'select * from my_quest()'))
    outputs.push(await as(u, 'select * from next_review()'))
    outputs.push(await submit(u, 'pm-02'))
    outputs.push(await as(u, 'select * from my_reviews()'))
    outputs.push(await as(u, 'select * from get_comments($1)', ['pm-02']))
    outputs.push(await asAnon('select * from get_public_status()'))
    outputs.push(await as(t, 'select admin_overview()'))
    outputs.push(await apply(t, '1101', {}, []))
    const text = JSON.stringify(outputs)
    for (const h of hashes) assert.ok(!text.includes(h), 'hash in output')
    assert.ok(!/[0-9a-f]{64}/.test(text), 'something hash-like in output')
    assert.ok(!text.includes('code_hash'))
    const sigs = await db.admin.query<{ n: string }>(
      `select count(*) n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
        where ns.nspname='public' and p.proname not like '\\_%' and (pg_get_function_result(p.oid) ilike '%hash%' or pg_get_function_result(p.oid) ilike '%access_codes%')`)
    assert.equal(Number(sigs.rows[0].n), 0)
  })
})

describe('submit_comment: every rule, in contract order', () => {
  test('not_signed_in', async () => {
    const u = anonUser(randomUUID())
    assert.equal(await errorOf(submit(u, 'pm-02', 'x')), 'not_signed_in')
    for (const sql of ['select * from my_reviews()', 'select * from my_quest()', 'select * from next_review()']) {
      assert.equal(await errorOf(as(u, sql)), 'not_signed_in', sql)
    }
    assert.equal(await errorOf(as(u, 'select * from get_comments($1)', ['pm-02'])), 'not_signed_in')
    assert.equal(await errorOf(as(u, UPDATE, [randomUUID(), '', ENJOY, SUGGEST])), 'not_signed_in')
  })

  test('closed comes before every other rule (even for an unavailable project)', async () => {
    await setSetting('feedback_open', false)
    const u = await db.bind('s01-01')
    assert.equal(await errorOf(submit(u, 's01-05', 'x')), 'closed')
    assert.equal(await errorOf(submit(u, 's01-01', 'x')), 'closed')
  })

  test('project_unavailable: missing link, broken link, hidden, inactive, unknown — before self_review', async () => {
    const u = await db.bind('s01-01')
    await db.assign('s01-01', 's02-05')
    assert.equal(await errorOf(submit(u, 's01-05', 'x')), 'project_unavailable', 'missing link')
    assert.equal(await errorOf(submit(u, 's02-05', 'x')), 'project_unavailable', 'valid url but broken link')
    assert.equal(await errorOf(submit(u, 's02-05')), 'project_unavailable', 'broken link even with an assignment')
    await db.admin.query(`update students set hidden = true where id='s01-02'`)
    assert.equal(await errorOf(submit(u, 's01-02')), 'project_unavailable', 'hidden')
    await db.admin.query(`update students set link_status = 'unchecked' where id='s01-03'`)
    assert.equal(await errorOf(submit(u, 's01-03')), 'project_unavailable', 'unchecked link')
    await db.admin.query(`update students set active = false where id='s01-04'`)
    assert.equal(await errorOf(submit(u, 's01-04')), 'project_unavailable', 'inactive')
    assert.equal(await errorOf(submit(u, 'nope-99')), 'project_unavailable', 'unknown')
    const own = await db.bind('s01-05')
    assert.equal(await errorOf(submit(own, 's01-05')), 'project_unavailable', 'own project without a link')
  })

  test('self_review before wrong_course and text rules', async () => {
    const u = await db.bind('s01-01')
    assert.equal(await errorOf(submit(u, 's01-01', 'x')), 'self_review')
  })

  test('wrong_course both directions (1101 → 2241 and 2241 → 1101), before text rules', async () => {
    const a = await db.bind('pm-01')
    const b = await db.bind('s02-01')
    await db.assign('pm-01', 's01-01')            // even a (bogus) assignment does not allow it
    assert.equal(await errorOf(submit(a, 's01-01')), 'wrong_course')
    assert.equal(await errorOf(submit(a, 's02-02', 'x')), 'wrong_course')
    assert.equal(await errorOf(submit(b, 'pm-01')), 'wrong_course')
    assert.equal(await errorOf(submit(b, 'pm-02', 'x')), 'wrong_course')
    assert.equal(await count(`select count(*) n from comments`), 0)
  })

  test('invalid_text and inappropriate (before rate limit and already_reviewed)', async () => {
    const u = await db.bind('pm-01')
    await db.assign('pm-01', 'pm-02')
    assert.equal(await errorOf(submit(u, 'pm-02', 'too short')), 'invalid_text')
    assert.equal(await errorOf(submit(u, 'pm-02', ENJOY, 'x'.repeat(801))), 'invalid_text')
    assert.equal(await errorOf(submit(u, 'pm-02', ENJOY, SUGGEST, 'p'.repeat(41))), 'invalid_text')
    assert.equal(await errorOf(submit(u, 'pm-02', 'This world is so stupid honestly.')), 'inappropriate')
    assert.equal(await errorOf(submit(u, 'pm-02', ENJOY, 'The colours felt DUMBED down in room two.')), 'inappropriate')
    assert.equal(await errorOf(submit(u, 'pm-02', ENJOY, SUGGEST, 'idiots')), 'inappropriate')
    await db.addComment('pm-03', 'pm-01')
    await db.admin.query(`insert into write_events (student_id, kind) values ('pm-01','submit')`)
    await setSetting('min_seconds_between_writes', 15)
    assert.equal(await errorOf(submit(u, 'pm-03', 'short')), 'invalid_text', 'text rules come before the rate limit and already_reviewed')
    assert.equal(await db.published('pm-02'), 0)
  })

  test('rate_limited (spacing and hourly cap) comes before already_reviewed', async () => {
    await setSetting('min_seconds_between_writes', 15)
    const u = await db.bind('pm-01')
    for (const p of ['pm-02', 'pm-03', 'pm-04']) await db.assign('pm-01', p)
    await submit(u, 'pm-02')
    assert.equal(await errorOf(submit(u, 'pm-03')), 'rate_limited')
    assert.equal(await errorOf(submit(u, 'pm-02')), 'rate_limited', 'not already_reviewed yet')
    await db.admin.query(`update write_events set at = at - interval '16 seconds'`)
    assert.equal(await errorOf(submit(u, 'pm-02')), 'already_reviewed')
    await submit(u, 'pm-03')

    await db.reset({ max_writes_per_hour: 2 })
    const v = await db.bind('s02-01')
    for (const p of ['s02-02', 's02-03', 's02-04']) await db.assign('s02-01', p)
    await submit(v, 's02-02')
    await submit(v, 's02-03')
    assert.equal(await errorOf(submit(v, 's02-04')), 'rate_limited')
    await db.admin.query(`update write_events set at = at - interval '61 minutes'`)
    await submit(v, 's02-04')
  })

  test('already_reviewed (also for a removed comment) comes before not_assigned', async () => {
    const u = await db.bind('pm-01')
    await db.addComment('pm-02', 'pm-01', 'removed')
    assert.equal(await errorOf(submit(u, 'pm-02')), 'already_reviewed')
    await db.addComment('pm-03', 'pm-01')
    assert.equal(await errorOf(submit(u, 'pm-03')), 'already_reviewed')
  })

  test('not_assigned: no assignment, or a released one', async () => {
    const u = await db.bind('pm-01')
    assert.equal(await errorOf(submit(u, 'pm-02')), 'not_assigned')
    await db.assign('pm-01', 'pm-03', 'released')
    assert.equal(await errorOf(submit(u, 'pm-03')), 'not_assigned')
    await db.assign('pm-02', 'pm-04')    // somebody else's assignment does not count
    assert.equal(await errorOf(submit(u, 'pm-04')), 'not_assigned')
  })

  test('project_full: pending assignment but published ≥ capacity (removed comments do not count)', async () => {
    for (const r of ['pm-02', 'pm-03', 'pm-04', 'pm-05']) await db.completed(r, 'pm-01')
    await db.assign('pm-06', 'pm-01')
    const u = await db.bind('pm-06')
    assert.equal(await errorOf(submit(u, 'pm-01')), 'project_full')
    await db.setCapacity('pm-01', 5)
    await submit(u, 'pm-01')
    assert.equal(await db.published('pm-01'), 5)
    await db.reset()
    await db.setCapacity('pm-01', 2)
    await db.completed('pm-02', 'pm-01'); await db.completed('pm-03', 'pm-01')
    await db.assign('pm-04', 'pm-01')
    assert.equal(await errorOf(submit(await db.bind('pm-04'), 'pm-01')), 'project_full')
    await db.admin.query(`update comments set status='removed' where reviewer_id='pm-03'`)
    await submit(await db.bind('pm-04'), 'pm-01')
    assert.equal(await db.published('pm-01'), 2)
  })

  test('success: row returned, reviewer name copied from the roster, assignment completed with comment_id', async () => {
    await db.admin.query(`update students set full_name = 'Roster Name' where id='s01-01'`)
    const u = await db.bind('s01-01')
    await db.assign('s01-01', 's02-01')   // cross-section inside MKTG 2241 is one pool
    const [row] = await submit(u, 's02-01', `  ${ENJOY}  `, SUGGEST, ' she/her ')
    assert.equal(row.project_id, 's02-01')
    assert.equal(row.reviewer_id, 's01-01')
    assert.equal(row.reviewer_name, 'Roster Name')
    assert.equal(row.enjoyed, ENJOY)
    assert.equal(row.pronouns, 'she/her')
    assert.deepEqual(Object.keys(row).sort(), ['created_at', 'enjoyed', 'id', 'project_id', 'pronouns', 'reviewer_id', 'reviewer_name', 'suggestion', 'updated_at'])
    const a = await db.admin.query<Row>(`select status, comment_id from assignments where reviewer_id='s01-01' and project_id='s02-01'`)
    assert.deepEqual(a.rows, [{ status: 'completed', comment_id: row.id }])
    const c = await db.admin.query<Row>(`select course, extra, status from comments where id=$1`, [row.id])
    assert.deepEqual(c.rows, [{ course: '2241', extra: false, status: 'published' }])
    assert.equal(await count(`select count(*) n from write_events where student_id='s01-01'`), 1)
    const st = await asAnon('select * from get_public_status()')
    assert.deepEqual(st.find((x) => x.project_id === 's02-01'), { project_id: 's02-01', course: '2241', published: 1, capacity: 4 })
  })

  test('pending assignment to a different reviewer course is impossible to complete (wrong_course wins)', async () => {
    await db.addStudent('pm-07', '1101', 'pm')
    const u = await db.bind('pm-07')
    assert.equal(await errorOf(submit(u, 's01-01')), 'wrong_course')
  })
})

describe('extra reviews', () => {
  async function finishedFour(reviewer: string, projects: string[]): Promise<void> {
    for (const p of projects) await db.completed(reviewer, p)
  }

  test('only when allow_extra_reviews AND 4 completed AND room beyond other reviewers\' pending', async () => {
    const R = 'pm-01'
    const u = await db.bind(R)
    await finishedFour(R, ['pm-02', 'pm-03', 'pm-04', 'pm-05'])
    const P = 'pm-06'
    assert.equal(await errorOf(submit(u, P)), 'not_assigned', 'switch off')
    await as(instructor(), 'select admin_set_allow_extra(true)')
    // Room check: P has capacity 4, 2 published, 2 pending for others → no room.
    await db.completed('pm-02', P); await db.completed('pm-03', P)
    await db.assign('pm-04', P); await db.assign('pm-05', P)
    assert.equal(await errorOf(submit(u, P)), 'not_assigned', 'all remaining slots are promised to others')
    await db.assign('pm-05', P, 'released')
    const [row] = await submit(u, P)
    assert.equal((await db.admin.query<Row>(`select extra from comments where id=$1`, [row.id])).rows[0].extra, true)
    assert.equal(await db.assignmentStatus(R, P), null, 'no assignment row is created for an extra review')
    const q = await as(u, 'select * from my_quest()')
    assert.deepEqual(q.filter((x) => x.status === 'extra'), [{ project_id: P, status: 'extra', comment_id: row.id, published: 3, capacity: 4 }])
    // The remaining slot is still there for pm-04's pending assignment.
    await submit(await db.bind('pm-04'), P)
    assert.equal(await db.published(P), 4)
  })

  test('a reviewer with only 3 completed cannot take an extra', async () => {
    await as(instructor(), 'select admin_set_allow_extra(true)')
    const u = await db.bind('pm-01')
    await finishedFour('pm-01', ['pm-02', 'pm-03', 'pm-04'])
    assert.equal(await errorOf(submit(u, 'pm-05')), 'not_assigned')
    await db.addComment('pm-05', 'pm-01', 'removed')   // removed reviews do not count either
    assert.equal(await errorOf(submit(u, 'pm-06')), 'not_assigned')
  })

  test('extras are only for projects with free room (full project → not_assigned)', async () => {
    await as(instructor(), 'select admin_set_allow_extra(true)')
    const u = await db.bind('s01-01')
    await finishedFour('s01-01', ['s01-02', 's01-03', 's01-04', 's02-01'])
    for (const r of ['s01-02', 's01-03', 's01-04', 's02-01']) await db.completed(r, 's02-02')
    assert.equal(await errorOf(submit(u, 's02-02')), 'not_assigned')
    await submit(u, 's02-03')    // cross-section extra is fine
  })
})

describe('update_comment', () => {
  test('author only; identity fields unchanged; no slot consumed at full capacity', async () => {
    await db.assign('pm-01', 'pm-02')
    const u = await db.bind('pm-01')
    const [row] = await submit(u, 'pm-02')
    for (const r of ['pm-03', 'pm-04', 'pm-05']) await db.completed(r, 'pm-02')
    assert.equal(await db.published('pm-02'), 4)
    await db.admin.query(`update students set full_name = 'Renamed Later' where id='pm-01'`)
    const [upd] = await as(u, UPDATE, [row.id, 'they/them', 'An edited answer that is long enough.', SUGGEST])
    assert.equal(upd.enjoyed, 'An edited answer that is long enough.')
    assert.equal(upd.pronouns, 'they/them')
    assert.equal(upd.id, row.id)
    assert.equal(upd.project_id, 'pm-02')
    assert.equal(upd.reviewer_id, 'pm-01')
    assert.equal(upd.reviewer_name, row.reviewer_name)
    assert.ok((upd.updated_at as Date) >= (row.updated_at as Date))
    assert.equal(await db.published('pm-02'), 4)
    assert.equal(await count(`select count(*) n from comments where reviewer_id='pm-01'`), 1)
    const other = await db.bind('pm-03')
    assert.equal(await errorOf(as(other, UPDATE, [row.id, '', ENJOY, SUGGEST])), 'not_author')
    assert.equal(await errorOf(as(u, UPDATE, [randomUUID(), '', ENJOY, SUGGEST])), 'not_found')
    assert.equal(await errorOf(as(u, UPDATE, [row.id, '', 'short', SUGGEST])), 'invalid_text')
    assert.equal(await errorOf(as(u, UPDATE, [row.id, '', ENJOY, 'This part is honestly so dumb.'])), 'inappropriate')
    const mine = await as(u, 'select * from my_reviews()')
    assert.equal(mine.length, 1)
    assert.equal(mine[0].pronouns, 'they/them')
    // A removed comment can no longer be edited.
    await db.admin.query(`update comments set status='removed' where id=$1`, [row.id])
    assert.equal(await errorOf(as(u, UPDATE, [row.id, '', ENJOY, SUGGEST])), 'not_found')
  })

  test('order: not_found / not_author before closed; closed before text; rate limit last', async () => {
    const id = await db.completed('pm-01', 'pm-02')
    const u = await db.bind('pm-01')
    const other = await db.bind('pm-03')
    await setSetting('feedback_open', false)
    assert.equal(await errorOf(as(other, UPDATE, [id, '', 'x', SUGGEST])), 'not_author')
    assert.equal(await errorOf(as(u, UPDATE, [id, '', 'x', SUGGEST])), 'closed')
    await setSetting('feedback_open', true)
    await setSetting('min_seconds_between_writes', 15)
    await db.admin.query(`insert into write_events (student_id, kind) values ('pm-01','submit')`)
    assert.equal(await errorOf(as(u, UPDATE, [id, '', 'x', SUGGEST])), 'invalid_text')
    assert.equal(await errorOf(as(u, UPDATE, [id, '', ENJOY, SUGGEST])), 'rate_limited')
  })
})

describe('my_quest / next_review', () => {
  test('my_quest: pending + completed + extra (not released), completed first, then md5(caller || project)', async () => {
    const me = 's02-01'
    const u = await db.bind(me)
    const done = await db.completed(me, 's01-01')
    const extra = await db.addComment('s01-02', me, 'published', true)
    await db.assign(me, 's01-03'); await db.assign(me, 's01-04'); await db.assign(me, 's02-02')
    await db.assign(me, 's02-03', 'released')
    await db.setCapacity('s01-04', 6)
    await db.completed('s02-04', 's01-04')
    const q = await as(u, 'select * from my_quest()')
    const pend = ['s01-03', 's01-04', 's02-02'].sort((a, b) => (md5(me + a) < md5(me + b) ? -1 : 1))
    assert.deepEqual(q.map((x) => [x.project_id, x.status]), [['s01-01', 'completed'], ['s01-02', 'extra'], ...pend.map((p) => [p, 'pending'])])
    assert.deepEqual(q[0], { project_id: 's01-01', status: 'completed', comment_id: done, published: 1, capacity: 4 })
    assert.equal(q[1].comment_id, extra)
    assert.deepEqual(q.find((x) => x.project_id === 's01-04'), { project_id: 's01-04', status: 'pending', comment_id: null, published: 1, capacity: 6 })
  })

  test('next_review: least-filled pending project (published / capacity), md5 tie-break, skips full and unavailable', async () => {
    const me = 'pm-01'
    const u = await db.bind(me)
    assert.deepEqual(await as(u, 'select * from next_review()'), [])
    await db.assign(me, 'pm-02'); await db.assign(me, 'pm-03'); await db.assign(me, 'pm-04')
    await db.completed('pm-05', 'pm-02'); await db.completed('pm-06', 'pm-02')          // 2/4 = 0.5
    await db.setCapacity('pm-03', 5); await db.completed('pm-05', 'pm-03')              // 1/5 = 0.2
    await db.completed('pm-05', 'pm-04'); await db.completed('pm-06', 'pm-04')          // 2/4 = 0.5
    assert.deepEqual(await as(u, 'select * from next_review()'), [{ project_id: 'pm-03' }])
    await db.completed('pm-06', 'pm-03')                                                // 2/5 = 0.4
    assert.deepEqual(await as(u, 'select * from next_review()'), [{ project_id: 'pm-03' }])
    await db.completed('pm-02', 'pm-03')                                                // 3/5 = 0.6 → tie 0.5 / 0.5
    const tie = md5(me + 'pm-02') < md5(me + 'pm-04') ? 'pm-02' : 'pm-04'
    assert.deepEqual(await as(u, 'select * from next_review()'), [{ project_id: tie }])
    await db.admin.query(`update students set link_status='broken' where id=$1`, [tie])
    const other = tie === 'pm-02' ? 'pm-04' : 'pm-02'
    assert.deepEqual(await as(u, 'select * from next_review()'), [{ project_id: other }])
    await db.setCapacity(other, 2)                                                       // full
    assert.deepEqual(await as(u, 'select * from next_review()'), [{ project_id: 'pm-03' }])
    await submit(u, 'pm-03')
    assert.deepEqual(await as(u, 'select * from next_review()'), [])
  })
})

describe('reading comments', () => {
  test('get_comments needs a bound student or an instructor, and is readable across courses', async () => {
    await db.completed('s01-01', 's02-01')
    await db.addComment('s02-01', 's01-02', 'removed')
    assert.equal(await errorOf(as(anonUser(randomUUID()), 'select * from get_comments($1)', ['s02-01'])), 'not_signed_in')
    assert.equal(await errorOf(as(emailUser('someone@example.edu'), 'select * from get_comments($1)', ['s02-01'])), 'not_signed_in')
    const reader1101 = await db.bind('pm-03')
    const rows = await as(reader1101, 'select * from get_comments($1)', ['s02-01'])
    assert.equal(rows.length, 1, 'published only, readable from the other course')
    assert.equal(rows[0].reviewer_id, 's01-01')
    assert.equal((await as(instructor(), 'select * from get_comments($1)', ['s02-01'])).length, 1)
    assert.match(await errorOf(asAnon('select * from get_comments($1)', ['s02-01'])), /permission denied/)
  })
})

/**
 * Hold a lock on one students row from a separate connection, start all calls, wait until every one of them is
 * blocked on a row lock (i.e. all passed the early checks at the same time), then release. This forces the
 * worst-case race deterministically instead of hoping the scheduler produces it.
 */
async function gated(lockId: string, fn: string, start: () => Promise<Row[]>[]): Promise<{ results: PromiseSettledResult<Row[]>[]; waited: number }> {
  const locker = await db.connect()
  await locker.query('begin')
  await locker.query('select 1 from students where id = $1 for update', [lockId])
  const calls = start()
  const settled = Promise.allSettled(calls)
  let waited = 0
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const r = await db.admin.query<{ n: string }>(
      `select count(*) n from pg_stat_activity where wait_event_type = 'Lock' and query like '%' || $1 || '%' and pid <> pg_backend_pid()`, [fn])
    waited = Number(r.rows[0].n)
    if (waited >= calls.length) break
    await new Promise((res) => setTimeout(res, 25))
  }
  await locker.query('commit')
  const results = await settled
  await db.disconnect([locker])
  return { results, waited }
}
const messages = (results: PromiseSettledResult<Row[]>[]) => results.flatMap((r) => (r.status === 'rejected' ? [(r.reason as Error).message] : []))

async function assertInvariants(): Promise<void> {
  assert.equal(await count(`select count(*) n from assignments a where a.status = 'pending'
     and exists (select 1 from comments c where c.reviewer_id = a.reviewer_id and c.project_id = a.project_id)`), 0,
  'no assignment is pending for a pair that already has a comment')
  assert.equal(await count(`select count(*) n from students s where _published(s.id) > _capacity(s.id)`), 0, 'published ≤ capacity everywhere')
  assert.equal(await count(`select count(*) n from comments c where c.status = 'published' and not c.extra
     and not exists (select 1 from assignments a where a.comment_id = c.id and a.status = 'completed')`), 0,
  'every assigned published comment has its completed assignment')
}

describe('concurrency (separate connections, simultaneous)', () => {
  test('(a) 10 simultaneous extra reviews for a project with exactly one free slot → exactly 1 succeeds', async () => {
    const P = 's01-01'
    for (const r of ['s01-02', 's01-03', 's01-04']) await db.completed(r, P)
    for (const id of ['s02-06', 's02-07', 's02-08', 's02-09']) await db.addStudent(id, '2241', '02')
    const reviewers = ['s01-05', 's02-01', 's02-02', 's02-03', 's02-04', 's02-05', 's02-06', 's02-07', 's02-08', 's02-09']
    const others = ['s01-02', 's01-03', 's01-04', 's02-01', 's02-02', 's02-03']
    for (const p of others) await db.setCapacity(p, 20)
    for (const r of reviewers) for (const p of others.filter((x) => x !== r).slice(0, 4)) await db.completed(r, p)
    await setSetting('allow_extra_reviews', true)
    const users = await bindAll(reviewers)
    const clients = await Promise.all(reviewers.map(() => db.connect()))
    const { results, waited } = await gated(P, 'submit_comment', () => users.map((u, i) => asOn(clients[i], u, SUBMIT, [P, '', ENJOY, SUGGEST])))
    await db.disconnect(clients)
    assert.equal(waited, reviewers.length, 'all submissions were in flight and queued on the lock at the same time')
    const ok = results.filter((r) => r.status === 'fulfilled')
    const errs = messages(results)
    assert.equal(ok.length, 1, `successes: ${ok.length}; errors: ${errs.join(',')}`)
    assert.ok(errs.every((e) => e === 'project_full' || e === 'not_assigned'), errs.join(','))
    assert.equal(await db.published(P), 4)
    assert.equal(await count(`select count(*) n from comments where project_id=$1 and extra`, [P]), 1)
    await assertInvariants()
  })

  test('(a2) 6 simultaneous assigned reviewers, capacity 4 → exactly 4 succeed, the rest project_full', async () => {
    const P = 'pm-01'
    await db.addStudent('pm-07', '1101', 'pm')
    const reviewers = ['pm-02', 'pm-03', 'pm-04', 'pm-05', 'pm-06', 'pm-07']
    for (const r of reviewers) await db.assign(r, P)
    const users = await bindAll(reviewers)
    const clients = await Promise.all(reviewers.map(() => db.connect()))
    const { results, waited } = await gated(P, 'submit_comment', () => users.map((u, i) => asOn(clients[i], u, SUBMIT, [P, '', ENJOY, SUGGEST])))
    await db.disconnect(clients)
    assert.equal(waited, reviewers.length)
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 4)
    assert.deepEqual(messages(results), ['project_full', 'project_full'])
    assert.equal(await db.published(P), 4)
    assert.equal(await count(`select count(*) n from assignments where project_id=$1 and status='completed'`, [P]), 4)
    assert.equal(await count(`select count(*) n from assignments where project_id=$1 and status='pending'`, [P]), 2)
    await assertInvariants()
  })

  test('(b) the same reviewer submitting to the same project from two sessions at once → exactly one row', async () => {
    const R = 's01-02'; const P = 's01-03'
    await db.assign(R, P)
    const users = await bindAll([R, R])
    const clients = await Promise.all(users.map(() => db.connect()))
    const { results, waited } = await gated(R, 'submit_comment', () => users.map((u, i) => asOn(clients[i], u, SUBMIT, [P, '', ENJOY, SUGGEST])))
    await db.disconnect(clients)
    assert.equal(waited, 2)
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.deepEqual(messages(results), ['already_reviewed'])
    assert.equal(await count(`select count(*) n from comments where reviewer_id=$1 and project_id=$2`, [R, P]), 1)
    await assertInvariants()
  })

  test('(c) admin_apply_assignments racing submit_comment never breaks capacity or leaves a completed pair pending', async () => {
    const t = instructor()
    const outcomes = new Set<string>()
    for (let round = 0; round < 8; round++) {
      await db.reset()
      const course: Course = round % 2 ? '2241' : '1101'
      const plan = planFor(course, `race-${round}`)
      assert.ok(plan.ok, plan.problems.join('; '))
      await apply(t, course, plan.capacities, pendingOf(plan))
      // A second plan computed BEFORE the submissions (as the dashboard would): even rounds re-send the same plan,
      // odd rounds drop every other pair (releasing them) and raise one capacity.
      const second = round % 4 < 2 ? pendingOf(plan) : pendingOf(plan).filter((_, i) => i % 2 === 0)
      const caps = { ...plan.capacities }
      const bump = Object.keys(caps)[round % Object.keys(caps).length]
      caps[bump] += 1
      const reviewers = idsOf(course)
      const users = await bindAll(reviewers)
      const clients = await Promise.all([...reviewers, 'instructor'].map(() => db.connect()))
      const firstOf = (r: string) => pendingOf(plan).find((e) => e.reviewerId === r)!.projectId
      const subs = () => users.map((u, i) => asOn(clients[i], u, SUBMIT, [firstOf(reviewers[i]), '', ENJOY, SUGGEST]).then(() => 'ok', (e: Error) => e.message))
      const adm = () => asOn(clients[reviewers.length], t, APPLY, [course, JSON.stringify(caps), pairsJson(second)]).then(() => 'applied', (e: Error) => e.message.split(':')[0])
      const all = round % 3 === 0 ? [adm(), ...subs()] : [...subs(), adm()]
      const out = await Promise.all(all)
      await db.disconnect(clients)
      for (const o of out) outcomes.add(o)
      assert.ok(out.every((o) => ['ok', 'applied', 'not_assigned', 'invalid_plan', 'project_full'].includes(o)), out.join(','))
      await assertInvariants()
    }
    assert.ok(outcomes.has('ok'))
  })
})

describe('instructor gating', () => {
  const ADMIN_CALLS: Array<[string, unknown[]]> = [
    ['select admin_overview()', []], ['select admin_remove_comment($1, $2)', [randomUUID(), 'x']],
    ['select admin_restore_comment($1)', [randomUUID()]], ['select admin_set_open($1)', [false]],
    ['select admin_set_allow_extra($1)', [true]], ['select admin_set_participating($1, $2)', ['pm-01', false]],
    [APPLY, ['1101', '{}', '[]']],
  ]

  test('students, anonymous JWTs carrying an instructor e-mail, and unknown e-mails are refused', async () => {
    const student = await db.bind('s01-01')
    const anonWithEmail: Claims = { ...anonUser(randomUUID()), email: INSTRUCTOR_EMAIL }
    const stranger = emailUser('someone@example.edu')
    const noSub: Claims = { role: 'authenticated', email: INSTRUCTOR_EMAIL, is_anonymous: false }
    for (const who of [student, anonWithEmail, stranger, noSub]) {
      assert.deepEqual(await as(who, 'select is_instructor() as v'), [{ v: false }])
      for (const [sql, params] of ADMIN_CALLS) assert.equal(await errorOf(as(who, sql, params)), 'not_instructor', sql)
    }
    for (const [sql, params] of ADMIN_CALLS) assert.match(await errorOf(asAnon(sql, params)), /permission denied/, sql)
    const s = (await db.admin.query<Row>(`select feedback_open, allow_extra_reviews from settings`)).rows[0]
    assert.deepEqual(s, { feedback_open: true, allow_extra_reviews: false })
    assert.equal(await count(`select count(*) n from audit_log`), 0)
  })

  test('e-mail match is case-insensitive in both directions', async () => {
    assert.deepEqual(await as(emailUser('Teacher@Example.EDU'), 'select is_instructor() as v'), [{ v: true }])
    await db.admin.query(`insert into instructors (email) values ('Second.Person@Example.edu')`)
    assert.deepEqual(await as(emailUser('second.person@example.edu'), 'select is_instructor() as v'), [{ v: true }])
    assert.deepEqual(await as(emailUser('second.person@example.ed'), 'select is_instructor() as v'), [{ v: false }])
  })
})

describe('admin_apply_assignments', () => {
  test('accepts the plans planAssignments makes for the seeded 1101 and 2241 pools', async () => {
    const t = instructor()
    for (const course of ['1101', '2241'] as const) {
      const plan = planFor(course, 'seed-1')
      assert.ok(plan.ok, plan.problems.join('; '))
      const [r] = await apply(t, course, plan.capacities, pendingOf(plan))
      assert.deepEqual(r, { inserted: pendingOf(plan).length, released: 0, kept: 0 })
      assert.deepEqual(await pendingPairs(course), keys(pendingOf(plan)))
      for (const [p, cap] of Object.entries(plan.capacities)) {
        assert.equal(Number((await db.admin.query<{ c: number }>(`select capacity c from project_slots where project_id=$1`, [p])).rows[0].c), cap)
      }
    }
    assert.equal((await pendingPairs('1101')).length, 24)
    assert.equal((await pendingPairs('2241')).length, 40)
    const slots = await db.admin.query<{ c: number }>(`select capacity c from project_slots s join students st on st.id=s.project_id where st.course='2241'`)
    assert.equal(slots.rows.reduce((a, x) => a + x.c, 0), 40, '40 reviews over 8 projects → capacity 5 each')
    // Re-applying the same plan keeps everything.
    const plan = planFor('1101', 'seed-1')
    assert.deepEqual((await apply(t, '1101', plan.capacities, pendingOf(plan)))[0], { inserted: 0, released: 0, kept: 24 })
    // Every student can now complete their quest.
    const u = await db.bind('pm-01')
    for (const e of pendingOf(plan).filter((x) => x.reviewerId === 'pm-01')) await submit(u, e.projectId)
    assert.equal((await as(u, 'select * from whoami()'))[0].reviews_completed, 4)
    assert.deepEqual(await as(u, 'select * from next_review()'), [])
    await assertInvariants()
  })

  test('keeps completed assignments, releases dropped pending ones, revives released ones', async () => {
    const t = instructor()
    const c1 = await db.completed('pm-01', 'pm-02')
    const existing: ExistingEdge[] = [{ reviewerId: 'pm-01', projectId: 'pm-02', status: 'completed' }]
    const plan = planFor('1101', 'keep', existing)
    assert.ok(plan.ok, plan.problems.join('; '))
    const pend = pendingOf(plan)
    assert.ok(!pend.some((e) => e.reviewerId === 'pm-01' && e.projectId === 'pm-02'))
    assert.equal(pend.filter((e) => e.reviewerId === 'pm-01').length, 3)
    await apply(t, '1101', plan.capacities, pend)
    assert.equal(await db.assignmentStatus('pm-01', 'pm-02'), 'completed')
    // Drop two pairs.
    const dropped = pend.slice(0, 2)
    const [r] = await apply(t, '1101', plan.capacities, pend.slice(2))
    assert.deepEqual(r, { inserted: 0, released: 2, kept: pend.length - 2 })
    for (const d of dropped) assert.equal(await db.assignmentStatus(d.reviewerId, d.projectId), 'released')
    assert.equal(await db.assignmentStatus('pm-01', 'pm-02'), 'completed', 'completed is never touched')
    assert.equal((await db.admin.query<Row>(`select comment_id from assignments where reviewer_id='pm-01' and project_id='pm-02'`)).rows[0].comment_id, c1)
    // Put them back.
    const [r2] = await apply(t, '1101', plan.capacities, pend)
    assert.deepEqual(r2, { inserted: 2, released: 0, kept: pend.length - 2 })
    for (const d of dropped) assert.equal(await db.assignmentStatus(d.reviewerId, d.projectId), 'pending')
    // Applying an empty plan releases every pending assignment of that course only.
    await db.assign('s01-01', 's01-02')
    const [r3] = await apply(t, '1101', {}, [])
    assert.deepEqual(r3, { inserted: 0, released: pend.length, kept: 0 })
    assert.equal(await db.assignmentStatus('s01-01', 's01-02'), 'pending')
    const log = await db.admin.query<Row>(`select actor, action, detail->>'course' course from audit_log order by id`)
    assert.deepEqual(log.rows.map((x) => x.action), ['apply_assignments', 'apply_assignments', 'apply_assignments', 'apply_assignments'])
    assert.ok(log.rows.every((x) => x.actor === INSTRUCTOR_EMAIL && x.course === '1101'))
  })

  test('rejects every invalid plan with invalid_plan and changes nothing', async () => {
    const t = instructor()
    const good = planFor('2241', 'base')
    await apply(t, '2241', good.capacities, pendingOf(good))
    await db.completed('s01-01', 's02-04')
    await db.addComment('s02-03', 's01-02', 'removed')
    for (const r of ['s02-01', 's02-02', 's01-01', 's01-02', 's01-04']) await db.completed(r, 's01-03')   // s01-03: 5 published = capacity
    await db.completed('s01-04', 's01-01'); await db.completed('s01-04', 's01-02')   // s01-04 has written 3
    await db.admin.query(`update students set active=false where id='s02-02'`)
    await db.admin.query(`update students set participating=false where id='s02-03'`)
    await db.admin.query(`update students set hidden=true where id='s02-04'`)
    const before = await pendingPairs('2241')
    const slotsBefore = (await db.admin.query(`select * from project_slots order by project_id`)).rows
    const E = (reviewerId: string, projectId: string): Edge => ({ reviewerId, projectId })
    const cases: Array<[string, string, Record<string, number>, Edge[] | string, RegExp]> = [
      ['unknown course', '9999', {}, [], /unknown course/],
      ['null course', null as unknown as string, {}, [], /unknown course/],
      ['assignments not an array', '2241', {}, '{"a":1}', /must be an array/],
      ['assignment without ids', '2241', {}, '[{"reviewer_id":"s01-01"}]', /needs a reviewer_id/],
      ['capacity not a number', '2241', { 's01-02': 'x' as unknown as number }, [], /not a whole number/],
      ['capacity fractional', '2241', { 's01-02': 4.5 }, [], /not a whole number/],
      ['self', '2241', {}, [E('s01-02', 's01-02')], /self review/],
      ['duplicate', '2241', {}, [E('s01-02', 's02-01'), E('s01-02', 's02-01')], /duplicate pair/],
      ['wrong-course project', '2241', {}, [E('s01-02', 'pm-01')], /project pm-01 is not eligible/],
      ['wrong-course reviewer', '2241', {}, [E('pm-01', 's01-02')], /reviewer pm-01 is not/],
      ['reviewer plan sent for the other course', '1101', {}, [E('s01-02', 's02-01')], /reviewer s01-02 is not/],
      ['ineligible project: missing link', '2241', {}, [E('s01-02', 's01-05')], /project s01-05 is not eligible/],
      ['ineligible project: broken link', '2241', {}, [E('s01-02', 's02-05')], /project s02-05 is not eligible/],
      ['ineligible project: hidden', '2241', {}, [E('s01-02', 's02-04')], /project s02-04 is not eligible/],
      ['ineligible project: inactive', '2241', {}, [E('s01-02', 's02-02')], /project s02-02 is not eligible/],
      ['unknown project', '2241', {}, [E('s01-02', 's09-99')], /project s09-99 is not eligible/],
      ['inactive reviewer', '2241', {}, [E('s02-02', 's01-02')], /reviewer s02-02 is not/],
      ['non-participating reviewer', '2241', {}, [E('s02-03', 's01-02')], /reviewer s02-03 is not/],
      ['already commented (published)', '2241', {}, [E('s02-01', 's01-03')], /s02-01>s01-03 already has a comment/],
      ['already commented (removed)', '2241', {}, [E('s01-02', 's02-03')], /s01-02>s02-03 already has a comment/],
      ['capacity below base_slots', '2241', { 's01-02': 3 }, [], /capacity of s01-02 is below/],
      ['capacity below published', '2241', { 's01-03': 4 }, [], /capacity of s01-03 is below/],
      ['capacity for another course', '2241', { 'pm-01': 4 }, [], /pm-01 which is not in 2241/],
      ['over capacity', '2241', { 's01-01': 4 }, ['s01-02', 's01-03', 's02-01', 's01-05', 's02-04'].map((r) => E(r, 's01-01')), /project s01-01 would be over capacity/],
      ['over capacity counting published', '2241', {}, [E('s01-05', 's01-03')], /project s01-03 would be over capacity/],
      ['reviewer over quota', '2241', {}, ['s01-01', 's01-02', 's01-03', 's02-01', 's02-03'].map((p) => E('s01-05', p)), /reviewer s01-05 would have more than 4/],
      ['reviewer over quota counting published', '2241', {}, ['s02-01', 's02-03'].map((p) => E('s01-04', p)), /reviewer s01-04 would have more than 4/],
    ]
    for (const [name, course, caps, edges, re] of cases) {
      const msg = await errorOf(as(t, APPLY, [course, JSON.stringify(caps), typeof edges === 'string' ? edges : pairsJson(edges)]))
      assert.match(msg, /^invalid_plan: /, `${name}: ${msg}`)
      assert.match(msg, re, `${name}: ${msg}`)
    }
    assert.deepEqual(await pendingPairs('2241'), before, 'pending set unchanged')
    assert.deepEqual((await db.admin.query(`select * from project_slots order by project_id`)).rows, slotsBefore, 'capacities unchanged')
    assert.equal(await count(`select count(*) n from audit_log where action='apply_assignments'`), 1)
  })
})

describe('other instructor functions', () => {
  test('admin_set_participating(false) releases pending assignments (and only those)', async () => {
    const t = instructor()
    await db.assign('pm-01', 'pm-02'); await db.assign('pm-01', 'pm-03'); await db.completed('pm-01', 'pm-04')
    await db.assign('pm-02', 'pm-01')
    await as(t, 'select admin_set_participating($1, $2)', ['pm-01', false])
    assert.equal(await db.assignmentStatus('pm-01', 'pm-02'), 'released')
    assert.equal(await db.assignmentStatus('pm-01', 'pm-03'), 'released')
    assert.equal(await db.assignmentStatus('pm-01', 'pm-04'), 'completed')
    assert.equal(await db.assignmentStatus('pm-02', 'pm-01'), 'pending', 'others reviewing their project are unaffected')
    const u = await db.bind('pm-01')
    assert.equal((await as(u, 'select * from whoami()'))[0].participating, false)
    assert.equal(await errorOf(submit(u, 'pm-02')), 'not_assigned')
    await as(t, 'select admin_set_participating($1, $2)', ['pm-01', true])
    assert.equal(await db.assignmentStatus('pm-01', 'pm-02'), 'released', 'participating again does not revive (re-plan instead)')
    assert.equal(await errorOf(as(t, 'select admin_set_participating($1, $2)', ['nobody', false])), 'not_found')
    const log = await db.admin.query<Row>(`select action, detail from audit_log order by id`)
    assert.deepEqual(log.rows.map((x) => x.action), ['set_participating', 'set_participating'])
    assert.equal((log.rows[0].detail as Row).released, 2)
  })

  test('remove frees the slot and releases the assignment; restore refused when full, then completes it again', async () => {
    const t = instructor()
    const P = 's01-01'
    const ids: string[] = []
    for (const r of ['s01-02', 's01-03', 's01-04', 's02-01']) {
      await db.assign(r, P)
      ids.push((await submit(await db.bind(r), P))[0].id as string)
    }
    await db.assign('s02-02', P)
    const late = await db.bind('s02-02')
    assert.equal(await errorOf(submit(late, P)), 'project_full')
    await as(t, 'select admin_remove_comment($1, $2)', [ids[0], '  off-topic  '])
    assert.equal(await db.published(P), 3)
    assert.equal(await db.assignmentStatus('s01-02', P), 'released')
    assert.deepEqual((await asAnon('select * from get_public_status()')).find((x) => x.project_id === P), { project_id: P, course: '2241', published: 3, capacity: 4 })
    await submit(late, P)
    assert.equal(await errorOf(as(t, 'select admin_restore_comment($1)', [ids[0]])), 'project_full')
    await as(t, 'select admin_remove_comment($1, $2)', [ids[1], 'duplicate'])
    await as(t, 'select admin_restore_comment($1)', [ids[0]])
    assert.equal(await db.published(P), 4)
    assert.equal(await db.assignmentStatus('s01-02', P), 'completed')
    assert.equal(await db.assignmentStatus('s01-03', P), 'released')
    await as(t, 'select admin_restore_comment($1)', [ids[0]])   // already published: no-op
    assert.equal(await errorOf(as(t, 'select admin_remove_comment($1, $2)', [randomUUID(), 'x'])), 'not_found')
    assert.equal(await errorOf(as(t, 'select admin_restore_comment($1)', [randomUUID()])), 'not_found')
    const c = (await db.admin.query<Row>(`select status, removed_reason from comments where id=$1`, [ids[1]])).rows[0]
    assert.deepEqual(c, { status: 'removed', removed_reason: 'duplicate' })
    const log = await db.admin.query<{ action: string; actor: string }>(`select action, actor from audit_log order by id`)
    assert.deepEqual(log.rows.map((x) => x.action), ['remove_comment', 'remove_comment', 'restore_comment'])
    assert.ok(log.rows.every((x) => x.actor === INSTRUCTOR_EMAIL))
    await assertInvariants()
  })

  test('admin_set_open(false) blocks submit and update with closed; get_feedback_open follows; audit rows', async () => {
    const t = instructor()
    await db.assign('pm-01', 'pm-02')
    const id = await db.completed('pm-01', 'pm-03')
    const u = await db.bind('pm-01')
    await as(t, 'select admin_set_open(false)')
    assert.deepEqual(await asAnon('select get_feedback_open() v'), [{ v: false }])
    assert.equal(await errorOf(submit(u, 'pm-02')), 'closed')
    assert.equal(await errorOf(as(u, UPDATE, [id, '', ENJOY, SUGGEST])), 'closed')
    await as(t, 'select admin_set_open(true)')
    await submit(u, 'pm-02')
    await as(u, UPDATE, [id, '', ENJOY, SUGGEST])
    await as(t, 'select admin_set_allow_extra(true)')
    assert.equal((await db.admin.query<Row>(`select allow_extra_reviews from settings`)).rows[0].allow_extra_reviews, true)
    const log = await db.admin.query<Row>(`select action, detail from audit_log order by id`)
    assert.deepEqual(log.rows.map((x) => [x.action, x.detail]), [['set_open', { open: false }], ['set_open', { open: true }], ['set_allow_extra', { allow: true }]])
  })

  test('admin_overview has the contract fields', async () => {
    const t = instructor()
    await db.setCapacity('s01-01', 6)
    await db.completed('s02-01', 's01-01')
    await db.assign('s02-02', 's01-01')
    await db.addComment('s01-02', 's02-03', 'published', true)
    await db.admin.query(`update students set participating=false where id='s01-04'`)
    const [{ admin_overview: ov }] = await as(t, 'select admin_overview()') as Array<{ admin_overview: { settings: Row; students: Row[]; assignments: Row[]; comments: Row[] } }>
    assert.deepEqual(Object.keys(ov.settings).sort(), ['allow_extra_reviews', 'base_slots', 'feedback_open', 'max_anon_writes_global_hour',
      'max_anon_writes_per_source_hour', 'max_failed_codes_global', 'max_failed_codes_per_session', 'max_writes_per_hour',
      'min_seconds_between_writes', 'reviews_per_student'])
    assert.equal(ov.students.length, STUDENTS.length)
    const s = ov.students.find((x) => x.id === 's01-01')!
    assert.deepEqual(s, { id: 's01-01', course: '2241', section: '01', section_code: 'MKTG 2241-01', full_name: fullNameOf('s01-01'),
      url_status: 'valid', link_status: 'working', active: true, participating: true, hidden: false, eligible: true, capacity: 6,
      published_received: 1, written: 0 })
    assert.equal(ov.students.find((x) => x.id === 's02-05')!.eligible, false)
    assert.equal(ov.students.find((x) => x.id === 's01-04')!.participating, false)
    assert.equal(ov.students.find((x) => x.id === 's02-03')!.written, 1)
    assert.deepEqual(ov.assignments, [{ reviewer_id: 's02-01', project_id: 's01-01', course: '2241', status: 'completed' },
      { reviewer_id: 's02-02', project_id: 's01-01', course: '2241', status: 'pending' }])
    assert.equal(ov.comments.length, 2)
    assert.deepEqual(Object.keys(ov.comments[0]).sort(), ['course', 'created_at', 'enjoyed', 'extra', 'id', 'project_id', 'pronouns',
      'removed_reason', 'reviewer_id', 'reviewer_name', 'status', 'suggestion', 'updated_at'])
    assert.equal(ov.comments.find((c) => c.reviewer_id === 's02-03')!.extra, true)
  })
})

test('get_public_status: active eligible projects only, published only, capacity from project_slots or base_slots', async () => {
  await db.completed('pm-02', 'pm-01')
  await db.addComment('pm-01', 'pm-03', 'removed')
  await db.setCapacity('pm-01', 7)
  await db.admin.query(`update students set active=false where id='pm-06'`)
  await db.admin.query(`update students set hidden=true where id='pm-05'`)
  await setSetting('base_slots', 3)
  const st = await asAnon('select * from get_public_status()')
  const expected = [...eligibleOf('1101'), ...eligibleOf('2241')].filter((x) => x !== 'pm-05' && x !== 'pm-06').sort()
  assert.deepEqual(st.map((x) => x.project_id), expected)
  assert.deepEqual(st.find((x) => x.project_id === 'pm-01'), { project_id: 'pm-01', course: '1101', published: 1, capacity: 7 })
  assert.deepEqual(st.find((x) => x.project_id === 'pm-02'), { project_id: 'pm-02', course: '1101', published: 0, capacity: 3 })
  assert.deepEqual(Object.keys(st[0]).sort(), ['capacity', 'course', 'project_id', 'published'])
})

test('re-running the migration on a populated database keeps all data and the lock-down', async () => {
  const t = instructor()
  const plan = planFor('2241', 'rerun')
  await apply(t, '2241', plan.capacities, pendingOf(plan))
  const first = pendingOf(plan)[0]
  const c = (await submit(await db.bind(first.reviewerId), first.projectId))[0].id
  await as(anonUser(randomUUID()), REDEEM, ['WRONG-WRONG-WRONG'])
  await db.admin.query(`update settings set reviews_per_student = 5, allow_extra_reviews = true where id = 1`)
  await db.admin.query(`update students set participating = false where id = 's02-04'`)
  const snapshot = async () => ({
    students: (await db.admin.query(`select * from students order by id`)).rows,
    comments: (await db.admin.query(`select * from comments order by id`)).rows,
    assignments: (await db.admin.query(`select * from assignments order by id`)).rows,
    slots: (await db.admin.query(`select * from project_slots order by project_id`)).rows,
    codes: (await db.admin.query(`select * from access_codes order by student_id`)).rows,
    attempts: (await db.admin.query(`select * from code_attempts order by id`)).rows,
    settings: (await db.admin.query(`select * from settings`)).rows,
    audit: (await db.admin.query(`select * from audit_log order by id`)).rows,
  })
  const before1 = await snapshot()
  await db.admin.query(await allMigrationsSql())
  await db.admin.query(await allMigrationsSql())
  assert.deepEqual(await snapshot(), before1)
  assert.equal((await db.admin.query(`select 1 from comments where id = $1`, [c])).rowCount, 1)
  await assertLockedDown(db.admin)
  assert.equal((await as(anonUser(randomUUID()), REDEEM, [codeFor('s01-02')]))[0].student_id, 's01-02')
})

test('running v2 over a v1 database converges (v1 objects dropped, students and comments kept)', async (t) => {
  const v1 = spawnSync('git', ['show', 'd6a03e4:supabase/migrations/001_feedback_classroom.sql'], { cwd: ROOT, encoding: 'utf8' })
  if (v1.status !== 0 || !v1.stdout.includes('recommend_project')) { t.skip('v1 migration not available from git history'); return }
  const name = `v1up_${process.pid}`
  await db.admin.query(`drop database if exists ${name}`)
  await db.admin.query(`create database ${name}`)
  const c = await db.connect(name)
  try {
    await c.query(SUPABASE_STANDINS)
    await c.query(v1.stdout)
    await c.query(`insert into students (id, section, section_code, full_name, project_url, url_status) values
      ('s01-01','01','MKTG 2241-01','Ann Old','https://example.org/a/','valid'), ('s02-01','02','MKTG 2241-02','Bob Old','https://example.org/b/','valid')`)
    await c.query(`insert into access_codes (student_id, code_hash) values ('s01-01', '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz12345')`)
    await c.query(`insert into comments (project_id, reviewer_id, reviewer_name, enjoyed, suggestion) values ('s01-01','s02-01','Bob Old','x','y')`)
    await c.query(`insert into reservations (reviewer_id, project_id, expires_at) values ('s02-01','s01-01', now())`)
    await c.query(await allMigrationsSql())
    await c.query(await allMigrationsSql())
    const st = await c.query<Row>(`select id, course, section, link_status, active, participating, hidden from students order by id`)
    assert.deepEqual(st.rows, [
      { id: 's01-01', course: '2241', section: '01', link_status: 'unchecked', active: true, participating: true, hidden: false },
      { id: 's02-01', course: '2241', section: '02', link_status: 'unchecked', active: true, participating: true, hidden: false }])
    assert.deepEqual((await c.query<Row>(`select course, extra, reviewer_name from comments`)).rows, [{ course: '2241', extra: false, reviewer_name: 'Bob Old' }])
    assert.equal(Number((await c.query<{ n: string }>(`select count(*) n from access_codes`)).rows[0].n), 0, 'unusable bcrypt hashes removed')
    assert.equal((await c.query(`select 1 from pg_namespace where nspname='feedback_private'`)).rowCount, 0)
    assert.equal((await c.query(`select to_regclass('public.reservations') r`)).rows[0].r, null)
    const cols = await c.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema='public' and table_name='settings' order by 1`)
    assert.deepEqual(cols.rows.map((x) => x.column_name), ['allow_extra_reviews', 'base_slots', 'feedback_open', 'id', 'max_anon_writes_global_hour',
      'max_anon_writes_per_source_hour', 'max_failed_codes_global', 'max_failed_codes_per_session', 'max_writes_per_hour',
      'min_seconds_between_writes', 'reviews_per_student'])
    await assertLockedDown(c)
    await c.query(`insert into access_codes (student_id, code_hash) values ('s01-01', $1)`, [hashAccessCode(codeFor('s01-01'))])
    const r = await runAs<Row>(c, 'authenticated', anonUser(randomUUID()), REDEEM, [codeFor('s01-01')])
    assert.equal(r[0].student_id, 's01-01')
  } finally {
    await db.disconnect([c])
    await db.admin.query(`drop database if exists ${name} with (force)`)
  }
})

test('scripts: build-live-sql + generate-access-codes load, codes redeem, --only rotates, codes never printed', async () => {
  const dir = path.join(ROOT, '.pg-test', `scripts-${process.pid}`)
  await mkdir(dir, { recursive: true })
  const mkStudent = (id: string, course: '1101' | '2241', first: string, last: string, url: string | null, urlStatus: string,
    link: string, hidden?: boolean) => ({
    id, course, courseCode: `MKTG ${course}`, section: course === '1101' ? 'pm' : id.slice(1, 3),
    sectionCode: course === '1101' ? 'MKTG 1101' : `MKTG 2241-${id.slice(1, 3)}`, position: Number(id.slice(-2)), firstName: first,
    lastName: last, fullName: `${first} ${last}`, url, urlStatus, urlNote: '', creatureId: 'x', link: { status: link }, ...(hidden ? { hidden } : {}) })
  const roster = {
    schema: 'fairfield-roster', version: 2, source: { file: 'synthetic.xlsx', sheets: ['x'], importedAt: '2026-11-23T00:00:00Z' },
    students: [
      mkStudent('s01-90', '2241', `Zo${U(0xeb)}`, "D'Arcy", 'https://example.org/a/', 'valid', 'working'),
      mkStudent('s02-91', '2241', 'Bob, Jr.', 'Smith "B"', null, 'missing', 'unchecked'),
      mkStudent('pm-92', '1101', '=Ann', 'Lee\\', "https://example.org/it's/", 'valid', 'broken', true),
    ],
    removed: [],
  }
  const rosterPath = path.join(dir, 'roster.json')
  await writeFile(rosterPath, JSON.stringify(roster))
  const run = (script: string, args: string[]) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout + r.stderr
  }
  const ids = roster.students.map((s) => s.id)
  const ALPHA = '[23456789ABCDEFGHJKMNPQRSTUVWXYZ]'
  try {
    run('build-live-sql.ts', ['--roster', rosterPath, '--out', path.join(dir, 'roster_upsert.sql')])
    const out1 = run('generate-access-codes.ts', ['--roster', rosterPath, '--out-dir', dir])
    const sql = await readFile(path.join(dir, 'roster_upsert.sql'), 'utf8')
    await db.admin.query(sql)
    await db.admin.query(`update students set participating = false where id = 's01-90'`)
    await db.admin.query(sql)   // idempotent, keeps participating
    await db.admin.query(await readFile(path.join(dir, 'access_codes_upsert.sql'), 'utf8'))
    const csvFiles = (await readdir(dir)).filter((f) => /^access_codes_\d{4}-\d{2}-\d{2}\.csv$/.test(f))
    assert.equal(csvFiles.length, 1)
    const raw = await readFile(path.join(dir, csvFiles[0]), 'utf8')
    assert.ok(raw.startsWith(BOM))
    const rows = raw.slice(1).trim().split('\r\n')
    assert.equal(rows[0], 'student_id,course,section,first_name,last_name,code')
    assert.equal(rows.length, 4)
    assert.ok(rows.includes(`pm-92,1101,pm,"=Ann",Lee\\,${rows.find((l) => l.startsWith('pm-92,'))!.split(',').at(-1)}`), 'formula-looking cell is quoted')
    const codeOf = (csv: string[], id: string) => csv.find((l) => l.startsWith(`${id},`))!.split(',').at(-1)!
    for (const id of ids) {
      const code = codeOf(rows, id)
      assert.match(code, new RegExp(`^${ALPHA}{4}-${ALPHA}{4}-${ALPHA}{4}$`))
      assert.ok(!out1.includes(code), 'code printed to the terminal')
    }
    const upsert = await readFile(path.join(dir, 'access_codes_upsert.sql'), 'utf8')
    for (const id of ids) assert.ok(!upsert.includes(codeOf(rows, id)), 'code in the hash file')
    assert.match(upsert, /'[0-9a-f]{64}'/)
    const st = await db.admin.query(`select id, course, section, section_code, full_name, project_url, url_status, link_status, hidden, active, participating
                                       from students where id = any($1) or id = 'pm-01' order by id`, [ids])
    assert.deepEqual(st.rows, [
      { id: 'pm-01', course: '1101', section: 'pm', section_code: 'MKTG 1101', full_name: fullNameOf('pm-01'), project_url: 'https://example.org/pm-01/', url_status: 'valid', link_status: 'working', hidden: false, active: false, participating: true },
      { id: 'pm-92', course: '1101', section: 'pm', section_code: 'MKTG 1101', full_name: '=Ann Lee\\', project_url: "https://example.org/it's/", url_status: 'valid', link_status: 'broken', hidden: true, active: true, participating: true },
      { id: 's01-90', course: '2241', section: '01', section_code: 'MKTG 2241-01', full_name: `Zo${U(0xeb)} D'Arcy`, project_url: 'https://example.org/a/', url_status: 'valid', link_status: 'working', hidden: false, active: true, participating: false },
      { id: 's02-91', course: '2241', section: '02', section_code: 'MKTG 2241-02', full_name: 'Bob, Jr. Smith "B"', project_url: null, url_status: 'missing', link_status: 'unchecked', hidden: false, active: true, participating: true },
    ])
    assert.equal(await count(`select count(*) n from students where active`), 3, 'students not on the roster are set inactive')
    const u = anonUser(randomUUID())
    const redeem = (code: string) => as(u, REDEEM, [code])
    const first = codeOf(rows, 's01-90')
    assert.equal((await redeem(first.toLowerCase()))[0].full_name, `Zo${U(0xeb)} D'Arcy`)

    // Rotate one student: new CSV (never overwriting the first), old code stops working.
    const out2 = run('generate-access-codes.ts', ['--roster', rosterPath, '--out-dir', dir, '--only', 's01-90'])
    await db.admin.query(await readFile(path.join(dir, 'access_codes_upsert.sql'), 'utf8'))
    const csv2 = (await readdir(dir)).filter((f) => /^access_codes_.*_2\.csv$/.test(f))
    assert.equal(csv2.length, 1)
    const rows2 = (await readFile(path.join(dir, csv2[0]), 'utf8')).slice(1).trim().split('\r\n')
    assert.equal(rows2.length, 2)
    const second = codeOf(rows2, 's01-90')
    assert.ok(!out2.includes(second))
    assert.equal((await redeem(first))[0].error, 'bad_code')
    assert.equal((await redeem(second))[0].student_id, 's01-90')

    const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-access-codes.ts'), '--roster', path.join(dir, 'nope.json'), '--out-dir', dir], { encoding: 'utf8' })
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /Roster not found/)
    const badOnly = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-access-codes.ts'), '--roster', rosterPath, '--out-dir', dir, '--only', 'zz-99'], { encoding: 'utf8' })
    assert.notEqual(badOnly.status, 0)
    await writeFile(rosterPath, JSON.stringify({ ...roster, students: [{ ...roster.students[0], course: '3000' }] }))
    const badEnum = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-live-sql.ts'), '--roster', rosterPath, '--out', path.join(dir, 'x.sql')], { encoding: 'utf8' })
    assert.notEqual(badEnum.status, 0)
    assert.match(badEnum.stderr, /unknown course/)
    await writeFile(rosterPath, JSON.stringify({ ...roster, students: [{ ...roster.students[0], link: { status: 'great' } }] }))
    const badLink = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-live-sql.ts'), '--roster', rosterPath, '--out', path.join(dir, 'x.sql')], { encoding: 'utf8' })
    assert.match(badLink.stderr, /unknown link status/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
