/**
 * Live-mode database tests: supabase/migrations/001_feedback_classroom.sql against an embedded Postgres 17 with
 * Supabase stand-ins (see harness.ts). This proves the SQL, not a real Supabase project.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { BLOCKED_TERMS, validateFeedback } from '../../shared/rules.ts'
import {
  TestDb, runAs, errorOf, codeFor, anonUser, emailUser, INSTRUCTOR_EMAIL, MIGRATION, ROOT, STUDENTS, type Claims, type PgClient,
} from './harness.ts'

const db = new TestDb()
before(async () => { await db.start() }, { timeout: 240_000 })
after(async () => { await db.stop() }, { timeout: 60_000 })
beforeEach(async () => { await db.reset() })

const ENJOY = 'I loved the glowing lanterns in the forest.'
const SUGGEST = 'Maybe add a short guide at the entrance.'
const TABLES = ['settings', 'students', 'access_codes', 'student_sessions', 'comments', 'reservations', 'write_events',
  'instructors', 'audit_log', 'blocked_terms']
const AUTH_FUNCTIONS = ['get_project_counts', 'redeem_access_code', 'whoami', 'sign_out_student', 'get_comments', 'my_reviews',
  'submit_comment', 'update_comment', 'recommend_project', 'is_instructor', 'admin_overview', 'admin_remove_comment',
  'admin_restore_comment', 'admin_set_open']

type Row = Record<string, unknown>
const as = (claims: Claims | null, sql: string, params: unknown[] = []) => runAs<Row>(db.admin, 'authenticated', claims, sql, params)
const asOn = (c: PgClient, claims: Claims, sql: string, params: unknown[] = []) => runAs<Row>(c, 'authenticated', claims, sql, params)
const asAnon = (sql: string, params: unknown[] = []) => runAs<Row>(db.admin, 'anon', null, sql, params)
const SUBMIT = 'select * from submit_comment($1, $2, $3, $4)'
const submit = (claims: Claims, project: string, enjoyed = ENJOY, suggestion = SUGGEST, pronouns = '') =>
  as(claims, SUBMIT, [project, pronouns, enjoyed, suggestion])
const published = async (project: string) =>
  Number((await db.admin.query<{ n: string }>(`select count(*) n from comments where project_id=$1 and status='published'`, [project])).rows[0].n)
const instructor = () => emailUser(INSTRUCTOR_EMAIL.toUpperCase())

describe('lock-down', () => {
  test('anon and authenticated cannot select or insert any table', async () => {
    for (const t of TABLES) {
      assert.match(await errorOf(asAnon(`select * from public.${t}`)), /permission denied/, `anon select ${t}`)
      assert.match(await errorOf(asAnon(`insert into public.${t} default values`)), /permission denied/, `anon insert ${t}`)
      const u = await db.bind('s01-01')
      assert.match(await errorOf(as(u, `select * from public.${t}`)), /permission denied/, `auth select ${t}`)
      assert.match(await errorOf(as(u, `delete from public.${t}`)), /permission denied/, `auth delete ${t}`)
    }
    assert.match(await errorOf(asAnon(`select * from feedback_private.access_code_status`)), /permission denied/)
  })

  test('every table has RLS on and no policies', async () => {
    const r = await db.admin.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='r'`)
    assert.deepEqual(r.rows.map((x) => x.relname).sort(), [...TABLES].sort())
    for (const x of r.rows) assert.equal(x.relrowsecurity, true, x.relname)
    const p = await db.admin.query(`select * from pg_policies where schemaname='public'`)
    assert.equal(p.rowCount, 0)
  })

  test('anon can execute only get_project_counts; authenticated exactly the contract functions', async () => {
    const r = await db.admin.query<{ proname: string; anon: boolean; authn: boolean; definer: boolean; cfg: string[] | null }>(
      `select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
              has_function_privilege('authenticated', p.oid, 'execute') authn, p.prosecdef definer, p.proconfig cfg
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)
    for (const f of r.rows) {
      assert.equal(f.anon, f.proname === 'get_project_counts', `anon execute ${f.proname}`)
      assert.equal(f.authn, AUTH_FUNCTIONS.includes(f.proname), `authenticated execute ${f.proname}`)
      assert.equal(f.definer, true, `${f.proname} security definer`)
      assert.deepEqual(f.cfg, ['search_path=public, extensions, pg_temp'], `${f.proname} search_path`)
    }
    assert.equal((await asAnon('select * from get_project_counts()')).length, STUDENTS.length)
    for (const sql of ['select whoami()', 'select is_instructor()', `select * from redeem_access_code('s01-01','x')`,
      'select admin_overview()', 'select * from recommend_project()', `select _normalize_text('x')`]) {
      assert.match(await errorOf(asAnon(sql)), /permission denied for function/, sql)
    }
  })

  test('blocked_terms table mirrors BLOCKED_TERMS', async () => {
    const r = await db.admin.query<{ term: string }>(`select term from blocked_terms order by term`)
    assert.deepEqual(r.rows.map((x) => x.term), [...BLOCKED_TERMS].sort())
  })
})

describe('identity', () => {
  test('unbound authenticated user gets not_signed_in', async () => {
    const u = anonUser(randomUUID())
    assert.equal(await errorOf(submit(u, 's01-02')), 'not_signed_in')
    assert.equal(await errorOf(as(u, 'select * from get_comments($1)', ['s01-02'])), 'not_signed_in')
    assert.equal(await errorOf(as(u, 'select * from my_reviews()')), 'not_signed_in')
    assert.equal(await errorOf(as(u, 'select * from recommend_project()')), 'not_signed_in')
    assert.equal(await errorOf(as(u, `select * from update_comment($1,'',$2,$3)`, [randomUUID(), ENJOY, SUGGEST])), 'not_signed_in')
    assert.deepEqual(await as(u, 'select * from whoami()'), [])
  })

  test('redeem: bad_code, lock after 5 failures, correct code refused while locked, reset by instructor', async () => {
    const u = anonUser(randomUUID())
    const redeem = (code: string, id = 's01-03') => as(u, 'select * from redeem_access_code($1, $2)', [id, code])
    for (let i = 1; i <= 4; i++) assert.equal(await errorOf(redeem('WRONG-CODE1')), 'bad_code', `attempt ${i}`)
    assert.equal(await errorOf(redeem('WRONG-CODE1')), 'locked', 'attempt 5 locks')
    assert.equal(await errorOf(redeem(codeFor('s01-03'))), 'locked', 'correct code while locked')
    const st = await db.admin.query<{ failed: number; locked_until: Date }>(`select * from feedback_private.access_code_status where student_id='s01-03'`)
    assert.equal(st.rows[0].failed, 5)
    assert.ok(st.rows[0].locked_until.getTime() > Date.now() + 14 * 60_000)
    assert.deepEqual(await as(u, 'select * from whoami()'), [])
    // Lock lapsed (simulated by the instructor-facing columns) → the correct code works again.
    await db.admin.query(`update access_codes set failed_attempts = 0, locked_until = null where student_id='s01-03'`)
    assert.equal(await errorOf(redeem('WRONG-CODE1')), 'bad_code')
    const ok = await redeem(codeFor('s01-03').toLowerCase().replace('-', ' '))
    assert.deepEqual(ok, [{ student_id: 's01-03', full_name: "First013 O'Last3" }])
    const st2 = await db.admin.query<{ failed: number }>(`select failed from feedback_private.access_code_status where student_id='s01-03'`)
    assert.equal(st2.rows[0].failed, 0, 'success resets the counter')
  })

  test('redeem: expired lock starts a fresh count', async () => {
    await db.admin.query(`update access_codes set failed_attempts = 5, locked_until = now() - interval '1 minute' where student_id='s01-04'`)
    const u = anonUser(randomUUID())
    assert.equal(await errorOf(as(u, 'select * from redeem_access_code($1,$2)', ['s01-04', 'NOPE0-NOPE0'])), 'bad_code')
    const r = await as(u, 'select * from redeem_access_code($1,$2)', ['s01-04', codeFor('s01-04')])
    assert.equal(r[0].student_id, 's01-04')
  })

  test('redeem: unknown, revoked, inactive students and missing auth.uid()', async () => {
    const u = anonUser(randomUUID())
    assert.equal(await errorOf(as(u, 'select * from redeem_access_code($1,$2)', ['s09-99', 'AAAAA-AAAAA'])), 'bad_code')
    await db.admin.query(`update access_codes set revoked_at = now() where student_id='s01-05'`)
    assert.equal(await errorOf(as(u, 'select * from redeem_access_code($1,$2)', ['s01-05', codeFor('s01-05')])), 'bad_code')
    await db.admin.query(`update students set active = false where id='s01-06'`)
    assert.equal(await errorOf(as(u, 'select * from redeem_access_code($1,$2)', ['s01-06', codeFor('s01-06')])), 'bad_code')
    assert.equal(await errorOf(as({ role: 'authenticated' }, 'select * from redeem_access_code($1,$2)', ['s01-07', codeFor('s01-07')])), 'not_signed_in')
  })

  test('correct code binds (both $2a$ and $2b$ hashes); whoami; sign_out_student', async () => {
    for (const id of ['s01-01', 's01-02']) {
      const u = anonUser(randomUUID())
      await as(u, 'select * from redeem_access_code($1,$2)', [id, codeFor(id)])
      const w = await as(u, 'select * from whoami()')
      assert.deepEqual(w, [{ student_id: id, full_name: STUDENTS.find((s) => s.id === id)!.first + " O'Last" + id.slice(-1), section: '01', reviews_written: 0 }])
      await as(u, 'select sign_out_student()')
      assert.deepEqual(await as(u, 'select * from whoami()'), [])
    }
  })
})

describe('submit_comment rules', () => {
  test('self_review', async () => {
    const u = await db.bind('s01-01')
    assert.equal(await errorOf(submit(u, 's01-01')), 'self_review')
  })

  test('project_unavailable for missing / invalid / unknown / inactive projects', async () => {
    const u = await db.bind('s01-01')
    assert.equal(await errorOf(submit(u, 's01-08')), 'project_unavailable')
    assert.equal(await errorOf(submit(u, 's02-08')), 'project_unavailable')
    assert.equal(await errorOf(submit(u, 'nope')), 'project_unavailable')
    await db.admin.query(`update students set active=false where id='s01-02'`)
    assert.equal(await errorOf(submit(u, 's01-02')), 'project_unavailable')
  })

  test('success returns the row with roster name; already_reviewed on a second submit', async () => {
    const u = await db.bind('s01-01')
    const [row] = await submit(u, 's01-02', `  ${ENJOY}  `, SUGGEST, ' she/her ')
    assert.equal(row.project_id, 's01-02')
    assert.equal(row.reviewer_id, 's01-01')
    assert.equal(row.reviewer_name, "First011 O'Last1")
    assert.equal(row.enjoyed, ENJOY)
    assert.equal(row.pronouns, 'she/her')
    assert.equal(await errorOf(submit(u, 's01-02')), 'already_reviewed')
    const counts = await asAnon('select * from get_project_counts()')
    assert.equal(counts.find((c) => c.project_id === 's01-02')!.published, 1)
    const other = await db.bind('s01-03')
    assert.equal((await as(other, 'select * from get_comments($1)', ['s01-02'])).length, 1)
  })

  test('update_comment: author can edit; ids and name unchanged; others get not_author; unknown not_found', async () => {
    const u = await db.bind('s01-01')
    const [row] = await submit(u, 's01-02')
    const [upd] = await as(u, 'select * from update_comment($1,$2,$3,$4)', [row.id, 'they/them', 'An edited answer that is long enough.', SUGGEST])
    assert.equal(upd.enjoyed, 'An edited answer that is long enough.')
    assert.equal(upd.project_id, 's01-02')
    assert.equal(upd.reviewer_id, 's01-01')
    assert.equal(upd.reviewer_name, row.reviewer_name)
    assert.ok((upd.updated_at as Date) >= (row.updated_at as Date))
    const other = await db.bind('s01-03')
    assert.equal(await errorOf(as(other, 'select * from update_comment($1,$2,$3,$4)', [row.id, '', ENJOY, SUGGEST])), 'not_author')
    assert.equal(await errorOf(as(u, 'select * from update_comment($1,$2,$3,$4)', [randomUUID(), '', ENJOY, SUGGEST])), 'not_found')
    const mine = await as(u, 'select * from my_reviews()')
    assert.equal(mine.length, 1)
    assert.equal(mine[0].pronouns, 'they/them')
  })

  test('invalid_text and inappropriate', async () => {
    const u = await db.bind('s01-01')
    assert.equal(await errorOf(submit(u, 's01-02', 'too short')), 'invalid_text')
    assert.equal(await errorOf(submit(u, 's01-02', ENJOY, 'x'.repeat(801))), 'invalid_text')
    assert.equal(await errorOf(submit(u, 's01-02', ENJOY, SUGGEST, 'p'.repeat(41))), 'invalid_text')
    assert.equal(await errorOf(submit(u, 's01-02', 'This world is so stupid honestly.')), 'inappropriate')
    assert.equal(await errorOf(submit(u, 's01-02', ENJOY, 'The colours felt DUMBED down in room two.')), 'inappropriate')
    assert.equal(await errorOf(submit(u, 's01-02', ENJOY, SUGGEST, 'idiots')), 'inappropriate')
    assert.equal(await published('s01-02'), 0)
  })

  test('SQL text validation matches shared/rules.ts validateFeedback on a corpus', async () => {
    const long = 'a'.repeat(800)
    const corpus: Array<[string, string, string]> = [
      ['', ENJOY, SUGGEST], ['he/him', ENJOY, SUGGEST], ['  x  ', `\r\n\r\n${ENJOY}\r\n\r\n\r\n\r\nend`, SUGGEST],
      ['', 'fourteen chars', SUGGEST], ['', 'fifteen chars!!', SUGGEST], ['', '      short      ', SUGGEST],
      ['', long, SUGGEST], ['', long + 'b', SUGGEST], ['', '😀'.repeat(7) + 'a', SUGGEST], ['', '😀'.repeat(8), SUGGEST], ['', '😀'.repeat(400), SUGGEST], ['', '😀'.repeat(401), SUGGEST],
      ['', 'a   b' + ENJOY, SUGGEST], ['', '　　' + ENJOY + '﻿', SUGGEST],
      ['', 'This is dumb, honestly speaking.', SUGGEST], ['', 'Dumbledore would be proud of this.', SUGGEST],
      ['', 'Please do not kill yourself over it.', SUGGEST], ['', 'Please do not kill  yourself over it.', SUGGEST],
      ['', 'kill, yourself is what it said there', SUGGEST], ['', "The idiot's guide was useful for me.", SUGGEST],
      ['', 'I would not call it ugly at all!', SUGGEST], ['', 'It looked UGLYED? weird word anyway.', SUGGEST],
      ['', 'the scunthorpe problem is avoided', SUGGEST], ['', 'Losers weepers, finders keepers ok', SUGGEST],
      ['', ENJOY, 'Your design is stİupid? not really, fine.'], ['', ENJOY, 'Nice. SuKcks? no, it rocks really.'],
      ['', ENJOY, 'i' + 'K'.repeat(20)], ['dumb', ENJOY, SUGGEST], ['x'.repeat(40), ENJOY, SUGGEST], ['x'.repeat(41), ENJOY, SUGGEST],
      ['😀'.repeat(20), ENJOY, SUGGEST], ['😀'.repeat(21), ENJOY, SUGGEST], ['', ENJOY, 'tab\t\t\tseparated words go here'],
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
      assert.equal(sql, expected, `corpus ${JSON.stringify([p, e, s]).slice(0, 80)}`)
    }
  })

  test('rate_limited: minimum spacing and hourly cap', async () => {
    await db.reset({ min_seconds_between_writes: 15 })
    const u = await db.bind('s01-01')
    const [row] = await submit(u, 's01-02')
    assert.equal(await errorOf(submit(u, 's01-03')), 'rate_limited')
    assert.equal(await errorOf(as(u, 'select * from update_comment($1,$2,$3,$4)', [row.id, '', ENJOY, SUGGEST])), 'rate_limited')
    await db.admin.query(`update write_events set at = at - interval '16 seconds'`)
    await submit(u, 's01-03')

    await db.reset({ min_seconds_between_writes: 0, max_writes_per_hour: 2 })
    const v = await db.bind('s02-01')
    await submit(v, 's02-02')
    await submit(v, 's02-03')
    assert.equal(await errorOf(submit(v, 's02-04')), 'rate_limited')
    await db.admin.query(`update write_events set at = at - interval '61 minutes'`)
    await submit(v, 's02-04')
  })

  test('closed', async () => {
    await db.reset({ feedback_open: false })
    const u = await db.bind('s01-01')
    assert.equal(await errorOf(submit(u, 's01-02')), 'closed')
  })

  test('project_full at 4 published (removed comments do not count)', async () => {
    for (const r of ['s02-01', 's02-02', 's02-03', 's02-04']) await submit(await db.bind(r), 's01-01')
    assert.equal(await published('s01-01'), 4)
    assert.equal(await errorOf(submit(await db.bind('s02-05'), 's01-01')), 'project_full')
    await db.admin.query(`update comments set status='removed' where reviewer_id='s02-04'`)
    await submit(await db.bind('s02-05'), 's01-01')
    assert.equal(await published('s01-01'), 4)
  })

  test('reviewer_limit at 4 written', async () => {
    const u = await db.bind('s01-01')
    for (const p of ['s01-02', 's01-03', 's01-04', 's01-05']) await submit(u, p)
    assert.equal(await errorOf(submit(u, 's01-06')), 'reviewer_limit')
    assert.equal(await errorOf(as(u, 'select * from recommend_project()')), 'reviewer_limit')
    assert.equal((await as(u, 'select * from whoami()'))[0].reviews_written, 4)
  })
})

async function bindAll(ids: string[]): Promise<Claims[]> {
  const out: Claims[] = []
  for (const id of ids) out.push(await db.bind(id))
  return out
}

/**
 * Hold a lock on one students row from a separate connection, start all calls, wait until every one of them is
 * blocked on a row lock inside submit_comment (i.e. all passed the early checks at the same time), then release.
 * This forces the worst-case race deterministically instead of hoping the scheduler produces it.
 */
async function gated(lockId: string, start: () => Promise<Row[]>[]): Promise<{ results: PromiseSettledResult<Row[]>[]; waited: number }> {
  const locker = await db.connect()
  await locker.query('begin')
  await locker.query('select 1 from students where id = $1 for update', [lockId])
  const calls = start()
  const settled = Promise.allSettled(calls)
  let waited = 0
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const r = await db.admin.query<{ n: string }>(
      `select count(*) n from pg_stat_activity where wait_event_type = 'Lock' and query like '%submit_comment%'`)
    waited = Number(r.rows[0].n)
    if (waited >= calls.length) break
    await new Promise((res) => setTimeout(res, 25))
  }
  await locker.query('commit')
  return { results: await settled, waited }
}

describe('concurrency (separate connections, simultaneous)', () => {
  test('project cap: 3 published + 10 simultaneous reviewers → exactly 1 succeeds, final count 4', async () => {
    const P = 's01-01'
    for (const r of ['s01-02', 's01-03', 's01-04']) await db.addComment(P, r)
    const reviewers = ['s01-05', 's01-06', 's01-07', 's01-08', 's02-01', 's02-02', 's02-03', 's02-04', 's02-05', 's02-06']
    const users = await bindAll(reviewers)
    const clients = await Promise.all(reviewers.map(() => db.connect()))
    const { results, waited } = await gated(P, () => users.map((u, i) => asOn(clients[i], u, SUBMIT, [P, '', ENJOY, SUGGEST])))
    assert.equal(waited, reviewers.length, 'all submissions were in flight and queued on the lock at the same time')
    const ok = results.filter((r) => r.status === 'fulfilled')
    const errs = results.flatMap((r) => (r.status === 'rejected' ? [(r.reason as Error).message] : []))
    assert.equal(ok.length, 1, `successes: ${ok.length}; errors: ${errs.join(',')}`)
    assert.deepEqual([...new Set(errs)], ['project_full'])
    assert.equal(await published(P), 4)
  })

  test('reviewer cap: reviewer at 3 submits to 8 projects from 8 devices at once → exactly 1 succeeds', async () => {
    const R = 's02-01'
    for (const p of ['s01-01', 's01-02', 's01-03']) await db.addComment(p, R)
    const projects = ['s01-04', 's01-05', 's01-06', 's01-07', 's02-02', 's02-03', 's02-04', 's02-05']
    const users = await bindAll(projects.map(() => R))
    const clients = await Promise.all(projects.map(() => db.connect()))
    const { results, waited } = await gated(R, () => projects.map((p, i) => asOn(clients[i], users[i], SUBMIT, [p, '', ENJOY, SUGGEST])))
    assert.equal(waited, projects.length, 'all submissions were in flight and queued on the lock at the same time')
    const ok = results.filter((r) => r.status === 'fulfilled')
    const errs = results.flatMap((r) => (r.status === 'rejected' ? [(r.reason as Error).message] : []))
    assert.equal(ok.length, 1, `successes: ${ok.length}; errors: ${errs.join(',')}`)
    assert.deepEqual([...new Set(errs)], ['reviewer_limit'])
    const n = await db.admin.query<{ n: string }>(`select count(*) n from comments where reviewer_id=$1 and status='published'`, [R])
    assert.equal(Number(n.rows[0].n), 4)
  })

  test('mixed: many reviewers hammering 2 projects at once never exceed either cap and never deadlock', async () => {
    const targets = ['s01-01', 's02-01']
    const reviewers = STUDENTS.map((s) => s.id).filter((id) => !targets.includes(id))
    const users = await bindAll(reviewers)
    const clients = await Promise.all(reviewers.flatMap(() => targets.map(() => db.connect())))
    const calls = reviewers.flatMap((_, i) => targets.map((t, j) => asOn(clients[i * targets.length + j], users[i], SUBMIT, [t, '', ENJOY, SUGGEST])
      .then(() => 'ok', (e: Error) => e.message)))
    const outcomes = await Promise.all(calls)
    assert.ok(outcomes.every((o) => o === 'ok' || o === 'project_full'), outcomes.join(','))
    for (const t of targets) assert.equal(await published(t), 4)
  })
})

describe('recommend_project', () => {
  test('excludes self, already reviewed, full and invalid/missing projects', async () => {
    const me = 's01-02'
    const fillers = ['s02-04', 's02-05', 's02-06', 's02-07']
    const valid = STUDENTS.filter((s) => s.status === 'valid').map((s) => s.id)
    const A = 's01-03'; const X = 's02-02'
    for (const p of valid) {
      if (p === me || p === A || p === X) continue
      let k = 0
      for (const r of [...fillers, 's01-08', 's02-08']) { if (r !== p && k < 4) { await db.addComment(p, r); k++ } }
    }
    await db.addComment(A, me)                         // reviewed by me (1 published)
    await db.addComment(X, 's01-08'); await db.addComment(X, 's02-08')  // 2 published, eligible
    const u = await db.bind(me)
    assert.deepEqual(await as(u, 'select * from recommend_project()'), [{ project_id: X }])
    const res = await db.admin.query(`select project_id from reservations where reviewer_id=$1`, [me])
    assert.deepEqual(res.rows, [{ project_id: X }])
    await db.addComment(X, me, 'removed')             // reviewed in any status → excluded
    assert.deepEqual(await as(u, 'select * from recommend_project()'), [])
    assert.equal((await db.admin.query(`select 1 from reservations where reviewer_id=$1`, [me])).rowCount, 0)
  })

  test('reservations spread two reviewers onto different projects when counts tie; submit clears it', async () => {
    const a = await db.bind('s01-01'); const b = await db.bind('s01-02')
    const [ra] = await as(a, 'select * from recommend_project()')
    const [rb] = await as(b, 'select * from recommend_project()')
    assert.notEqual(ra.project_id, rb.project_id)
    assert.notEqual(ra.project_id, 's01-01'); assert.notEqual(rb.project_id, 's01-02')
    // Stable: asking again gives the same suggestion.
    assert.deepEqual(await as(a, 'select * from recommend_project()'), [ra])
    await submit(a, ra.project_id as string)
    assert.equal((await db.admin.query(`select 1 from reservations where reviewer_id='s01-01'`)).rowCount, 0)
  })

  test('simultaneous recommendations from different reviewers also spread', async () => {
    const ids = ['s01-01', 's01-02', 's01-03', 's01-04', 's02-01', 's02-02']
    const users = await bindAll(ids)
    const clients = await Promise.all(ids.map(() => db.connect()))
    const got = await Promise.all(users.map((u, i) => asOn(clients[i], u, 'select * from recommend_project()')))
    const picks = got.map((r) => r[0].project_id)
    assert.equal(new Set(picks).size, picks.length, picks.join(','))
  })

  test('prefers the section with the lower mean published count when scores tie', async () => {
    for (const r of ['s02-05', 's02-06', 's02-07']) await db.addComment('s01-01', r)
    const u = await db.bind('s02-01')
    const [r] = await as(u, 'select * from recommend_project()')
    assert.match(r.project_id as string, /^s02-/)
  })
})

describe('instructor', () => {
  const ADMIN_CALLS: Array<[string, unknown[]]> = [
    ['select admin_overview()', []], ['select admin_remove_comment($1, $2)', [randomUUID(), 'x']],
    ['select admin_restore_comment($1)', [randomUUID()]], ['select admin_set_open($1)', [false]],
  ]

  test('non-instructors and anonymous JWTs carrying an instructor e-mail are refused', async () => {
    const student = await db.bind('s01-01')
    const anonWithEmail: Claims = { ...anonUser(randomUUID()), email: INSTRUCTOR_EMAIL }
    const stranger = emailUser('someone@example.edu')
    for (const who of [student, anonWithEmail, stranger]) {
      assert.deepEqual(await as(who, 'select is_instructor() as v'), [{ v: false }])
      for (const [sql, params] of ADMIN_CALLS) assert.equal(await errorOf(as(who, sql, params)), 'not_instructor', sql)
    }
    assert.equal((await db.admin.query(`select feedback_open from settings`)).rows[0].feedback_open, true)
  })

  test('overview, remove frees a slot, restore refused when full, set_open', async () => {
    const t = instructor()
    assert.deepEqual(await as(t, 'select is_instructor() as v'), [{ v: true }])
    const ids: string[] = []
    for (const r of ['s02-01', 's02-02', 's02-03', 's02-04']) ids.push((await submit(await db.bind(r), 's01-01'))[0].id as string)
    const late = await db.bind('s02-05')
    assert.equal(await errorOf(submit(late, 's01-01')), 'project_full')

    await as(t, 'select admin_remove_comment($1, $2)', [ids[0], 'off-topic'])
    assert.equal(await published('s01-01'), 3)
    await submit(late, 's01-01')
    assert.equal(await errorOf(as(t, 'select admin_restore_comment($1)', [ids[0]])), 'project_full')
    await as(t, 'select admin_remove_comment($1, $2)', [ids[1], 'duplicate'])
    await as(t, 'select admin_restore_comment($1)', [ids[0]])
    assert.equal(await published('s01-01'), 4)

    const [{ admin_overview: ov }] = await as(t, 'select admin_overview()') as Array<{ admin_overview: {
      settings: Row; students: Row[]; comments: Row[] } }>
    assert.equal(ov.students.length, STUDENTS.length)
    assert.equal(ov.students.find((s) => s.id === 's01-01')!.published_received, 4)
    assert.equal(ov.students.find((s) => s.id === 's02-01')!.written, 1)
    assert.equal(ov.comments.length, 5)
    assert.equal(ov.comments.find((c) => c.id === ids[1])!.status, 'removed')
    assert.equal(ov.comments.find((c) => c.id === ids[1])!.removed_reason, 'duplicate')
    assert.equal(ov.settings.max_comments_per_project, 4)

    assert.equal((await as(t, 'select * from get_comments($1)', ['s01-01'])).length, 4)
    await as(t, 'select admin_set_open(false)')
    assert.equal(await errorOf(submit(await db.bind('s02-06'), 's01-02')), 'closed')
    const log = await db.admin.query<{ action: string; actor: string }>(`select action, actor from audit_log order by id`)
    assert.deepEqual(log.rows.map((x) => x.action), ['remove_comment', 'remove_comment', 'restore_comment', 'set_open'])
    assert.ok(log.rows.every((x) => x.actor === INSTRUCTOR_EMAIL))
  })
})

test('no function ever returns an access-code hash', async () => {
  const hashes = (await db.admin.query<{ code_hash: string }>(`select code_hash from access_codes`)).rows.map((r) => r.code_hash.slice(7))
  const u = anonUser(randomUUID())
  const outputs: unknown[] = []
  outputs.push(await as(u, 'select * from redeem_access_code($1,$2)', ['s01-01', codeFor('s01-01')]))
  outputs.push(await as(u, 'select * from whoami()'))
  outputs.push(await submit(u, 's01-02'))
  outputs.push(await as(u, 'select * from my_reviews()'))
  outputs.push(await as(u, 'select * from get_comments($1)', ['s01-02']))
  outputs.push(await as(u, 'select * from recommend_project()'))
  outputs.push(await asAnon('select * from get_project_counts()'))
  outputs.push(await as(instructor(), 'select admin_overview()'))
  const text = JSON.stringify(outputs)
  assert.ok(!/\$2[aby]\$/.test(text), 'bcrypt prefix in output')
  for (const h of hashes) assert.ok(!text.includes(h), 'hash body in output')
  assert.ok(!text.includes('code_hash'))
  const sigs = await db.admin.query<{ n: string }>(
    `select count(*) n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='public' and (pg_get_function_result(p.oid) ilike '%code_hash%' or pg_get_function_result(p.oid) = 'access_codes')`)
  assert.equal(Number(sigs.rows[0].n), 0)
})

test('get_project_counts: active students only, published only', async () => {
  await db.addComment('s01-01', 's01-02')
  await db.addComment('s01-01', 's01-03', 'removed')
  await db.admin.query(`update students set active=false where id='s02-07'`)
  const counts = await asAnon('select * from get_project_counts()')
  assert.equal(counts.length, STUDENTS.length - 1)
  assert.equal(counts.find((c) => c.project_id === 's01-01')!.published, 1)
  assert.ok(!counts.some((c) => c.project_id === 's02-07'))
})

test('the migration can be run a second time without losing data', async () => {
  const c = await db.addComment('s01-01', 's01-02')
  const w = anonUser(randomUUID())
  for (let i = 0; i < 2; i++) await errorOf(as(w, 'select * from redeem_access_code($1,$2)', ['s01-05', 'WRONG-WRONG']))
  await db.admin.query(await readFile(MIGRATION, 'utf8'))
  assert.equal(Number((await db.admin.query<{ n: string }>(`select count(*) n from students`)).rows[0].n), STUDENTS.length)
  assert.equal((await db.admin.query(`select 1 from comments where id = $1`, [c])).rowCount, 1)
  const st = await db.admin.query<{ failed: number }>(`select failed from feedback_private.access_code_status where student_id='s01-05'`)
  assert.equal(st.rows[0].failed, 2, 'live failure counter survives a re-run')
  const u = anonUser(randomUUID())
  assert.equal((await as(u, 'select * from redeem_access_code($1,$2)', ['s01-06', codeFor('s01-06')]))[0].student_id, 's01-06')
  assert.match(await errorOf(asAnon('select * from comments')), /permission denied/)
})

test('scripts: build-live-sql + generate-access-codes output loads, codes redeem, --only rotates, codes never printed', async () => {
  const dir = path.join(ROOT, '.pg-test', `scripts-${process.pid}`)
  await mkdir(dir, { recursive: true })
  const mkStudent = (id: string, first: string, last: string, url: string | null, urlStatus: string) => ({
    id, section: id.slice(1, 3), sectionCode: `MKTG 2241-${id.slice(1, 3)}`, position: Number(id.slice(4)), firstName: first,
    lastName: last, fullName: `${first} ${last}`, url, urlStatus, urlNote: '', creatureId: 'x' })
  const roster = {
    schema: 'fairfield-roster', version: 1, source: { file: 'synthetic.xlsx', sheet: 'x', importedAt: '2026-11-19T00:00:00Z' },
    students: [mkStudent('s01-90', 'Zoë', "D'Arcy", 'https://example.org/a/', 'valid'),
      mkStudent('s02-91', 'Bob, Jr.', 'Smith "B"', null, 'missing'), mkStudent('s02-92', 'Ann', 'Lee', 'file:///x', 'invalid')],
    removed: [mkStudent('s01-07', 'Gone', 'Student', null, 'missing')],
  }
  const rosterPath = path.join(dir, 'roster.json')
  await writeFile(rosterPath, JSON.stringify(roster))
  const run = (script: string, args: string[]) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout + r.stderr
  }
  const ids = roster.students.map((s) => s.id)
  try {
    run('build-live-sql.ts', ['--roster', rosterPath, '--out', path.join(dir, 'roster_upsert.sql')])
    const out1 = run('generate-access-codes.ts', ['--roster', rosterPath, '--out-dir', dir])
    const sql = await readFile(path.join(dir, 'roster_upsert.sql'), 'utf8')
    await db.admin.query(sql)
    await db.admin.query(sql)   // idempotent
    await db.admin.query(await readFile(path.join(dir, 'access_codes_upsert.sql'), 'utf8'))
    const csvFiles = (await readdir(dir)).filter((f) => /^access_codes_\d{4}-\d{2}-\d{2}\.csv$/.test(f))
    assert.equal(csvFiles.length, 1)
    const rows = (await readFile(path.join(dir, csvFiles[0]), 'utf8')).replace(/^﻿/, '').trim().split('\r\n')
    assert.equal(rows[0], 'student_id,section,first,last,code')
    assert.equal(rows.length, 4)
    const codeOf = (csv: string[], id: string) => csv.find((l) => l.startsWith(`${id},`))!.split(',').at(-1)!
    for (const id of ids) {
      const code = codeOf(rows, id)
      assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/)
      assert.ok(!out1.includes(code), 'code printed to the terminal')
    }
    const st = await db.admin.query(`select id, full_name, url_status, active from students where id = any($1) or id = 's01-07' order by id`, [ids])
    assert.deepEqual(st.rows, [
      { id: 's01-07', full_name: "First017 O'Last7", url_status: 'valid', active: false },
      { id: 's01-90', full_name: "Zoë D'Arcy", url_status: 'valid', active: true },
      { id: 's02-91', full_name: 'Bob, Jr. Smith "B"', url_status: 'missing', active: true },
      { id: 's02-92', full_name: 'Ann Lee', url_status: 'invalid', active: true },
    ])
    const u = anonUser(randomUUID())
    const redeem = (code: string) => as(u, 'select * from redeem_access_code($1,$2)', ['s01-90', code])
    const first = codeOf(rows, 's01-90')
    assert.equal((await redeem(first))[0].full_name, "Zoë D'Arcy")

    // Rotate one student: new CSV (never overwriting the first), old code stops working.
    const out2 = run('generate-access-codes.ts', ['--roster', rosterPath, '--out-dir', dir, '--only', 's01-90'])
    await db.admin.query(await readFile(path.join(dir, 'access_codes_upsert.sql'), 'utf8'))
    const csv2 = (await readdir(dir)).filter((f) => /^access_codes_.*_2\.csv$/.test(f))
    assert.equal(csv2.length, 1)
    const rows2 = (await readFile(path.join(dir, csv2[0]), 'utf8')).replace(/^﻿/, '').trim().split('\r\n')
    assert.equal(rows2.length, 2)
    const second = codeOf(rows2, 's01-90')
    assert.ok(!out2.includes(second))
    assert.equal(await errorOf(redeem(first)), 'bad_code')
    assert.equal((await redeem(second))[0].student_id, 's01-90')
    assert.match((await readFile(path.join(dir, 'access_codes_upsert.sql'), 'utf8')), /\$2a\$10\$/)

    const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-access-codes.ts'), '--roster', path.join(dir, 'nope.json'), '--out-dir', dir], { encoding: 'utf8' })
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /Roster not found/)
  } finally {
    await db.admin.query(`delete from student_sessions where student_id = any($1)`, [ids])
    await db.admin.query(`delete from access_codes where student_id = any($1)`, [ids])
    await db.admin.query(`delete from students where id = any($1)`, [ids])
    await rm(dir, { recursive: true, force: true })
  }
})
