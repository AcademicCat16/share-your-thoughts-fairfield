/**
 * PRODUCTION two-browser verification of the DEPLOYED site against the REAL Supabase project.
 *
 *   node tests/prod/live-site.mjs        (needs: `supabase login` + `supabase link`, private/access_codes_*.csv)
 *
 * Chrome = student A, Microsoft Edge = student B (separate browsers, separate anonymous sessions).
 * Uses a few real student codes from the private CSV (never printed). Opens feedback ONLY for the test and ALWAYS
 * pauses it again; in `finally` it deletes every comment / session / attempt the test created, restores the project's
 * capacity and the assignment statuses, and removes the anonymous auth users created during the test.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { sql, publishableKey } from './cli.mjs'

const REF = 'amtzwcanjylvrmqroeku'
const URL_ = `https://${REF}.supabase.co`
const BASE = process.env.PROD_BASE || 'https://academiccat16.github.io/share-your-thoughts-fairfield/'
const OUT = 'tests/output/prod'
mkdirSync(OUT, { recursive: true })

const roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8')).students
const byId = (id) => roster.find((s) => s.id === id)
const csvName = readdirSync('private').filter((f) => /^access_codes_\d{4}-\d{2}-\d{2}\.csv$/.test(f)).sort().pop()
const codes = Object.fromEntries(readFileSync(`private/${csvName}`, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(','); return [c[0], c[c.length - 1]] }))
const KEY = publishableKey(REF)

// Test cast, chosen from the real assignment plan: P = a 1101 project and its four assigned reviewers.
const P = sql(`select project_id from public.assignments where course='1101' and status='pending' group by project_id having count(*) = 4 order by project_id limit 1`)[0].project_id
const [A, B, X, Y] = sql(`select reviewer_id from public.assignments where project_id='${P}' and status='pending' order by reviewer_id`).map((r) => r.reviewer_id)
const C = sql(`select id from public.students where course='2241' and active order by id limit 1`)[0].id
const notAssignedToA = sql(`select id from public.students s where course='1101' and id<>'${A}' and s.url_status='valid' and s.link_status='working'
  and not exists (select 1 from public.assignments a where a.reviewer_id='${A}' and a.project_id=s.id) order by id limit 1`)[0].id
const other2241 = sql(`select id from public.students where course='2241' and url_status='valid' and link_status='working' order by id limit 1`)[0].id
const TEST = [A, B, X, Y, C]
for (const id of TEST) if (!codes[id]) throw new Error(`no code for ${id} in the private CSV`)
const START = sql('select now()::text as t')[0].t
console.log(`Production test: project ${P} (${byId(P).fullName}); A=${A} B=${B} X=${X} Y=${Y} (1101), C=${C} (2241). Start ${START}`)

const results = []
const errors = []
let browsers = []
const test = async (name, fn) => {
  const t0 = Date.now()
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name} (${Date.now() - t0} ms)`) } catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✖ ${name}\n      ${String(e.message).split('\n')[0]}`) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const go = (p, hash) => p.goto(`${BASE}?view=2d${hash}`, { waitUntil: 'networkidle' })
const shot = async (p, n) => { await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${n}.png` }) }
const rpcFromPage = (p, fn, args) => p.evaluate(async ({ url, key, fn, args }) => {
  const raw = localStorage.getItem('fic.live.auth'); const token = raw ? JSON.parse(raw).access_token : key
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) })
  return { status: r.status, body: await r.json().catch(() => null) }
}, { url: URL_, key: KEY, fn, args })
const msg = (r) => `${r.status} ${r.body?.message ?? JSON.stringify(r.body)}`
const signIn = async (p, id) => {
  await p.click('[data-testid=header-signin]')
  await p.fill('[data-testid=signin-code]', codes[id])
  await p.click('[data-testid=signin-submit]')
  await p.waitForSelector('[data-testid=me-chip]', { timeout: 30000 })
}
const writeReview = async (p, q1, q2, submit = true) => {
  await p.click('[data-testid=leave-thoughts]')
  await p.waitForSelector('[data-testid=feedback-form]')
  await p.fill('[data-testid=fb-q1]', q1); await p.fill('[data-testid=fb-q2]', q2)
  await p.click('[data-testid=fb-preview]'); await p.waitForSelector('[data-testid=preview]')
  if (submit) { await p.click('[data-testid=fb-submit]'); await p.waitForSelector('[data-testid=done]', { timeout: 30000 }) }
}
const openDesk = async (p, id) => { await p.click(`[data-testid=desk-${id}]`); await p.waitForSelector('[data-testid=profile-modal]') }
const published = (pid) => Number(sql(`select count(*) n from public.comments where project_id='${pid}' and status='published'`)[0].n)

try {
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
  await test('public visitor on the deployed site: Live mode, numbers-only status, every table closed, anon cannot submit', async () => {
    await visitor.goto(`${BASE}?v=${Date.now()}`, { waitUntil: 'networkidle' })
    eq(await visitor.locator('[data-testid=demo-banner]').count(), 0, 'no demo banner (Live build deployed)')
    await visitor.click('[data-testid=enter-1101]'); await visitor.waitForSelector('[data-testid=classroom-2d], [data-testid=classroom-3d]')
    const st = await rpcFromPage(visitor, 'get_public_status', {})
    eq(st.status, 200, 'get_public_status'); eq(st.body.length, 81, 'one row per reviewable project')
    eq(Object.keys(st.body[0]).sort().join(), 'capacity,course,project_id,published', 'numbers only')
    for (const t of ['comments', 'students', 'access_codes', 'assignments', 'instructors', 'settings']) {
      const r = await visitor.evaluate(async ({ url, key, t }) => { const x = await fetch(`${url}/rest/v1/${t}?select=*`, { headers: { apikey: key } }); return { s: x.status, b: await x.text() } }, { url: URL_, key: KEY, t })
      assert(r.s === 401 || r.s === 403 || r.s === 404, `anon must not read ${t}: HTTP ${r.s} ${r.b.slice(0, 120)}`)
    }
    const sub = await rpcFromPage(visitor, 'submit_comment', { p_project_id: P, p_pronouns: '', p_enjoyed: 'x'.repeat(30), p_suggestion: 'y'.repeat(30) })
    assert(sub.status === 401 || sub.status === 403 || sub.status === 404, `anon cannot call submit_comment: ${msg(sub)}`)
  })

  const pa = await open(chrome, 'A')
  const pb = await open(edge, 'B')
  await test('code-only sign-in on the real auth server: wrong code refused; right code (typed loosely) identifies the student', async () => {
    await go(pa, '#/1101')
    await pa.click('[data-testid=header-signin]')
    await pa.fill('[data-testid=signin-code]', 'AAAA-BBBB-CCCC'); await pa.click('[data-testid=signin-submit]')
    await pa.waitForSelector('.signin [role=alert]')
    assert(/match/.test(await pa.textContent('.signin [role=alert]')), 'wrong-code message')
    eq(await pa.locator('[data-testid=signin-who]').count(), 0, 'no name picker')
    await pa.fill('[data-testid=signin-code]', codes[A].toLowerCase().replace(/-/g, ' '))
    await pa.click('[data-testid=signin-submit]'); await pa.waitForSelector('[data-testid=me-chip]', { timeout: 30000 })
    assert((await pa.textContent('[data-testid=me-chip]')).includes(byId(A).fullName), 'name comes from the server')
    eq((await pa.textContent('[data-testid=quest-progress]')).trim(), 'Your Feedback Quest: 0 / 4 completed', 'quest progress')
    await pa.waitForFunction(() => document.querySelectorAll('.quest-list li').length === 4, null, { timeout: 20000 }).catch(() => {}) // my_quest arrives after sign-in
    eq(await pa.locator('.quest-list li').count(), 4, 'four assigned projects')
  })

  await test('Browser A (Chrome) submits; Browser B (Edge, another student) sees the same review', async () => {
    await pa.keyboard.press('Escape').catch(() => {})
    await openDesk(pa, P)
    await writeReview(pa, 'I loved how clearly the homepage explains the idea and the bright friendly colors.', 'Maybe add a short guide on the first screen so new visitors know where to click.')
    await pa.waitForSelector('text=Your Feedback Quest: 1 / 4 completed')
    await shot(pa, 'A-done')
    await go(pb, '#/1101'); await signIn(pb, B)
    await openDesk(pb, P)
    await pb.waitForSelector('[data-testid=comment]')
    const text = await pb.textContent('[data-testid=comment]')
    assert(text.includes(byId(A).fullName) && text.includes('bright friendly colors'), `B sees A's review: ${text}`)
    await shot(pb, 'B-sees-A')
  })

  await test('only the author can edit (UI + server); an edit does not use a slot', async () => {
    eq(await pb.locator('[data-testid=edit-comment]').count(), 0, 'no edit button for B')
    const id = sql(`select id from public.comments where reviewer_id='${A}' and project_id='${P}'`)[0].id
    const r = await rpcFromPage(pb, 'update_comment', { p_comment_id: id, p_pronouns: '', p_enjoyed: 'Hijacked text that is long enough to pass.', p_suggestion: 'Hijacked suggestion that is long enough.' })
    assert(/not_author/.test(r.body?.message ?? ''), `server refuses B: ${msg(r)}`)
    await pa.waitForTimeout(16000) // the server allows one write per student every 15 seconds
    await pa.click('text=See the comments'); await pa.click('[data-testid=edit-comment]'); await pa.waitForSelector('[data-testid=feedback-form]')
    await pa.fill('[data-testid=fb-q1]', 'I loved how clearly the homepage explains the idea and the cozy soundtrack.')
    await pa.click('[data-testid=fb-preview]'); await pa.click('[data-testid=fb-submit]'); await pa.waitForSelector('[data-testid=done]', { timeout: 30000 })
    eq(published(P), 1, 'still one comment on the project')
    await pb.keyboard.press('Escape'); await openDesk(pb, P)
    await pb.waitForSelector('text=cozy soundtrack')
  })

  await test('self-review prevented (UI + server)', async () => {
    await pa.keyboard.press('Escape').catch(() => {})
    await openDesk(pa, A)
    assert(await pa.isDisabled('[data-testid=leave-thoughts]'), 'Leave Your Thoughts disabled on own project')
    const r = await rpcFromPage(pa, 'submit_comment', { p_project_id: A, p_pronouns: '', p_enjoyed: 'Reviewing my own project right now.', p_suggestion: 'This must be refused by the server.' })
    assert(/self_review/.test(r.body?.message ?? ''), `server: ${msg(r)}`)
  })

  await test('course restriction both ways (UI + server); other course still explorable; unassigned project refused', async () => {
    await pa.keyboard.press('Escape').catch(() => {})
    await go(pa, '#/2241'); await openDesk(pa, other2241)
    assert(await pa.isDisabled('[data-testid=leave-thoughts]'), '1101 student: button disabled on a 2241 project')
    await pa.waitForSelector('text=only projects in your own course')
    assert(await pa.isEnabled('[data-testid=explore-link]'), '2241 project still explorable')
    const r1 = await rpcFromPage(pa, 'submit_comment', { p_project_id: other2241, p_pronouns: '', p_enjoyed: 'Trying to review the other course.', p_suggestion: 'This must be refused by the server.' })
    assert(/wrong_course/.test(r1.body?.message ?? ''), `1101 → 2241: ${msg(r1)}`)
    const pc = await open(edge, 'C')
    await go(pc, '#/1101'); await signIn(pc, C)
    const r2 = await rpcFromPage(pc, 'submit_comment', { p_project_id: P, p_pronouns: '', p_enjoyed: 'Trying to review the other course.', p_suggestion: 'This must be refused by the server.' })
    assert(/wrong_course/.test(r2.body?.message ?? ''), `2241 → 1101: ${msg(r2)}`)
    await pc.context().close()
    await pa.waitForTimeout(16000) // rate limit (checked before the assignment) must not mask not_assigned
    const r3 = await rpcFromPage(pa, 'submit_comment', { p_project_id: notAssignedToA, p_pronouns: '', p_enjoyed: 'Reviewing a project I was not given.', p_suggestion: 'This must be refused by the server.' })
    assert(/not_assigned/.test(r3.body?.message ?? ''), `unassigned: ${msg(r3)}`)
  })

  await test('capacity: two browsers press Send for the LAST free slot at the same moment → exactly one succeeds; full project stays explorable', async () => {
    await pb.keyboard.press('Escape').catch(() => {})
    await openDesk(pb, P)
    await writeReview(pb, 'I really enjoyed the clean layout and the way each section flows into the next.', 'One idea: add a short video or animation that shows the product in action.')
    eq(published(P), 2, 'two published before the race')
    sql(`update public.project_slots set capacity = 3, updated_at = now() where project_id = '${P}'`, { write: true }) // test fixture: one free slot left
    const px = await open(chrome, 'X'); const py = await open(edge, 'Y')
    for (const [p, id] of [[px, X], [py, Y]]) { await go(p, '#/1101'); await signIn(p, id); await openDesk(p, P); await writeReview(p, `Racing for the last slot, I enjoyed the friendly design a lot (${id}).`, 'Please add one more example page so visitors can explore further.', false) }
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

  await test('pause: with feedback paused the server refuses student writes with "closed"', async () => {
    sql(`update public.settings set feedback_open = false where id = 1`, { write: true })
    const next = sql(`select project_id from public.assignments where reviewer_id='${A}' and status='pending' order by project_id limit 1`)[0].project_id
    const r = await rpcFromPage(pa, 'submit_comment', { p_project_id: next, p_pronouns: '', p_enjoyed: 'Trying while feedback is paused.', p_suggestion: 'This must be refused by the server.' })
    assert(/closed/.test(r.body?.message ?? ''), `paused: ${msg(r)}`)
  })

  await test('no page errors in any browser', async () => { eq(errors.length, 0, `page errors: ${errors.join(' | ')}`) })
} catch (e) {
  console.error('Production test setup failed:', e.message)
  results.push({ name: 'setup', ok: false, err: e.message })
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  const list = TEST.map((x) => `'${x}'`).join(',')
  try {
    sql(`begin;
      update public.settings set feedback_open = false, allow_extra_reviews = false where id = 1;
      update public.assignments set status = 'pending', comment_id = null, updated_at = now() where reviewer_id in (${list}) and status = 'completed';
      delete from public.comments where reviewer_id in (${list}) and created_at >= '${START}';
      delete from public.write_events where student_id in (${list}) and at >= '${START}';
      delete from public.student_sessions where student_id in (${list}) and created_at >= '${START}';
      delete from public.code_attempts where at >= '${START}';
      update public.project_slots set capacity = 4, updated_at = now() where project_id = '${P}';
      commit;`, { write: true })
    console.log('Cleanup: test comments, sessions and attempts removed; capacity restored; feedback PAUSED.')
  } catch (e) { console.error('CLEANUP FAILED — check the database:', e.message); process.exitCode = 1 }
  try { sql(`delete from auth.users where is_anonymous and created_at >= '${START}'`, { write: true }); console.log('Cleanup: anonymous test sessions removed from auth.users.') } catch (e) { console.error('Note: could not remove anonymous auth users:', e.message) }
}
const failed = results.filter((r) => !r.ok)
console.log(`\nProduction two-browser tests: ${results.length - failed.length} / ${results.length} passed.`)
if (failed.length) process.exitCode = 1
