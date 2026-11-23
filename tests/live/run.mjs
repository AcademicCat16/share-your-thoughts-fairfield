/**
 * Live-mode end-to-end test: the production build in LIVE mode, talking to tests/live/stack.mjs (real migration SQL,
 * real roster, real access codes) from SEPARATE browsers — Chrome and Microsoft Edge, each with its own profile.
 *
 *   npm run test:live
 *
 * Proves: shared persistence between browsers, code-only sign-in, course boundaries and other rules enforced on the
 * server (direct API calls with a student's own token), atomic last-slot behaviour under simultaneous submissions from
 * two browsers, instructor magic-link + server-side instructor checks, plan generation, moderation and pause.
 * It does NOT prove a real Supabase project (see the header of stack.mjs).
 */
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { startStack } from './stack.mjs'

const OUT = 'tests/output/live'
mkdirSync(OUT, { recursive: true })
const PORT = 4313
const BASE = `http://localhost:${PORT}/share-your-thoughts-fairfield/`
const roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8')).students
const byId = (id) => roster.find((s) => s.id === id)

console.log('Starting the local Supabase stand-in (Postgres + RPC/auth server)…')
const stack = await startStack()
const results = []
let browsers = []
let preview
const cleanup = async () => { for (const b of browsers) await b.close().catch(() => {}); try { preview?.kill() } catch { /* ignore */ } await stack.stop() }

try {
  console.log('Building the site in LIVE mode (dist-live/)…')
  const env = { ...process.env, VITE_FEEDBACK_MODE: 'live', VITE_SUPABASE_URL: stack.url, VITE_SUPABASE_ANON_KEY: stack.anonKey }
  const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-live', '--emptyOutDir'], { env, encoding: 'utf8' })
  if (b.status !== 0) throw new Error(`live build failed\n${b.stdout}\n${b.stderr}`)
  preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-live', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)) }

  const chrome = await chromium.launch({ channel: process.env.LIVE_CHANNEL_A || 'chrome' })
  const edge = await chromium.launch({ channel: process.env.LIVE_CHANNEL_B || 'msedge' })
  browsers = [chrome, edge]
  const errors = []
  const open = async (browser, label) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
    return page
  }
  const test = async (name, fn) => {
    const t0 = Date.now()
    try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name} (${Date.now() - t0} ms)`) } catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✖ ${name}\n      ${String(e.message).split('\n')[0]}`) }
  }
  const assert = (c, m) => { if (!c) throw new Error(m) }
  const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
  const count = async (q, p) => Number((await stack.sql(q, p)).rows[0].n)
  const go = (p, hash) => p.goto(`${BASE}?view=2d${hash}`, { waitUntil: 'networkidle' })
  const shot = async (p, n) => { await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${n}.png` }) }
  /** Call an RPC from inside the page with that browser's own session token (what a curious student could do). */
  const rpcFromPage = (p, fn, args) => p.evaluate(async ({ url, key, fn, args }) => {
    const raw = localStorage.getItem('fic.live.auth'); const token = raw ? JSON.parse(raw).access_token : key
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, { url: stack.url, key: stack.anonKey, fn, args })
  const signIn = async (p, id) => {
    await p.click('[data-testid=header-signin]')
    await p.fill('[data-testid=signin-code]', stack.codes[id])
    await p.click('[data-testid=signin-submit]')
    await p.waitForSelector('[data-testid=me-chip]')
  }
  const writeReview = async (p, q1, q2, submit = true) => {
    await p.click('[data-testid=leave-thoughts]')
    await p.waitForSelector('[data-testid=feedback-form]')
    await p.fill('[data-testid=fb-q1]', q1); await p.fill('[data-testid=fb-q2]', q2)
    await p.click('[data-testid=fb-preview]'); await p.waitForSelector('[data-testid=preview]')
    if (submit) { await p.click('[data-testid=fb-submit]'); await p.waitForSelector('[data-testid=done]') }
  }
  const openDesk = async (p, id) => { await p.click(`[data-testid=desk-${id}]`); await p.waitForSelector('[data-testid=profile-modal]') }

  // ------------------------------------------------------------------------------------------------------------------
  const visitor = await open(chrome, 'visitor')
  await test('public visitor: Live mode (no demo banner), both classrooms load, numbers-only status, tables closed', async () => {
    await visitor.goto(BASE, { waitUntil: 'networkidle' })
    eq(await visitor.locator('[data-testid=demo-banner]').count(), 0, 'no demo banner in Live mode')
    await visitor.click('[data-testid=enter-1101]'); await visitor.waitForSelector('[data-testid=classroom-2d], [data-testid=classroom-3d]')
    const st = await rpcFromPage(visitor, 'get_public_status', {})
    eq(st.status, 200, 'get_public_status works for anon'); eq(st.body.length, 81, 'one row per eligible project')
    assert(Object.keys(st.body[0]).sort().join() === 'capacity,course,project_id,published', `numbers only: ${Object.keys(st.body[0])}`)
    for (const t of ['comments', 'students', 'access_codes', 'assignments']) {
      const r = await visitor.evaluate(async ({ url, key, t }) => (await fetch(`${url}/rest/v1/${t}`, { headers: { apikey: key, authorization: `Bearer ${key}` } })).status, { url: stack.url, key: stack.anonKey, t })
      eq(r, 401, `anon cannot read ${t}`)
    }
    const sub = await rpcFromPage(visitor, 'submit_comment', { p_project_id: 'pm-02', p_pronouns: '', p_enjoyed: 'x'.repeat(20), p_suggestion: 'y'.repeat(20) })
    eq(sub.status, 401, 'anon cannot call submit_comment')
  })

  const inst = await open(chrome, 'instructor')
  await test('instructor: non-instructor e-mail refused; real magic link (PKCE) → dashboard; plans saved and validated on the server', async () => {
    await go(inst, '#/instructor')
    await inst.waitForSelector('[data-testid=instructor-gate]')
    eq(await inst.locator('[data-testid=course-panel-2241]').count(), 0, 'dashboard hidden before sign-in')
    // a signed-in e-mail that is not on the instructor list
    await inst.fill('[data-testid=instructor-email]', 'not-an-instructor@example.edu'); await inst.click('[data-testid=instructor-send]')
    await inst.waitForSelector('[data-testid=instructor-msg]')
    let link = (await (await fetch(`${stack.url}/__test/mail?email=not-an-instructor@example.edu`)).json()).link
    await inst.goto(link, { waitUntil: 'networkidle' })
    await inst.waitForSelector('text=Not an instructor account')
    const denied = await rpcFromPage(inst, 'admin_overview', {})
    assert(denied.status >= 400 && /not_instructor/.test(denied.body.message), `server refuses admin_overview: ${JSON.stringify(denied.body)}`)
    await inst.click('text=Sign out'); await inst.waitForSelector('[data-testid=instructor-gate]')
    await inst.fill('[data-testid=instructor-email]', stack.instructorEmail); await inst.click('[data-testid=instructor-send]')
    await inst.waitForSelector('[data-testid=instructor-msg]')
    link = (await (await fetch(`${stack.url}/__test/mail?email=${stack.instructorEmail}`)).json()).link
    assert(link && link.includes('code='), 'magic link issued')
    await inst.goto(link, { waitUntil: 'networkidle' })
    await inst.waitForSelector('[data-testid=course-panel-2241]', { timeout: 20000 })
    for (const c of ['1101', '2241']) {
      await inst.click(`[data-testid=plan-replace-${c}]`); await inst.waitForSelector('[data-testid=plan-ok]')
      await inst.click('[data-testid=plan-apply]'); await inst.waitForSelector('[data-testid=plan-preview]', { state: 'detached' })
    }
    eq(await count(`select count(*) n from assignments where course='1101' and status='pending'`), 112, '1101 assignments in the database')
    eq(await count(`select count(*) n from assignments where course='2241' and status='pending'`), 232, '2241 assignments in the database')
    eq(await count(`select count(*) n from project_slots where capacity = 5`), 20, 'twenty fifth slots')
    eq(await count(`select count(*) n from assignments a join students r on r.id=a.reviewer_id join students p on p.id=a.project_id where r.course <> p.course or a.reviewer_id = a.project_id`), 0, 'no cross-course or self assignments')
    await shot(inst, 'instructor-live')
  })

  // Two students in two different browsers.
  const A = 's02-04' // Carys Browne (2241-02)
  const pa = await open(chrome, 'studentA')
  const pb = await open(edge, 'studentB')
  let reviewed = ''
  await test('student sign-in is code-only: a wrong code is refused; the right code identifies the student', async () => {
    await go(pa, '#/2241')
    await pa.click('[data-testid=header-signin]')
    await pa.fill('[data-testid=signin-code]', 'AAAA-BBBB-CCCC'); await pa.click('[data-testid=signin-submit]')
    await pa.waitForSelector('.signin [role=alert]')
    assert(/match/.test(await pa.textContent('.signin [role=alert]')), 'wrong code message')
    eq(await pa.locator('[data-testid=signin-who]').count(), 0, 'no name picker in Live mode')
    await pa.fill('[data-testid=signin-code]', stack.codes[A].toLowerCase().replace(/-/g, ' ')) // forgiving input
    await pa.click('[data-testid=signin-submit]'); await pa.waitForSelector('[data-testid=me-chip]')
    assert((await pa.textContent('[data-testid=me-chip]')).includes(byId(A).fullName), 'name comes from the server')
    eq((await pa.textContent('[data-testid=quest-progress]')).trim(), 'Your Feedback Quest: 0 / 4 completed', 'quest progress')
    eq(await pa.locator('.quest-list li').count(), 4, 'four assigned projects')
  })

  await test('Browser A (Chrome) submits; Browser B (Edge) sees the same review', async () => {
    await pa.click('[data-testid=find-next]'); await pa.waitForSelector('[data-testid=profile-modal]')
    const nameShown = (await pa.textContent('[data-testid=profile-name]')).trim()
    reviewed = roster.find((s) => s.fullName === nameShown).id
    await writeReview(pa, 'I loved the smooth animations and the playful colors.', 'Maybe add a short how-to-play guide on the first screen.')
    await pa.waitForSelector('text=Your Feedback Quest: 1 / 4 completed')
    await shot(pa, 'A-done')
    // Browser B: a different student, a different browser engine and profile.
    const B = (await stack.sql(`select id from students where course='2241' and id not in ($1, $2) and url_status='valid' order by id desc limit 1`, [A, reviewed])).rows[0].id
    await go(pb, '#/2241'); await signIn(pb, B)
    await openDesk(pb, reviewed)
    await pb.waitForSelector('[data-testid=comment]')
    const text = await pb.textContent('[data-testid=comment]')
    assert(text.includes(byId(A).fullName) && text.includes('smooth animations'), `B sees A's review: ${text}`)
    await shot(pb, 'B-sees-A')
  })

  await test('only the author can edit (UI and server); an edit does not use a slot', async () => {
    eq(await pb.locator('[data-testid=edit-comment]').count(), 0, 'no edit button for B')
    const id = (await stack.sql(`select id from comments where reviewer_id=$1 and project_id=$2`, [A, reviewed])).rows[0].id
    const r = await rpcFromPage(pb, 'update_comment', { p_comment_id: id, p_pronouns: '', p_enjoyed: 'Hijacked text that is long enough.', p_suggestion: 'Hijacked suggestion that is long.' })
    assert(/not_author/.test(r.body?.message ?? ''), `server refuses: ${JSON.stringify(r.body)}`)
    await pa.click('text=See the comments'); await pa.click('[data-testid=edit-comment]'); await pa.waitForSelector('[data-testid=feedback-form]')
    await pa.fill('[data-testid=fb-q1]', 'I loved the smooth animations and the cozy soundtrack.')
    await pa.click('[data-testid=fb-preview]'); await pa.click('[data-testid=fb-submit]'); await pa.waitForSelector('[data-testid=done]')
    eq(await count(`select count(*) n from comments where reviewer_id=$1`, [A]), 1, 'still one comment')
    await pb.keyboard.press('Escape'); await openDesk(pb, reviewed)
    await pb.waitForSelector('text=cozy soundtrack')
  })

  await test('course boundary enforced on the server: a 1101 student cannot review 2241 (but can explore it)', async () => {
    const C = 'pm-05'
    const pc = await open(chrome, 'student1101')
    await go(pc, '#/2241'); await signIn(pc, C)
    await openDesk(pc, reviewed)
    assert(await pc.isDisabled('[data-testid=leave-thoughts]'), 'button disabled')
    await pc.waitForSelector('text=only projects in your own course')
    assert(await pc.isEnabled('[data-testid=explore-link]'), 'still explorable')
    const r = await rpcFromPage(pc, 'submit_comment', { p_project_id: reviewed, p_pronouns: '', p_enjoyed: 'Trying to sneak a review in.', p_suggestion: 'This should be refused by the server.' })
    assert(/wrong_course/.test(r.body?.message ?? ''), `server: ${JSON.stringify(r.body)}`)
    const self = await rpcFromPage(pc, 'submit_comment', { p_project_id: C, p_pronouns: '', p_enjoyed: 'Reviewing my own project now.', p_suggestion: 'This should be refused by the server.' })
    assert(/self_review/.test(self.body?.message ?? ''), `self: ${JSON.stringify(self.body)}`)
    const notAssigned = (await stack.sql(`select id from students s where course='1101' and id<>$1 and not exists (select 1 from assignments a where a.reviewer_id=$1 and a.project_id=s.id) order by id limit 1`, [C])).rows[0].id
    const na = await rpcFromPage(pc, 'submit_comment', { p_project_id: notAssigned, p_pronouns: '', p_enjoyed: 'Reviewing something not assigned.', p_suggestion: 'This should be refused by the server.' })
    assert(/not_assigned/.test(na.body?.message ?? ''), `not assigned: ${JSON.stringify(na.body)}`)
    await pc.context().close()
  })

  await test('last free slot: two browsers press Send at the same moment → exactly one succeeds', async () => {
    // Setup (as the database owner): project P has one free extra slot; X and Y finished their four; extras allowed.
    const P = (await stack.sql(`select id from students where course='2241' and url_status='valid' and link_status='working' and id not in ($1,$2) order by id limit 1 offset 3`, [A, reviewed])).rows[0].id
    const [X, Y] = (await stack.sql(`select id from students where course='2241' and id not in ($1,$2,$3) order by id limit 2 offset 10`, [A, reviewed, P])).rows.map((r) => r.id)
    await stack.sql(`update assignments set status='released' where project_id=$1 and status='pending'`, [P])
    await stack.sql(`update project_slots set capacity=4 where project_id=$1`, [P])
    const fillers = (await stack.sql(`select id, full_name from students where course='2241' and id not in ($1,$2,$3) order by id desc limit 3`, [P, X, Y])).rows
    for (const f of fillers) await stack.sql(`insert into comments (course, project_id, reviewer_id, reviewer_name, enjoyed, suggestion) values ('2241',$1,$2,$3,'Setup comment that is long enough.','Setup suggestion that is long enough.')`, [P, f.id, f.full_name])
    for (const r of [X, Y]) {
      const mine = (await stack.sql(`select project_id from assignments where reviewer_id=$1 and status='pending'`, [r])).rows
      const name = (await stack.sql(`select full_name from students where id=$1`, [r])).rows[0].full_name
      for (const m of mine) {
        if (m.project_id === P) continue
        const c = await stack.sql(`insert into comments (course, project_id, reviewer_id, reviewer_name, enjoyed, suggestion) values ('2241',$1,$2,$3,'Setup comment that is long enough.','Setup suggestion that is long enough.') returning id`, [m.project_id, r, name])
        await stack.sql(`update assignments set status='completed', comment_id=$3 where reviewer_id=$1 and project_id=$2`, [r, m.project_id, c.rows[0].id])
      }
      await stack.sql(`update assignments set status='released' where reviewer_id=$1 and status='pending'`, [r])
      const n = await count(`select count(*) n from comments where reviewer_id=$1 and status='published'`, [r])
      for (let i = n; i < 4; i++) {
        const other = (await stack.sql(`select id from students s where course='2241' and url_status='valid' and link_status='working' and id not in ($1,$2) and not exists (select 1 from comments c where c.reviewer_id=$1 and c.project_id=s.id) order by id desc limit 1`, [r, P])).rows[0].id
        await stack.sql(`insert into comments (course, project_id, reviewer_id, reviewer_name, enjoyed, suggestion, extra) values ('2241',$1,$2,$3,'Setup comment that is long enough.','Setup suggestion that is long enough.', true)`, [other, r, name])
      }
    }
    await stack.sql(`update settings set allow_extra_reviews = true where id = 1`)
    eq(await count(`select count(*) n from comments where project_id=$1 and status='published'`, [P]), 3, 'three published before the race')
    const px = await open(chrome, 'X'); const py = await open(edge, 'Y')
    for (const [p, id] of [[px, X], [py, Y]]) { await go(p, '#/2241'); await signIn(p, id); await openDesk(p, P); await writeReview(p, `Racing for the last slot, I enjoyed it a lot (${id}).`, 'Please add one more level to explore next.', false) }
    await Promise.all([px.click('[data-testid=fb-submit]'), py.click('[data-testid=fb-submit]')])
    const outcome = async (p) => Promise.race([p.waitForSelector('[data-testid=done]').then(() => 'done'), p.waitForSelector('[data-testid=form-error], [data-testid=full-message]').then(() => 'refused')])
    const [ox, oy] = await Promise.all([outcome(px), outcome(py)])
    eq([ox, oy].filter((o) => o === 'done').length, 1, `exactly one success (got ${ox}/${oy})`)
    eq(await count(`select count(*) n from comments where project_id=$1 and status='published'`, [P]), 4, 'capacity never exceeded')
    // The loser sees the full-project message and can still explore.
    const loser = ox === 'done' ? py : px
    await loser.keyboard.press('Escape').catch(() => {}); await openDesk(loser, P)
    await loser.waitForSelector('[data-testid=full-message]')
    assert((await loser.textContent('[data-testid=full-message]')).includes('All comment slots are full!'), 'full message')
    assert(await loser.isEnabled('[data-testid=explore-link]'), 'full project still explorable')
    assert(await loser.isDisabled('[data-testid=leave-thoughts]'), 'Leave Your Thoughts disabled')
    await shot(loser, 'full-project')
    await stack.sql(`update settings set allow_extra_reviews = false where id = 1`)
    await px.context().close(); await py.context().close()
  })

  await test('instructor moderation removes a comment for everyone; pause blocks students with "closed"', async () => {
    await inst.reload({ waitUntil: 'networkidle' }); await inst.waitForSelector('[data-testid=mod-item]')
    inst.once('dialog', (d) => d.accept('Test removal'))
    const item = inst.locator('[data-testid=mod-item]', { hasText: 'cozy soundtrack' })
    await item.locator('[data-testid=mod-remove]').click()
    await inst.waitForSelector('text=Comment removed')
    await pb.keyboard.press('Escape'); await pb.reload({ waitUntil: 'networkidle' }); await openDesk(pb, reviewed)
    await pb.waitForTimeout(800)
    eq(await pb.locator('text=cozy soundtrack').count(), 0, 'removed comment gone in Browser B')
    await inst.click('[data-testid=toggle-open]'); await inst.waitForSelector('text=Feedback paused')
    const r = await rpcFromPage(pb, 'submit_comment', { p_project_id: reviewed, p_pronouns: '', p_enjoyed: 'Trying while feedback is paused.', p_suggestion: 'This should be refused by the server.' })
    assert(/closed/.test(r.body?.message ?? ''), `paused: ${JSON.stringify(r.body)}`)
    await inst.click('[data-testid=toggle-open]'); await inst.waitForSelector('text=Feedback reopened')
  })

  await test('no page errors in any browser', async () => { eq(errors.length, 0, `page errors: ${errors.join(' | ')}`) })
} catch (e) {
  console.error('Live test setup failed:', e)
  results.push({ name: 'setup', ok: false, err: e.message })
} finally {
  await cleanup()
}
const failed = results.filter((r) => !r.ok)
console.log(`\nLive-mode browser tests: ${results.length - failed.length} / ${results.length} passed.`)
process.exitCode = failed.length ? 1 : 0
