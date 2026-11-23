/**
 * Migration 002 — HONOR-SYSTEM feedback (no codes, no student accounts), against the embedded Postgres harness.
 * Every call here is made as the ANONYMOUS API role, the way the public website calls it.
 * Proves the server rules for the SELECTED name; it does not (and cannot) prove who is really typing.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { TestDb, runAs, runAnonFrom, errorOf, emailUser, anonUser, INSTRUCTOR_EMAIL, type PgClient } from './harness.ts'

const db = new TestDb()
before(async () => { await db.start() }, { timeout: 240_000 })
after(async () => { await db.stop() }, { timeout: 60_000 })
beforeEach(async () => { await db.reset() })

type Row = Record<string, unknown>
const ENJOY = 'I loved the glowing lanterns in the forest.'
const SUGGEST = 'Maybe add a short guide at the entrance.'
const SUBMIT = 'select * from submit_feedback($1, $2, $3, $4, $5)'
const EDIT = 'select * from edit_feedback($1, $2, $3, $4, $5)'
let ipN = 0
const freshIp = () => `198.51.100.${(++ipN % 250) + 1}`
const anonOn = (c: PgClient, sql: string, params: unknown[] = [], ip = freshIp()) => runAnonFrom<Row>(c, ip, sql, params)
const anon = (sql: string, params: unknown[] = [], ip = freshIp()) => anonOn(db.admin, sql, params, ip)
const submitAs = (reviewer: string, project: string, ip?: string, enjoyed = ENJOY, suggestion = SUGGEST) => anon(SUBMIT, [reviewer, project, '', enjoyed, suggestion], ip)
const count = async (sql: string, params: unknown[] = []) => Number((await db.admin.query<{ n: string }>(sql, params)).rows[0].n)
const setSetting = (k: string, v: number | boolean) => db.admin.query(`update settings set ${k} = $1 where id = 1`, [v])
const messages = (rs: PromiseSettledResult<unknown>[]) => rs.flatMap((r) => (r.status === 'rejected' ? [(r.reason as Error).message] : []))

describe('name-dropdown submissions (anonymous, selected name)', () => {
  test('an assigned student submits under their selected name: comment stored with the ROSTER name, assignment completed, edit token returned once', async () => {
    await db.assign('pm-02', 'pm-01')
    const [r] = await submitAs('pm-02', 'pm-01')
    assert.equal(r.reviewer_id, 'pm-02')
    assert.equal(r.reviewer_name, (await db.admin.query<{ full_name: string }>(`select full_name from students where id='pm-02'`)).rows[0].full_name)
    assert.match(String(r.edit_token), /^[0-9a-f]{64}$/)
    assert.equal(await db.assignmentStatus('pm-02', 'pm-01'), 'completed')
    const stored = (await db.admin.query<{ edit_token_hash: string }>(`select edit_token_hash from comments where id=$1`, [r.id])).rows[0].edit_token_hash
    assert.match(stored, /^[0-9a-f]{64}$/); assert.notEqual(stored, r.edit_token, 'only the hash is stored')
    // Shared persistence: any visitor (another browser) reads it through the public function.
    const seen = await anon('select * from get_project_comments($1)', ['pm-01'])
    assert.equal(seen.length, 1); assert.equal(seen[0].enjoyed, ENJOY); assert.equal('edit_token_hash' in seen[0], false)
    const q = await anon('select * from get_student_quest($1)', ['pm-02'])
    assert.deepEqual(q.map((x) => [x.project_id, x.status]), [['pm-01', 'completed']])
  })

  test('unknown, hidden or inactive names are refused (unknown_reviewer)', async () => {
    await db.assign('pm-02', 'pm-01')
    assert.equal(await errorOf(submitAs('nobody-99', 'pm-01')), 'unknown_reviewer')
    await db.admin.query(`update students set hidden = true where id = 'pm-02'`)
    assert.equal(await errorOf(submitAs('pm-02', 'pm-01')), 'unknown_reviewer')
    await db.admin.query(`update students set hidden = false, active = false where id = 'pm-02'`)
    assert.equal(await errorOf(submitAs('pm-02', 'pm-01')), 'unknown_reviewer')
    assert.equal(await count('select count(*) n from comments'), 0)
  })

  test('closed (paused) refuses submissions and edits', async () => {
    await db.assign('pm-02', 'pm-01')
    const [r] = await submitAs('pm-02', 'pm-01')
    await setSetting('feedback_open', false)
    await db.assign('pm-03', 'pm-01')
    assert.equal(await errorOf(submitAs('pm-03', 'pm-01')), 'closed')
    assert.equal(await errorOf(anon(EDIT, [r.id, r.edit_token, '', ENJOY + ' Edited.', SUGGEST])), 'closed')
  })

  test('text rules still apply (too short / blocked words)', async () => {
    await db.assign('pm-02', 'pm-01')
    assert.equal(await errorOf(submitAs('pm-02', 'pm-01', undefined, 'short', SUGGEST)), 'invalid_text')
    assert.equal(await count('select count(*) n from comments'), 0)
  })
})

describe('duplicate, self and course rules (for the SELECTED name)', () => {
  test('duplicate review under the same selected name is refused (already_reviewed), even from another device', async () => {
    await db.assign('pm-02', 'pm-01')
    await submitAs('pm-02', 'pm-01', '203.0.113.7')
    assert.equal(await errorOf(submitAs('pm-02', 'pm-01', '203.0.113.8')), 'already_reviewed')
    assert.equal(await db.published('pm-01'), 1)
  })

  test('self-review under the selected name is refused (self_review)', async () => {
    assert.equal(await errorOf(submitAs('pm-01', 'pm-01')), 'self_review')
  })

  test('cross-course review under the selected name is refused both ways (wrong_course)', async () => {
    assert.equal(await errorOf(submitAs('pm-02', 's01-01')), 'wrong_course')
    assert.equal(await errorOf(submitAs('s01-02', 'pm-01')), 'wrong_course')
  })

  test('a project that is not on the selected name\'s list is refused (not_assigned); missing/broken projects are unavailable', async () => {
    assert.equal(await errorOf(submitAs('pm-02', 'pm-03')), 'not_assigned')
    assert.equal(await errorOf(submitAs('s01-02', 's01-05')), 'project_unavailable')
    assert.equal(await errorOf(submitAs('s01-02', 's02-05')), 'project_unavailable')
  })

  test('full project: project_full; capacity counts only published comments', async () => {
    for (const r of ['pm-02', 'pm-03', 'pm-04', 'pm-05']) await db.completed(r, 'pm-01')
    await db.addStudent('pm-07', '1101', 'pm'); await db.assign('pm-07', 'pm-01')
    assert.equal(await errorOf(submitAs('pm-07', 'pm-01')), 'project_full')
  })
})

describe('editing (edit token = the browser that wrote it)', () => {
  test('the right token edits without using a slot; a wrong or missing token is refused (not_author)', async () => {
    await db.assign('pm-02', 'pm-01')
    const [r] = await submitAs('pm-02', 'pm-01')
    assert.equal(await errorOf(anon(EDIT, [r.id, 'f'.repeat(64), '', 'Someone else trying to edit this.', SUGGEST])), 'not_author')
    assert.equal(await errorOf(anon(EDIT, [r.id, '', '', 'Someone else trying to edit this.', SUGGEST])), 'not_author')
    const [e] = await anon(EDIT, [r.id, r.edit_token, '', 'I loved the glowing lanterns and the music.', SUGGEST])
    assert.equal(e.enjoyed, 'I loved the glowing lanterns and the music.')
    assert.equal(await db.published('pm-01'), 1)
    assert.equal(await count(`select count(*) n from comments where reviewer_id='pm-02'`), 1)
  })

  test('a comment removed by the instructor can no longer be edited (not_found)', async () => {
    await db.assign('pm-02', 'pm-01')
    const [r] = await submitAs('pm-02', 'pm-01')
    await db.admin.query(`update comments set status = 'removed' where id = $1`, [r.id])
    assert.equal(await errorOf(anon(EDIT, [r.id, r.edit_token, '', 'Trying to edit a removed one.', SUGGEST])), 'not_found')
  })
})

describe('concurrency: final slot', () => {
  test('six assigned names press Send at the same moment for a project with ONE free slot → exactly one succeeds', async () => {
    const P = 'pm-01'
    for (const r of ['pm-02', 'pm-03', 'pm-04']) await db.completed(r, P)
    const names = ['pm-05', 'pm-06', 'pm-07', 'pm-08', 'pm-09', 'pm-10']
    for (const id of names.slice(1)) if (id !== 'pm-06') await db.addStudent(id, '1101', 'pm')
    for (const r of names) await db.assign(r, P)
    await db.setCapacity(P, 4)
    const clients = await Promise.all(names.map(() => db.connect()))
    const locker = await db.connect()
    await locker.query('begin'); await locker.query(`select 1 from students where id = $1 for update`, [P])
    const settled = Promise.allSettled(names.map((r, i) => anonOn(clients[i], SUBMIT, [r, P, '', ENJOY, SUGGEST])))
    let waited = 0
    for (const deadline = Date.now() + 15_000; Date.now() < deadline;) {
      waited = await count(`select count(*) n from pg_stat_activity where wait_event_type = 'Lock' and query like '%submit_feedback%' and pid <> pg_backend_pid()`)
      if (waited >= names.length) break
      await new Promise((r) => setTimeout(r, 25))
    }
    await locker.query('commit')
    const results = await settled
    await db.disconnect([...clients, locker])
    assert.equal(waited, names.length, 'all six were queued on the lock at the same time')
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.deepEqual(messages(results).sort(), Array(5).fill('project_full'))
    assert.equal(await db.published(P), 4)
    assert.equal(await count(`select count(*) n from students s where _published(s.id) > _capacity(s.id)`), 0)
  })
})

describe('abuse limits', () => {
  test('per selected name: one write per min_seconds_between_writes and max_writes_per_hour', async () => {
    await db.reset({ min_seconds_between_writes: 15 })
    await db.assign('pm-02', 'pm-01'); await db.assign('pm-02', 'pm-03')
    await submitAs('pm-02', 'pm-01')
    assert.equal(await errorOf(submitAs('pm-02', 'pm-03')), 'rate_limited', 'second write within 15 s under the same name')
  })

  test('per device/network: max_anon_writes_per_source_hour (other sources unaffected)', async () => {
    await db.reset({ max_anon_writes_per_source_hour: 2 })
    for (const r of ['pm-02', 'pm-03', 'pm-04']) await db.assign(r, 'pm-01')
    const ip = '192.0.2.10'
    await submitAs('pm-02', 'pm-01', ip); await submitAs('pm-03', 'pm-01', ip)
    assert.equal(await errorOf(submitAs('pm-04', 'pm-01', ip)), 'rate_limited')
    await submitAs('pm-04', 'pm-01', '192.0.2.11')
    const src = (await db.admin.query<{ source_hash: string }>(`select distinct source_hash from source_events`)).rows.map((x) => x.source_hash)
    assert.equal(src.length, 2); for (const h of src) assert.match(h, /^[0-9a-f]{64}$/, 'only hashes of addresses are stored')
    assert.equal(await count(`select count(*) n from source_events where source_hash like '%192.0.2%'`), 0)
  })

  test('whole site: max_anon_writes_global_hour', async () => {
    await db.reset({ max_anon_writes_global_hour: 2 })
    for (const r of ['pm-02', 'pm-03', 'pm-04']) await db.assign(r, 'pm-01')
    await submitAs('pm-02', 'pm-01'); await submitAs('pm-03', 'pm-01')
    assert.equal(await errorOf(submitAs('pm-04', 'pm-01')), 'rate_limited')
  })
})

describe('no administrative or private access through the anonymous endpoints', () => {
  test('anon cannot read or write any table, including source_events and the edit-token hashes', async () => {
    for (const t of ['comments', 'students', 'assignments', 'access_codes', 'source_events', 'instructors', 'settings', 'write_events']) {
      assert.match(await errorOf(anon(`select * from public.${t}`)), /permission denied/, t)
    }
    assert.match(await errorOf(anon(`insert into public.source_events (source_hash, kind) values ('x','y')`)), /permission denied/)
  })

  test('anon cannot call any instructor function or internal helper', async () => {
    for (const sql of ['select admin_overview()', `select * from admin_apply_assignments('1101','{}','[]')`, 'select admin_set_open(true)',
      `select admin_remove_comment(gen_random_uuid(), 'x')`, `select admin_set_participating('pm-01', false)`, 'select admin_set_allow_extra(true)',
      'select _request_source()', `select _check_source_rate('x')`, `select _check_rate('pm-01')`, `select _lock_pair('a','b')`]) {
      assert.match(await errorOf(anon(sql)), /permission denied for function/, sql)
    }
  })

  test('a signed-in non-instructor account is refused by every instructor function (not_instructor)', async () => {
    const other = emailUser('someone@example.edu')
    for (const sql of ['select admin_overview()', 'select admin_set_open(true)', `select * from admin_apply_assignments('1101','{}','[]')`]) {
      assert.match(await errorOf(runAs(db.admin, 'authenticated', other, sql)), /not_instructor/, sql)
    }
    // An anonymous session that carries the instructor's e-mail is refused too.
    assert.match(await errorOf(runAs(db.admin, 'authenticated', { ...anonUser(crypto.randomUUID()), email: INSTRUCTOR_EMAIL }, 'select admin_overview()')), /not_instructor/)
    // The real instructor (password sign-in gives a non-anonymous JWT with the e-mail) is allowed.
    const ok = await runAs(db.admin, 'authenticated', emailUser(INSTRUCTOR_EMAIL), 'select is_instructor() v')
    assert.deepEqual(ok, [{ v: true }])
  })

  test('re-running migration 002 keeps data and grants', async () => {
    await db.assign('pm-02', 'pm-01')
    const [r] = await submitAs('pm-02', 'pm-01')
    const { readFile } = await import('node:fs/promises')
    const { MIGRATIONS } = await import('./harness.ts')
    const m2 = MIGRATIONS.find((f) => /002_/.test(f))!
    await db.admin.query(await readFile(m2, 'utf8'))
    await db.admin.query(await readFile(m2, 'utf8'))
    assert.equal(await db.published('pm-01'), 1)
    const [e] = await anon(EDIT, [r.id, r.edit_token, '', 'Still editable after re-running 002.', SUGGEST])
    assert.equal(e.enjoyed, 'Still editable after re-running 002.')
  })
})
