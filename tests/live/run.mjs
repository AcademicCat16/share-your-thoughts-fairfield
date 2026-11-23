/**
 * Live-mode end-to-end test: the production build in LIVE mode, talking to tests/live/stack.mjs (all migrations, real
 * roster) from SEPARATE browsers — Chrome and Microsoft Edge, each with its own profile.
 *
 *   npm run test:live
 *
 * Proves (honor-system model, migration 002): name-dropdown submissions with no account; shared persistence between
 * browsers; duplicate / self / course rules for the SELECTED name (UI and server); edit tokens; simultaneous
 * final-slot submissions; instructor e-mail + PASSWORD sign-in; refusal of wrong passwords, non-instructor accounts and
 * anonymous callers; moderation and pause. It does NOT prove a real Supabase project (see the header of stack.mjs).
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
  const pages = []
  let failN = 0
  const open = async (browser, label) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
    const page = await ctx.newPage()
    pages.push([label, page])
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
    return page
  }
  const test = async (name, fn) => {
    const t0 = Date.now()
    try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name} (${Date.now() - t0} ms)`) } catch (e) {
      results.push({ name, ok: false, err: e.message }); console.log(`  ✖ ${name}\n      ${String(e.message).split('\n')[0]}`)
      failN++; for (const [label, pg] of pages) await pg.screenshot({ path: `${OUT}/fail-${failN}-${label}.png` }).catch(() => {})
    }
  }
  const assert = (c, m) => { if (!c) throw new Error(m) }
  const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
  const count = async (q, p) => Number((await stack.sql(q, p)).rows[0].n)
  const go = (p, hash) => p.goto(`${BASE}?view=2d${hash}`, { waitUntil: 'networkidle' })
  const shot = async (p, n) => { await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${n}.png` }) }
  /** Call an RPC from inside the page: anonymous (publishable key only), or with the page's instructor session. */
  const rpcFromPage = (p, fn, args) => p.evaluate(async ({ url, key, fn, args }) => {
    const raw = sessionStorage.getItem('fic.live.instructor'); const token = raw ? JSON.parse(raw).access_token : key
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, { url: stack.url, key: stack.anonKey, fn, args })
  const msg = (r) => `${r.status} ${r.body?.message ?? JSON.stringify(r.body)}`
  const openDesk = async (p, id) => { await p.click(`[data-testid=desk-${id}]`); await p.waitForSelector('[data-testid=profile-modal]') }
  /** The student flow from the brief: open → Leave Your Thoughts → pick own name → compliment → suggestion → send. */
  const writeAs = async (p, reviewerId, q1, q2, submit = true) => {
    await p.click('[data-testid=leave-thoughts]')
    await p.waitForSelector('[data-testid=feedback-form]')
    await p.selectOption('[data-testid=fb-who]', reviewerId)
    await p.fill('[data-testid=fb-q1]', q1); await p.fill('[data-testid=fb-q2]', q2)
    await p.click('[data-testid=fb-preview]'); await p.waitForSelector('[data-testid=preview]')
    if (submit) { await p.click('[data-testid=fb-submit]'); await p.waitForSelector('[data-testid=done]') }
  }
  const pendingOf = async (r) => (await stack.sql(`select project_id from assignments where reviewer_id=$1 and status='pending' order by project_id`, [r])).rows.map((x) => x.project_id)
  const reviewersOf = async (pid) => (await stack.sql(`select reviewer_id from assignments where project_id=$1 and status='pending' order by reviewer_id`, [pid])).rows.map((x) => x.reviewer_id)

  // ------------------------------------------------------------------------------------------------------------------
  const visitor = await open(chrome, 'visitor')
  await test('public visitor: Live mode, numbers-only status, every table closed, anonymous caller cannot use instructor functions', async () => {
    await visitor.goto(BASE, { waitUntil: 'networkidle' })
    eq(await visitor.locator('[data-testid=demo-banner]').count(), 0, 'no demo banner in Live mode')
    await visitor.click('[data-testid=enter-1101]'); await visitor.waitForSelector('[data-testid=classroom-2d], [data-testid=classroom-3d]')
    const st = await rpcFromPage(visitor, 'get_public_status', {})
    eq(st.status, 200, 'get_public_status works for anon'); eq(st.body.length, 81, 'one row per eligible project')
    for (const t of ['comments', 'students', 'access_codes', 'assignments', 'source_events', 'instructors']) {
      const r = await visitor.evaluate(async ({ url, key, t }) => (await fetch(`${url}/rest/v1/${t}`, { headers: { apikey: key, authorization: `Bearer ${key}` } })).status, { url: stack.url, key: stack.anonKey, t })
      eq(r, 401, `anon cannot read ${t}`)
    }
    for (const [fn, args] of [['admin_overview', {}], ['admin_set_open', { p_open: true }], ['admin_apply_assignments', { p_course: '1101', p_capacities: {}, p_assignments: [] }], ['admin_remove_comment', { p_comment_id: '00000000-0000-0000-0000-000000000000', p_reason: 'x' }]]) {
      const r = await rpcFromPage(visitor, fn, args)
      assert(r.status === 401 || r.status === 403, `anon ${fn} refused: ${msg(r)}`)
    }
  })

  const inst = await open(chrome, 'instructor')
  await test('instructor password sign-in: wrong password refused; a real non-instructor account refused (UI + server); right password → dashboard; plans saved', async () => {
    await go(inst, '#/instructor')
    await inst.waitForSelector('[data-testid=instructor-gate]')
    eq(await inst.locator('[data-testid=instructor-password]').count(), 1, 'password field (no magic link)')
    eq(await inst.locator('[data-testid=course-panel-2241]').count(), 0, 'dashboard hidden before sign-in')
    await inst.fill('[data-testid=instructor-email]', stack.instructorEmail); await inst.fill('[data-testid=instructor-password]', 'definitely-the-wrong-password')
    await inst.click('[data-testid=instructor-send]'); await inst.waitForSelector('[data-testid=instructor-msg]')
    assert(/not correct/.test(await inst.textContent('[data-testid=instructor-msg]')), 'wrong password message')
    eq(await inst.locator('[data-testid=course-panel-2241]').count(), 0, 'still locked')
    // a real account that is not on the instructor list
    await inst.fill('[data-testid=instructor-email]', stack.otherAccount.email); await inst.fill('[data-testid=instructor-password]', stack.otherAccount.password)
    await inst.click('[data-testid=instructor-send]'); await inst.waitForSelector('[data-testid=instructor-msg]')
    assert(/not an instructor/.test(await inst.textContent('[data-testid=instructor-msg]')), 'non-instructor refused in the UI')
    // and the server refuses that account even when it calls the functions directly
    const tok = await inst.evaluate(async ({ url, key, e, pw }) => { const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: pw }) }); return (await r.json()).access_token }, { url: stack.url, key: stack.anonKey, e: stack.otherAccount.email, pw: stack.otherAccount.password })
    const denied = await inst.evaluate(async ({ url, key, tok }) => { const r = await fetch(`${url}/rest/v1/rpc/admin_set_open`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: '{"p_open":true}' }); return { status: r.status, body: await r.json() } }, { url: stack.url, key: stack.anonKey, tok })
    assert(denied.status >= 400 && /not_instructor/.test(denied.body.message), `server refuses non-instructor: ${JSON.stringify(denied.body)}`)
    // the instructor
    await inst.fill('[data-testid=instructor-email]', stack.instructorEmail); await inst.fill('[data-testid=instructor-password]', stack.instructorPassword)
    await inst.click('[data-testid=instructor-send]')
    await inst.waitForSelector('[data-testid=course-panel-2241]', { timeout: 20000 })
    const stores = await inst.evaluate(() => ({ local: JSON.stringify({ ...localStorage }), session: JSON.stringify({ ...sessionStorage }) }))
    assert(!stores.local.includes(stack.instructorPassword) && !stores.session.includes(stack.instructorPassword), 'the password is stored nowhere in the browser')
    assert(!stores.local.includes('access_token'), 'no instructor session in localStorage (sessionStorage only)')
    for (const c of ['1101', '2241']) {
      await inst.click(`[data-testid=plan-replace-${c}]`); await inst.waitForSelector('[data-testid=plan-ok]')
      await inst.click('[data-testid=plan-apply]'); await inst.waitForSelector('[data-testid=plan-preview]', { state: 'detached' })
    }
    eq(await count(`select count(*) n from assignments where course='1101' and status='pending'`), 112, '1101 assignments in the database')
    eq(await count(`select count(*) n from assignments where course='2241' and status='pending'`), 232, '2241 assignments in the database')
    eq(await count(`select count(*) n from project_slots where capacity = 5`), 20, 'twenty fifth slots')
    await shot(inst, 'instructor-live')
  })

  await test('instructor can change the password while signed in (Supabase checks it; never stored by the app)', async () => {
    const next = `New-${Math.random().toString(36).slice(2)}-${Date.now()}`
    await inst.click('[data-testid=pw-open]'); await inst.fill('[data-testid=pw-new]', 'short'); await inst.fill('[data-testid=pw-repeat]', 'short'); await inst.click('[data-testid=pw-save]')
    assert(/12 characters/.test(await inst.textContent('[data-testid=pw-msg]')), 'too short refused')
    await inst.fill('[data-testid=pw-new]', next); await inst.fill('[data-testid=pw-repeat]', next); await inst.click('[data-testid=pw-save]')
    await inst.waitForSelector('text=Password changed.')
    const ok = await inst.evaluate(async ({ url, key, e, pw }) => (await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: pw }) })).status, { url: stack.url, key: stack.anonKey, e: stack.instructorEmail, pw: next })
    eq(ok, 200, 'the new password works')
  })

  // Students: two browsers, no accounts.
  const P = (await stack.sql(`select project_id from assignments where course='1101' and status='pending' group by project_id having count(*) = 4 order by project_id limit 1`)).rows[0].project_id
  const [A, B, X, Y] = await reviewersOf(P)
  const pa = await open(chrome, 'studentA')
  const pb = await open(edge, 'studentB')
  await test('name-dropdown submission (Chrome): no account, pick own name, compliment + suggestion → stored under that name and remembered', async () => {
    await go(pa, '#/1101')
    eq(await pa.locator('[data-testid=me-chip]').count(), 0, 'no name chosen yet')
    await openDesk(pa, P)
    const opts = await (async () => { await pa.click('[data-testid=leave-thoughts]'); await pa.waitForSelector('[data-testid=feedback-form]'); return pa.$$eval('[data-testid=fb-who] option', (os) => os.map((o) => o.value).filter(Boolean)) })()
    eq(opts.length, 27, 'all MKTG 1101 classmates except the owner'); assert(!opts.includes(P), 'owner left out (no self-review)')
    await pa.click('[data-testid=profile-modal] .back')
    await writeAs(pa, A, 'I loved the smooth animations and the playful colors.', 'Maybe add a short how-to-play guide on the first screen.')
    await pa.waitForSelector('[data-testid=me-chip]')
    assert((await pa.textContent('[data-testid=me-chip]')).includes(byId(A).fullName), 'name remembered on this device')
    eq((await stack.sql(`select reviewer_id, reviewer_name from comments where project_id=$1`, [P])).rows[0].reviewer_id, A, 'stored under the selected name')
    eq(stack.requests.filter((r) => r.includes('/auth/v1/signup')).length, 0, 'no anonymous accounts were created')
    await shot(pa, 'A-done')
  })

  await test('shared persistence: Browser B (Edge, no name chosen) sees A\'s review; A\'s name is disabled in B\'s dropdown; server refuses the duplicate', async () => {
    await go(pb, '#/1101'); await openDesk(pb, P)
    await pb.waitForSelector('[data-testid=comment]')
    const t = await pb.textContent('[data-testid=comment]')
    assert(t.includes(byId(A).fullName) && t.includes('smooth animations'), `B sees A's review: ${t}`)
    eq(await pb.locator('[data-testid=edit-comment]').count(), 0, 'B has no edit button')
    await pb.click('[data-testid=leave-thoughts]'); await pb.waitForSelector('[data-testid=feedback-form]')
    assert(await pb.$eval(`[data-testid=fb-who] option[value="${A}"]`, (o) => o.disabled), "A's name disabled (already reviewed)")
    await pb.click('[data-testid=profile-modal] .back')
    const dup = await rpcFromPage(pb, 'submit_feedback', { p_reviewer_id: A, p_project_id: P, p_pronouns: '', p_enjoyed: 'Trying to post the same name twice.', p_suggestion: 'This must be refused by the server.' })
    assert(/already_reviewed/.test(dup.body?.message ?? ''), `duplicate: ${msg(dup)}`)
    await shot(pb, 'B-sees-A')
  })

  await test('edit token: A edits from the same browser without using a slot; B cannot (UI + server)', async () => {
    const id = (await stack.sql(`select id from comments where reviewer_id=$1 and project_id=$2`, [A, P])).rows[0].id
    const r = await rpcFromPage(pb, 'edit_feedback', { p_comment_id: id, p_edit_token: 'f'.repeat(64), p_pronouns: '', p_enjoyed: 'Hijacked text that is long enough.', p_suggestion: 'Hijacked suggestion that is long.' })
    assert(/not_author/.test(r.body?.message ?? ''), `server refuses B: ${msg(r)}`)
    await pa.click('text=See the comments'); await pa.click('[data-testid=edit-comment]'); await pa.waitForSelector('[data-testid=feedback-form]')
    await pa.fill('[data-testid=fb-q1]', 'I loved the smooth animations and the cozy soundtrack.')
    await pa.click('[data-testid=fb-preview]'); await pa.click('[data-testid=fb-submit]'); await pa.waitForSelector('[data-testid=done]')
    eq(await count(`select count(*) n from comments where project_id=$1 and status='published'`, [P]), 1, 'still one comment on the project')
    await pb.keyboard.press('Escape'); await openDesk(pb, P)
    await pb.waitForSelector('text=cozy soundtrack')
  })

  await test('self-review and course rules for the selected name (UI + server)', async () => {
    const self = await rpcFromPage(pb, 'submit_feedback', { p_reviewer_id: P, p_project_id: P, p_pronouns: '', p_enjoyed: 'Reviewing my own project right now.', p_suggestion: 'This must be refused by the server.' })
    assert(/self_review/.test(self.body?.message ?? ''), `self: ${msg(self)}`)
    const p2241 = roster.find((s) => s.course === '2241' && s.link?.status === 'working' && !s.hidden)?.id ?? (await stack.sql(`select id from students where course='2241' and link_status='working' order by id limit 1`)).rows[0].id
    const wc = await rpcFromPage(pb, 'submit_feedback', { p_reviewer_id: B, p_project_id: p2241, p_pronouns: '', p_enjoyed: 'Trying to review the other course.', p_suggestion: 'This must be refused by the server.' })
    assert(/wrong_course/.test(wc.body?.message ?? ''), `1101 → 2241: ${msg(wc)}`)
    const s2241 = (await stack.sql(`select id from students where course='2241' and id <> $1 order by id limit 1`, [p2241])).rows[0].id
    const wc2 = await rpcFromPage(pb, 'submit_feedback', { p_reviewer_id: s2241, p_project_id: P, p_pronouns: '', p_enjoyed: 'Trying to review the other course.', p_suggestion: 'This must be refused by the server.' })
    assert(/wrong_course/.test(wc2.body?.message ?? ''), `2241 → 1101: ${msg(wc2)}`)
    await pb.keyboard.press('Escape'); await go(pb, '#/2241'); await openDesk(pb, p2241)
    await pb.click('[data-testid=leave-thoughts]'); await pb.waitForSelector('[data-testid=feedback-form]')
    const opts = await pb.$$eval('[data-testid=fb-who] option', (os) => os.map((o) => o.value).filter(Boolean))
    assert(opts.length > 0 && opts.every((id) => id.startsWith('s0')), '2241 project: only MKTG 2241 names in the dropdown')
    await pb.click('[data-testid=profile-modal] .back')
    assert(await pb.isEnabled('[data-testid=explore-link]'), 'other course still explorable')
    const notMine = (await stack.sql(`select id from students s where course='1101' and id <> $1 and link_status='working' and not exists (select 1 from assignments a where a.reviewer_id=$1 and a.project_id=s.id) order by id limit 1`, [B])).rows[0].id
    const na = await rpcFromPage(pb, 'submit_feedback', { p_reviewer_id: B, p_project_id: notMine, p_pronouns: '', p_enjoyed: 'Reviewing something not assigned.', p_suggestion: 'This must be refused by the server.' })
    assert(/not_assigned/.test(na.body?.message ?? ''), `not assigned: ${msg(na)}`)
  })

  await test('final slot: two browsers press Send at the same moment → exactly one succeeds; full project stays explorable', async () => {
    await stack.sql(`update project_slots set capacity = 2 where project_id = $1`, [P]) // one published (A) + ONE free slot
    const px = await open(chrome, 'X'); const py = await open(edge, 'Y')
    for (const [p, id] of [[px, X], [py, Y]]) { await go(p, '#/1101'); await openDesk(p, P); await writeAs(p, id, `Racing for the last slot, I enjoyed it a lot (${id}).`, 'Please add one more level to explore next.', false) }
    await Promise.all([px.click('[data-testid=fb-submit]'), py.click('[data-testid=fb-submit]')])
    const outcome = async (p) => Promise.race([p.waitForSelector('[data-testid=done]').then(() => 'done'), p.waitForSelector('[data-testid=form-error], [data-testid=full-message]').then(() => 'refused')])
    const [ox, oy] = await Promise.all([outcome(px), outcome(py)])
    eq([ox, oy].filter((o) => o === 'done').length, 1, `exactly one success (got ${ox}/${oy})`)
    eq(await count(`select count(*) n from comments where project_id=$1 and status='published'`, [P]), 2, 'capacity never exceeded')
    const loser = ox === 'done' ? py : px
    await loser.keyboard.press('Escape').catch(() => {}); await openDesk(loser, P)
    await loser.waitForSelector('[data-testid=full-message]')
    assert((await loser.textContent('[data-testid=full-message]')).includes('All comment slots are full!'), 'full message')
    assert(await loser.isEnabled('[data-testid=explore-link]'), 'full project still explorable')
    assert(await loser.isDisabled('[data-testid=leave-thoughts]'), 'Leave Your Thoughts disabled')
    await shot(loser, 'full-project')
    await stack.sql(`update project_slots set capacity = 4 where project_id = $1`, [P])
    await px.context().close(); await py.context().close()
  })

  await test('instructor moderation removes a comment for everyone (slot freed); pause refuses writes with "closed"', async () => {
    await inst.reload({ waitUntil: 'networkidle' }); await inst.waitForSelector('[data-testid=mod-item]')
    inst.once('dialog', (d) => d.accept('Test removal'))
    await inst.locator('[data-testid=mod-item]', { hasText: 'cozy soundtrack' }).locator('[data-testid=mod-remove]').click()
    await inst.waitForSelector('text=Comment removed')
    await pb.goto(`${BASE}?view=2d#/1101`, { waitUntil: 'networkidle' }); await openDesk(pb, P)
    await pb.waitForTimeout(800)
    eq(await pb.locator('text=cozy soundtrack').count(), 0, 'removed comment gone in Browser B')
    await inst.click('[data-testid=toggle-open]'); await inst.waitForSelector('text=Feedback paused')
    const nextB = (await pendingOf(B))[0]
    const r = await rpcFromPage(pb, 'submit_feedback', { p_reviewer_id: B, p_project_id: nextB, p_pronouns: '', p_enjoyed: 'Trying while feedback is paused.', p_suggestion: 'This must be refused by the server.' })
    assert(/closed/.test(r.body?.message ?? ''), `paused: ${msg(r)}`)
    await inst.click('[data-testid=toggle-open]'); await inst.waitForSelector('text=Feedback reopened')
    await inst.click('[data-testid=instructor-signout]'); await inst.waitForSelector('[data-testid=instructor-gate]')
    const after = await rpcFromPage(inst, 'admin_overview', {})
    assert(after.status === 401 || after.status === 403, `signed out → refused: ${msg(after)}`)
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
