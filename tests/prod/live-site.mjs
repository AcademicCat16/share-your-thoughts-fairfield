/**
 * PRODUCTION two-browser verification against the REAL Supabase project (honor-system model, migration 002).
 *
 *   node tests/prod/live-site.mjs            → the deployed public site
 *   node tests/prod/live-site.mjs --local    → this working copy, built in Live mode against production and served on
 *                                              localhost (verifies the new frontend BEFORE deploying it)
 *
 * Needs `supabase login` + `supabase link`. Chrome = student A, Microsoft Edge = student B (separate browsers).
 * WRITES TO PRODUCTION (operator approval required): opens feedback only for the test and ALWAYS pauses it again; in
 * `finally` deletes every comment / write event / source event the test created, resets those assignments to pending
 * and restores the project's capacity. The instructor's real password is never used: only refusals are tested here.
 */
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { sql, publishableKey } from './cli.mjs'

const REF = 'amtzwcanjylvrmqroeku'
const URL_ = `https://${REF}.supabase.co`
const INSTRUCTOR = 'ywon@fairfield.edu'
const LOCAL = process.argv.includes('--local')
const PORT = 4314
const BASE = LOCAL ? `http://localhost:${PORT}/share-your-thoughts-fairfield/` : 'https://academiccat16.github.io/share-your-thoughts-fairfield/'
const OUT = `tests/output/prod${LOCAL ? '-local' : ''}`
mkdirSync(OUT, { recursive: true })

const roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8')).students
const byId = (id) => roster.find((s) => s.id === id)
const KEY = publishableKey(REF)

// Test cast from the real plan: P = a 1101 project and its four assigned reviewers.
const P = sql(`select project_id from public.assignments where course='1101' and status='pending' group by project_id having count(*) = 4 order by project_id limit 1`)[0].project_id
const [A, B, X, Y] = sql(`select reviewer_id from public.assignments where project_id='${P}' and status='pending' order by reviewer_id`).map((r) => r.reviewer_id)
const S2241 = sql(`select id from public.students where course='2241' and active and url_status='valid' and link_status='working' order by id limit 2`).map((r) => r.id)
const notAssignedToB = sql(`select id from public.students s where course='1101' and id<>'${B}' and s.url_status='valid' and s.link_status='working'
  and not exists (select 1 from public.assignments a where a.reviewer_id='${B}' and a.project_id=s.id) order by id limit 1`)[0].id
const TEST = [A, B, X, Y]
const START = sql('select now()::text as t')[0].t
console.log(`Production test (${LOCAL ? 'local build → real database' : 'deployed site'}): project ${P} (${byId(P).fullName}); A=${A} B=${B} X=${X} Y=${Y}. Start ${START}`)

const results = []
const errors = []
let browsers = []
let preview
const test = async (name, fn) => {
  const t0 = Date.now()
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name} (${Date.now() - t0} ms)`) } catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✖ ${name}\n      ${String(e.message).split('\n')[0]}`) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const go = (p, hash) => p.goto(`${BASE}?view=2d&v=${Date.now()}${hash}`, { waitUntil: 'networkidle' })
const shot = async (p, n) => { await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${n}.png` }) }
const rpc = (p, fn, args) => p.evaluate(async ({ url, key, fn, args }) => {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify(args) })
  return { status: r.status, body: await r.json().catch(() => null) }
}, { url: URL_, key: KEY, fn, args })
const msg = (r) => `${r.status} ${r.body?.message ?? JSON.stringify(r.body)}`
const openDesk = async (p, id) => { await p.click(`[data-testid=desk-${id}]`); await p.waitForSelector('[data-testid=profile-modal]') }
const back = (p) => p.click('[data-testid=profile-modal] .back')
const writeAs = async (p, reviewerId, q1, q2, submit = true) => {
  await p.click('[data-testid=leave-thoughts]')
  await p.waitForSelector('[data-testid=feedback-form]')
  await p.selectOption('[data-testid=fb-who]', reviewerId)
  await p.fill('[data-testid=fb-q1]', q1); await p.fill('[data-testid=fb-q2]', q2)
  await p.click('[data-testid=fb-preview]'); await p.waitForSelector('[data-testid=preview]')
  if (submit) { await p.click('[data-testid=fb-submit]'); await p.waitForSelector('[data-testid=done]', { timeout: 30000 }) }
}
const published = (pid) => Number(sql(`select count(*) n from public.comments where project_id='${pid}' and status='published'`)[0].n)

try {
  if (LOCAL) {
    const env = { ...process.env, VITE_FEEDBACK_MODE: 'live', VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: KEY }
    const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-prodcheck', '--emptyOutDir'], { env, encoding: 'utf8' })
    if (b.status !== 0) throw new Error(`build failed\n${b.stdout}\n${b.stderr}`)
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-prodcheck', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)) }
  }
  sql(`update public.settings set feedback_open = true where id = 1`, { write: true })
  const chrome = await chromium.launch({ channel: 'chrome' })
  const edge = await chromium.launch({ channel: 'msedge' })
  browsers = [chrome, edge]
  const open = async (browser, label) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
    ctx.setDefaultTimeout(20000)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
    return page
  }

  const visitor = await open(chrome, 'visitor')
  await test('public visitor: Live mode, numbers-only status, every table closed, no instructor function for anonymous callers', async () => {
    await visitor.goto(`${BASE}?v=${Date.now()}`, { waitUntil: 'networkidle' })
    eq(await visitor.locator('[data-testid=demo-banner]').count(), 0, 'no demo banner (Live build)')
    const st = await rpc(visitor, 'get_public_status', {})
    eq(st.status, 200, 'get_public_status'); eq(st.body.length, 81, 'one row per reviewable project')
    for (const t of ['comments', 'students', 'access_codes', 'assignments', 'instructors', 'settings', 'source_events']) {
      const r = await visitor.evaluate(async ({ url, key, t }) => (await fetch(`${url}/rest/v1/${t}?select=*`, { headers: { apikey: key } })).status, { url: URL_, key: KEY, t })
      assert(r === 401 || r === 403 || r === 404, `anon must not read ${t}: HTTP ${r}`)
    }
    for (const [fn, args] of [['admin_overview', {}], ['admin_set_open', { p_open: true }], ['admin_remove_comment', { p_comment_id: '00000000-0000-0000-0000-000000000000', p_reason: 'x' }], ['admin_apply_assignments', { p_course: '1101', p_capacities: {}, p_assignments: [] }]]) {
      const r = await rpc(visitor, fn, args)
      assert(r.status === 401 || r.status === 403 || r.status === 404, `anon ${fn} must be refused: ${msg(r)}`)
    }
  })

  await test('instructor sign-in is e-mail + password on the real auth server; a wrong password is refused and the dashboard stays locked; sign-ups closed', async () => {
    const inst = await open(chrome, 'instructor')
    await go(inst, '#/instructor')
    await inst.waitForSelector('[data-testid=instructor-gate]')
    eq(await inst.locator('[data-testid=instructor-password]').count(), 1, 'password field (no e-mail link)')
    await inst.fill('[data-testid=instructor-email]', INSTRUCTOR); await inst.fill('[data-testid=instructor-password]', `wrong-${Date.now()}-password`)
    await inst.click('[data-testid=instructor-send]'); await inst.waitForSelector('[data-testid=instructor-msg]')
    assert(/not correct/.test(await inst.textContent('[data-testid=instructor-msg]')), `wrong password message: ${await inst.textContent('[data-testid=instructor-msg]')}`)
    eq(await inst.locator('[data-testid=course-panel-2241]').count(), 0, 'dashboard still locked')
    const signup = await inst.evaluate(async ({ url, key }) => (await fetch(`${url}/auth/v1/signup`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: `probe-${Date.now()}@example.com`, password: 'Probe-password-123456' }) })).status, { url: URL_, key: KEY })
    assert(signup >= 400, `new sign-ups are closed (HTTP ${signup})`)
    const anonSignin = await inst.evaluate(async ({ url, key }) => (await fetch(`${url}/auth/v1/signup`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: '{}' })).status, { url: URL_, key: KEY })
    assert(anonSignin >= 400, `anonymous sign-ins are off (HTTP ${anonSignin})`)
    await shot(inst, 'instructor-gate'); await inst.context().close()
  })

  const pa = await open(chrome, 'A')
  const pb = await open(edge, 'B')
  await test('name-dropdown submission (Chrome): no account; pick own name; compliment + suggestion → stored under that name', async () => {
    await go(pa, '#/1101'); await openDesk(pa, P)
    await pa.click('[data-testid=leave-thoughts]'); await pa.waitForSelector('[data-testid=feedback-form]')
    const opts = await pa.$$eval('[data-testid=fb-who] option', (os) => os.map((o) => o.value).filter(Boolean))
    eq(opts.length, 27, 'all MKTG 1101 classmates except the owner'); assert(!opts.includes(P), 'owner left out')
    await back(pa)
    await writeAs(pa, A, 'I loved how clearly the homepage explains the idea and the bright friendly colors.', 'Maybe add a short guide on the first screen so new visitors know where to click.')
    await pa.waitForSelector('[data-testid=me-chip]')
    eq(sql(`select reviewer_id from public.comments where project_id='${P}' and created_at >= '${START}'`)[0]?.reviewer_id, A, 'stored under the selected name')
    await shot(pa, 'A-done')
  })

  await test('shared persistence: Browser B (Edge, no name chosen) sees A\'s review; duplicate name disabled + refused by the server', async () => {
    await go(pb, '#/1101'); await openDesk(pb, P)
    await pb.waitForSelector('[data-testid=comment]')
    const t = await pb.textContent('[data-testid=comment]')
    assert(t.includes(byId(A).fullName) && t.includes('bright friendly colors'), `B sees A's review: ${t}`)
    eq(await pb.locator('[data-testid=edit-comment]').count(), 0, 'no edit button for B')
    await pb.click('[data-testid=leave-thoughts]'); await pb.waitForSelector('[data-testid=feedback-form]')
    assert(await pb.$eval(`[data-testid=fb-who] option[value="${A}"]`, (o) => o.disabled), "A's name disabled in B's dropdown")
    await back(pb)
    const dup = await rpc(pb, 'submit_feedback', { p_reviewer_id: A, p_project_id: P, p_pronouns: '', p_enjoyed: 'Trying to post the same name twice.', p_suggestion: 'This must be refused by the server.' })
    assert(dup.status >= 400 && /already_reviewed|rate_limited/.test(dup.body?.message ?? ''), `duplicate refused: ${msg(dup)}`)
    await shot(pb, 'B-sees-A')
  })

  await test('edit token: A edits from the same browser (no slot used); B cannot', async () => {
    const id = sql(`select id from public.comments where reviewer_id='${A}' and project_id='${P}'`)[0].id
    const r = await rpc(pb, 'edit_feedback', { p_comment_id: id, p_edit_token: 'f'.repeat(64), p_pronouns: '', p_enjoyed: 'Hijacked text that is long enough to pass.', p_suggestion: 'Hijacked suggestion that is long enough.' })
    assert(/not_author/.test(r.body?.message ?? ''), `server refuses B: ${msg(r)}`)
    await pa.waitForTimeout(16000) // one write per name every 15 s
    await pa.click('text=See the comments'); await pa.click('[data-testid=edit-comment]'); await pa.waitForSelector('[data-testid=feedback-form]')
    await pa.fill('[data-testid=fb-q1]', 'I loved how clearly the homepage explains the idea and the cozy soundtrack.')
    await pa.click('[data-testid=fb-preview]'); await pa.click('[data-testid=fb-submit]'); await pa.waitForSelector('[data-testid=done]', { timeout: 30000 })
    eq(published(P), 1, 'still one comment on the project')
    await pb.keyboard.press('Escape'); await openDesk(pb, P); await pb.waitForSelector('text=cozy soundtrack')
  })

  await test('self-review, course (both ways) and unassigned project refused for the selected name (server); other course explorable', async () => {
    const self = await rpc(pb, 'submit_feedback', { p_reviewer_id: P, p_project_id: P, p_pronouns: '', p_enjoyed: 'Reviewing my own project right now.', p_suggestion: 'This must be refused by the server.' })
    assert(/self_review/.test(self.body?.message ?? ''), `self: ${msg(self)}`)
    const w1 = await rpc(pb, 'submit_feedback', { p_reviewer_id: B, p_project_id: S2241[0], p_pronouns: '', p_enjoyed: 'Trying to review the other course.', p_suggestion: 'This must be refused by the server.' })
    assert(/wrong_course/.test(w1.body?.message ?? ''), `1101 → 2241: ${msg(w1)}`)
    const w2 = await rpc(pb, 'submit_feedback', { p_reviewer_id: S2241[1], p_project_id: P, p_pronouns: '', p_enjoyed: 'Trying to review the other course.', p_suggestion: 'This must be refused by the server.' })
    assert(/wrong_course/.test(w2.body?.message ?? ''), `2241 → 1101: ${msg(w2)}`)
    const na = await rpc(pb, 'submit_feedback', { p_reviewer_id: B, p_project_id: notAssignedToB, p_pronouns: '', p_enjoyed: 'Reviewing a project I was not given.', p_suggestion: 'This must be refused by the server.' })
    assert(/not_assigned/.test(na.body?.message ?? ''), `unassigned: ${msg(na)}`)
    await pb.keyboard.press('Escape'); await go(pb, '#/2241'); await openDesk(pb, S2241[0])
    await pb.click('[data-testid=leave-thoughts]'); await pb.waitForSelector('[data-testid=feedback-form]')
    const opts = await pb.$$eval('[data-testid=fb-who] option', (os) => os.map((o) => o.value).filter(Boolean))
    assert(opts.length > 0 && opts.every((id) => /^s0[12]-/.test(id)), 'a 2241 project lists only MKTG 2241 names')
    await back(pb)
    assert(await pb.isEnabled('[data-testid=explore-link]'), 'explorable')
  })

  await test('final slot: two browsers press Send at the same moment → exactly one succeeds; full project stays explorable', async () => {
    await pb.keyboard.press('Escape').catch(() => {})
    await go(pb, '#/1101'); await openDesk(pb, P)
    await writeAs(pb, B, 'I really enjoyed the clean layout and the way each section flows into the next.', 'One idea: add a short video or animation that shows the product in action.')
    eq(published(P), 2, 'two published before the race')
    sql(`update public.project_slots set capacity = 3, updated_at = now() where project_id = '${P}'`, { write: true }) // fixture: one free slot
    const px = await open(chrome, 'X'); const py = await open(edge, 'Y')
    for (const [p, id] of [[px, X], [py, Y]]) { await go(p, '#/1101'); await openDesk(p, P); await writeAs(p, id, `Racing for the last slot, I enjoyed the friendly design a lot (${id}).`, 'Please add one more example page so visitors can explore further.', false) }
    await Promise.all([px.click('[data-testid=fb-submit]'), py.click('[data-testid=fb-submit]')])
    const outcome = (p) => Promise.race([p.waitForSelector('[data-testid=done]', { timeout: 30000 }).then(() => 'done'), p.waitForSelector('[data-testid=form-error], [data-testid=full-message]', { timeout: 30000 }).then(() => 'refused')])
    const [ox, oy] = await Promise.all([outcome(px), outcome(py)])
    eq([ox, oy].filter((o) => o === 'done').length, 1, `exactly one success (got ${ox}/${oy})`)
    eq(published(P), 3, 'capacity never exceeded')
    const loser = ox === 'done' ? py : px
    await loser.keyboard.press('Escape').catch(() => {}); await openDesk(loser, P)
    await loser.waitForSelector('[data-testid=full-message]')
    assert((await loser.textContent('[data-testid=full-message]')).includes('All comment slots are full!'), 'full message')
    assert(await loser.isEnabled('[data-testid=explore-link]'), 'full project still explorable')
    assert(await loser.isDisabled('[data-testid=leave-thoughts]'), 'Leave Your Thoughts disabled')
    await shot(loser, 'full-project')
    const over = sql(`select s.id from public.students s left join public.project_slots ps on ps.project_id = s.id
      where (select count(*) from public.comments c where c.project_id = s.id and c.status='published') > coalesce(ps.capacity, (select base_slots from public.settings where id=1))`)
    eq(over.length, 0, 'no project anywhere over capacity')
    await px.context().close(); await py.context().close()
  })

  await test('pause: with feedback paused the server refuses writes with "closed"', async () => {
    sql(`update public.settings set feedback_open = false where id = 1`, { write: true })
    const next = sql(`select project_id from public.assignments where reviewer_id='${X}' and status='pending' order by project_id limit 1`)[0].project_id
    const r = await rpc(pa, 'submit_feedback', { p_reviewer_id: X, p_project_id: next, p_pronouns: '', p_enjoyed: 'Trying while feedback is paused.', p_suggestion: 'This must be refused by the server.' })
    assert(/closed/.test(r.body?.message ?? ''), `paused: ${msg(r)}`)
  })

  await test('no page errors in any browser', async () => { eq(errors.length, 0, `page errors: ${errors.join(' | ')}`) })
} catch (e) {
  console.error('Production test setup failed:', e.message)
  results.push({ name: 'setup', ok: false, err: e.message })
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  try { preview?.kill() } catch { /* ignore */ }
  const list = TEST.map((x) => `'${x}'`).join(',')
  try {
    sql(`begin;
      update public.settings set feedback_open = false, allow_extra_reviews = false where id = 1;
      update public.assignments set status = 'pending', comment_id = null, updated_at = now() where reviewer_id in (${list}) and status = 'completed';
      delete from public.comments where reviewer_id in (${list}) and created_at >= '${START}';
      delete from public.write_events where student_id in (${list}) and at >= '${START}';
      delete from public.source_events where at >= '${START}';
      update public.project_slots set capacity = 4, updated_at = now() where project_id = '${P}';
      commit;`, { write: true })
    console.log('Cleanup: test comments and rate-limit events removed; assignments pending again; capacity restored; feedback PAUSED.')
  } catch (e) { console.error('CLEANUP FAILED — check the database:', e.message); process.exitCode = 1 }
}
const failed = results.filter((r) => !r.ok)
console.log(`\nProduction two-browser tests: ${results.length - failed.length} / ${results.length} passed.`)
if (failed.length) process.exitCode = 1
