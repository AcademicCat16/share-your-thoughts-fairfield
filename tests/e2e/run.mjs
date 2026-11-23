/**
 * End-to-end tests (Demo mode) in a real browser (playwright-core; channel from E2E_CHANNEL, default "chrome").
 * Builds must exist (npm run build). Starts `vite preview` on port 4311 and writes screenshots to tests/output/e2e/.
 *   npm run test:e2e                     # full suite
 *   E2E_CHANNEL=msedge npm run test:e2e  # same suite in Microsoft Edge
 *   E2E_SMOKE=1 …                        # quick subset (used for the cross-browser run)
 */
import { chromium, firefox, webkit } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'

const PORT = Number(process.env.E2E_PORT || 4311)
const BASE = `http://localhost:${PORT}/share-your-thoughts-fairfield/`
const CHANNEL = process.env.E2E_CHANNEL || 'chrome'
const SMOKE = !!process.env.E2E_SMOKE
const OUT = `tests/output/e2e${CHANNEL === 'chrome' ? '' : `-${CHANNEL}`}`
mkdirSync(OUT, { recursive: true })
const roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8'))
const S = roster.students
const isOk = (s) => !s.hidden && s.urlStatus === 'valid' && s.link?.status === 'working'
const P1101 = S.filter((s) => s.course === '1101'); const P2241 = S.filter((s) => s.course === '2241')
const byName = (n) => S.find((s) => s.fullName === n)

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' })
const stopServer = () => { try { server.kill() } catch { /* ignore */ } }
process.on('exit', stopServer)
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)) }

const engine = CHANNEL === 'firefox' ? firefox : CHANNEL === 'webkit' ? webkit : chromium
const browser = await engine.launch(engine === chromium ? { channel: CHANNEL, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : {})
const results = []
const pageErrors = []
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(`${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/WebGL|GPU stall|GL Driver/i.test(m.text())) pageErrors.push(m.text()) })
  return page
}
async function test(name, fn, { smoke = false } = {}) {
  if (SMOKE && !smoke) return
  const t0 = Date.now()
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✔ ${name}`) } catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✖ ${name}\n      ${e.message.split('\n')[0]}`) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const room = (p, course, view = '2d') => p.goto(`${BASE}?view=${view}#/${course}`, { waitUntil: 'networkidle' })
const shot = async (p, n) => { await p.waitForTimeout(450); await p.screenshot({ path: `${OUT}/${n}.png` }) }
const text = async (p, sel) => (await p.textContent(sel)).replace(/\s+/g, ' ').trim()

const GOOD1 = 'I loved the cozy cabin music and the snowy window animation.'
const GOOD2 = 'Add a button that lets visitors decorate the tree themselves.'
async function signIn(p, studentId) {
  await p.click('[data-testid=header-signin]')
  await p.selectOption('[data-testid=signin-who]', studentId)
  await p.click('[data-testid=signin-submit]')
  await p.waitForSelector('[data-testid=me-chip]')
}
async function signOut(p) { await p.click('[aria-label="Sign out"]'); await p.waitForSelector('[data-testid=header-signin]') }
async function openDesk(p, id) { await p.click(`[data-testid=desk-${id}]`); await p.waitForSelector('[data-testid=profile-modal]') }
async function closeModal(p) { await p.keyboard.press('Escape'); await p.waitForSelector('[data-testid=profile-modal]', { state: 'detached' }) }
async function leaveFeedback(p, q1 = GOOD1, q2 = GOOD2, pronouns = '') {
  await p.click('[data-testid=leave-thoughts]')
  await p.waitForSelector('[data-testid=feedback-form]')
  if (pronouns) await p.fill('[data-testid=fb-pronouns]', pronouns)
  await p.fill('[data-testid=fb-q1]', q1); await p.fill('[data-testid=fb-q2]', q2)
  await p.click('[data-testid=fb-preview]'); await p.waitForSelector('[data-testid=preview]')
  await p.click('[data-testid=fb-submit]'); await p.waitForSelector('[data-testid=done]')
}
/** The demo plan lives in localStorage — read a student's assignments from it. */
const demoState = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('fic.demo.state.v1')))
const assignedTo = async (p, reviewerId, status = 'pending') => (await demoState(p)).assignments.filter((a) => a.reviewerId === reviewerId && a.status === status).map((a) => a.projectId)

console.log(`E2E (${CHANNEL}${SMOKE ? ', smoke' : ''}) — Fairfield Interactive Worlds`)

await test('home: title, subtitle, two classroom cards with counts, demo banner, enter + return home', async () => {
  const p = await newPage()
  await p.goto(BASE, { waitUntil: 'networkidle' })
  eq(await text(p, '[data-testid=home-title]'), 'Fairfield Interactive Worlds', 'title')
  eq(await text(p, '.home-sub'), "Explore your classmates' creations, discover new ideas, and share your thoughts!", 'subtitle')
  eq(await text(p, '[data-testid=demo-banner] strong'), 'Demo Mode — Comments are stored only in this browser.', 'banner')
  eq(await text(p, '[data-testid=class-card-1101] h2'), 'Principles of Marketing', '1101 card')
  eq(await text(p, '[data-testid=class-count-1101]'), '28 Students', '1101 count')
  eq(await text(p, '[data-testid=class-card-2241] h2'), 'Digital Marketing', '2241 card')
  eq(await text(p, '[data-testid=class-count-2241]'), '58 Students', '2241 count')
  assert((await text(p, '[data-testid=class-card-1101]')).includes('MKTG 1101') && (await text(p, '[data-testid=class-card-2241]')).includes('MKTG 2241'), 'course codes')
  await shot(p, '01_home')
  await p.click('[data-testid=enter-1101]'); await p.waitForSelector('[data-testid=back-home]')
  assert(p.url().endsWith('#/1101'), 'entered 1101')
  await p.click('[data-testid=back-home]'); await p.waitForSelector('[data-testid=home]')
  await p.click('[data-testid=enter-2241]'); await p.waitForSelector('[data-testid=back-home]')
  assert(p.url().endsWith('#/2241'), 'entered 2241')
  await p.context().close()
}, { smoke: true })

await test('Principles room: exactly 28 seats with names, 28 creatures (column E links)', async () => {
  const p = await newPage(); await room(p, '1101')
  eq(await p.locator('.desk2d').count(), 28, 'desks')
  eq(await p.locator('.desk2d.empty').count(), P1101.filter((s) => !isOk(s)).length, 'empty desks')
  for (const s of P1101) {
    eq(await p.textContent(`[data-testid=desk-${s.id}] .np-first`), s.firstName, `first ${s.id}`)
    eq(await p.textContent(`[data-testid=desk-${s.id}] .np-last`), s.lastName, `last ${s.id}`)
  }
  eq(await p.locator('[data-testid=filter-01]').count(), 0, 'no section filter in 1101')
  await shot(p, '02_room_1101')
  await p.context().close()
}, { smoke: true })

await test('Digital Marketing room: 58 seats (28 + 30), 53 creatures, five empty chairs with name tags', async () => {
  const p = await newPage(); await room(p, '2241')
  eq(await p.locator('.desk2d').count(), 58, 'desks')
  eq(await p.locator('.section2d.sec-01 .desk2d').count(), 28, 'section 01')
  eq(await p.locator('.section2d.sec-02 .desk2d').count(), 30, 'section 02')
  eq(await p.locator('.desk2d:not(.empty) .creature').count(), P2241.filter(isOk).length, 'creatures only at working desks')
  const empties = await p.$$eval('.desk2d.empty', (els) => els.map((e) => `${e.querySelector('.np-first').textContent} ${e.querySelector('.np-last').textContent}`).sort())
  eq(JSON.stringify(empties), JSON.stringify(['Ainsley Gondek', 'Courtney Shyposh', 'James Honekamp', 'Mason Carter', 'Michael Gallagher']), 'the five empty chairs')
  await openDesk(p, byName('Mason Carter').id)
  eq(await text(p, '[data-testid=empty-message]'), "This project hasn't arrived yet!", 'message')
  eq(await p.locator('[data-testid=leave-thoughts]').count(), 0, 'no feedback button')
  eq(await p.locator('[data-testid=explore-link]').count(), 0, 'no project link')
  await shot(p, '03_empty_seat')
  await closeModal(p)
  await p.click('[data-testid=filter-02]'); eq(await p.locator('.desk2d').count(), 30, 'section 02 only')
  await p.click('[data-testid=filter-01]'); eq(await p.locator('.desk2d').count(), 28, 'section 01 only')
  await p.click('[data-testid=filter-all]'); eq(await p.locator('.desk2d').count(), 58, 'both sections')
  await shot(p, '04_room_2241')
  await p.context().close()
}, { smoke: true })

await test('name tags never overlap or clip (both rooms; 1440, 1024 and 390 px)', async () => {
  for (const course of ['1101', '2241']) for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    const p = await newPage({ viewport: vp }); await room(p, course)
    const boxes = await p.$$eval('.nameplate', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }))
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]]
      assert(!(Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1), `${course}: plates ${i}/${j} overlap at ${vp.width}px`)
    }
    const clipped = await p.$$eval('.nameplate span', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
    eq(clipped.length, 0, `${course}: text clipped at ${vp.width}px: ${clipped.join(', ')}`)
    await p.context().close()
  }
})

await test('creatures: 86 distinct names across both rooms; the two rooms share none', async () => {
  const p = await newPage()
  const names = {}
  for (const c of ['1101', '2241']) {
    await room(p, c)
    names[c] = await p.$$eval('.desk2d:not(.empty)', (els) => els.map((e) => e.getAttribute('aria-label').split('. ')[1]?.split(' the ')[0]))
  }
  eq(new Set(names['1101']).size, names['1101'].length, '1101 unique'); eq(new Set(names['2241']).size, names['2241'].length, '2241 unique')
  eq(names['1101'].filter((n) => names['2241'].includes(n)).length, 0, 'no creature reused between rooms')
  // Existing Digital Marketing creatures kept (first demo): Zoe Labdon ↔ c08, Antonia Rolo ↔ c33.
  eq(byName('Zoe Labdon').creatureId, 'c08', 'stable assignment'); eq(byName('Antonia Rolo').creatureId, 'c33', 'stable assignment')
  await p.context().close()
})

await test('profile modal: interactive-website link (new tab, safe rel), creature details, no iframes', async () => {
  const p = await newPage()
  for (const [course, s] of [['1101', byName('Mason Andrews')], ['1101', byName('Owen Sullivan')], ['2241', byName('Katie DeBello')]]) {
    await room(p, course); await openDesk(p, s.id)
    eq(await text(p, '[data-testid=profile-name]'), s.fullName, 'name')
    const a = p.locator('[data-testid=explore-link]')
    eq(await a.getAttribute('href'), new URL(s.url).href, 'href = roster URL (interactive site)')
    eq(await a.getAttribute('target'), '_blank', 'target'); eq(await a.getAttribute('rel'), 'noopener noreferrer', 'rel')
    if (s.fullName === 'Mason Andrews') { eq(s.url, 'https://masonandrews-stack.github.io/creative-website/', 'column E, not personal site'); await shot(p, '05_profile_1101') }
    await closeModal(p)
  }
  eq(await p.locator('iframe').count(), 0, 'student sites are never embedded')
  await p.context().close()
}, { smoke: true })

await test('Feedback Quest: four distinct assigned classmates in your course; Find My Next Review; exact form wording; preview; submit; progress', async () => {
  const p = await newPage(); await room(p, '2241')
  const me = byName('Graham Fields')
  await signIn(p, me.id)
  eq(await text(p, '[data-testid=quest-progress]'), 'Your Feedback Quest: 0 / 4 completed', 'quest start')
  const mine = await assignedTo(p, me.id)
  eq(mine.length, 4, 'four assignments'); eq(new Set(mine).size, 4, 'distinct')
  for (const id of mine) { const s = S.find((x) => x.id === id); assert(s.course === '2241' && id !== me.id && isOk(s), `valid assignment ${id}`) }
  await shot(p, '06_quest')
  await p.click('[data-testid=find-next]'); await p.waitForSelector('[data-testid=profile-modal]')
  const target = byName(await text(p, '[data-testid=profile-name]'))
  assert(mine.includes(target.id), 'Find My Next Review opened an assigned project')
  await p.click('[data-testid=leave-thoughts]'); await p.waitForSelector('[data-testid=feedback-form]')
  eq(await text(p, '.form-head h2'), 'Leave Your Thoughts', 'title')
  eq(await text(p, '.form-head .subtitle'), 'Tell your classmate what you loved and share one idea that could make it even better!', 'subtitle')
  const labels = await p.$$eval('.feedback-form .field > span', (els) => els.map((e) => e.textContent.trim()))
  assert(labels.includes('What did you enjoy most about this project? Share a specific compliment!'), 'Q1')
  assert(labels.includes('What is one improvement or new feature you would suggest?'), 'Q2')
  eq(await p.inputValue('[data-testid=fb-first]'), me.firstName, 'verified first name'); eq(await p.inputValue('[data-testid=fb-last]'), me.lastName, 'verified last name')
  assert(await p.locator('[data-testid=fb-first]').getAttribute('readonly') !== null, 'name not editable')
  await p.fill('[data-testid=fb-q1]', 'nice'); await p.fill('[data-testid=fb-q2]', GOOD2); await p.click('[data-testid=fb-preview]')
  assert((await p.textContent('[data-testid=form-error]')).includes('Question 1'), 'too short rejected')
  await p.fill('[data-testid=fb-q1]', 'This is stupid but the music is ok'); await p.click('[data-testid=fb-preview]')
  assert((await p.textContent('[data-testid=form-error]')).toLowerCase().includes('kind'), 'unkind rejected')
  await p.fill('[data-testid=fb-q1]', GOOD1); await p.click('[data-testid=fb-preview]')
  const preview = await text(p, '[data-testid=preview-text]')
  eq(preview, 'Graham Fields loved the cozy cabin music and the snowy window animation. One suggestion was to add a button that lets visitors decorate the tree themselves.', 'natural paragraph')
  await shot(p, '07_preview')
  await p.click('[data-testid=fb-submit]'); await p.waitForSelector('[data-testid=done]')
  eq(await text(p, '[data-testid=done-text]'), preview, 'review shown immediately')
  eq(await text(p, '[data-testid=done-progress]'), 'Your Feedback Quest: 1 / 4 completed', 'progress')
  assert((await text(p, '[data-testid=done-slots]')).startsWith(`${target.firstName}'s world now has 1 of`), 'remaining slots updated')
  eq(await text(p, '[data-testid=my-progress]'), 'Your Feedback Quest: 1 / 4 completed', 'header progress')
  await shot(p, '08_done')
  await p.context().close()
}, { smoke: true })

await test('restrictions: self, not assigned, other course — button off with a friendly reason; exploring stays on', async () => {
  const p = await newPage(); await room(p, '2241')
  const me = byName('Antonia Rolo'); await signIn(p, me.id)
  await openDesk(p, me.id)
  assert(await p.isDisabled('[data-testid=leave-thoughts]'), 'own project off'); assert((await text(p, '[data-testid=block-message]')).includes('your own world'), 'self message')
  await closeModal(p)
  const mine = await assignedTo(p, me.id)
  const other = P2241.find((s) => isOk(s) && s.id !== me.id && !mine.includes(s.id))
  await openDesk(p, other.id)
  assert(await p.isDisabled('[data-testid=leave-thoughts]'), 'unassigned off')
  assert((await text(p, '[data-testid=block-message]')).includes('Feedback Quest'), 'not-assigned message')
  assert(await p.isEnabled('[data-testid=explore-link]'), 'still explorable')
  await closeModal(p)
  await room(p, '1101'); await openDesk(p, P1101[3].id)
  assert(await p.isDisabled('[data-testid=leave-thoughts]'), 'other course off')
  assert((await text(p, '[data-testid=block-message]')).includes('only projects in your own course'), 'course message')
  assert(await p.isEnabled('[data-testid=explore-link]'), 'other course still explorable')
  await shot(p, '09_other_course')
  await p.context().close()
}, { smoke: true })

await test('four reviews → congratulations; duplicates become edits; edits keep the slot; nobody else can edit', async () => {
  const p = await newPage(); await room(p, '1101')
  const me = P1101[0]; await signIn(p, me.id)
  const mine = await assignedTo(p, me.id)
  for (const [i, id] of mine.entries()) {
    await openDesk(p, id); await leaveFeedback(p)
    if (i < 3) await closeModal(p)
  }
  eq(await text(p, '[data-testid=done-progress]'), 'Your Feedback Quest: 4 / 4 completed', '4 / 4')
  const cg = await text(p, '[data-testid=done-congrats]')
  assert(cg.includes('Congratulations, Thoughtful Explorer!') && cg.includes("You've explored four classmates' creations and shared feedback to help them grow.") && cg.includes('Keep exploring — there are more amazing worlds to discover!'), `congrats: ${cg}`)
  await shot(p, '10_congrats')
  await closeModal(p)
  await p.waitForSelector('[data-testid=quest-congrats]')
  await openDesk(p, mine[0])
  eq(await p.locator('[data-testid=leave-thoughts]').count(), 0, 'no second submission')
  await p.click('[data-testid=edit-comment]'); await p.fill('[data-testid=fb-q2]', 'Maybe add a short tutorial for first-time visitors.')
  await p.click('[data-testid=fb-preview]'); await p.click('[data-testid=fb-submit]'); await p.waitForSelector('[data-testid=done]')
  eq(await text(p, '[data-testid=done-progress]'), 'Your Feedback Quest: 4 / 4 completed', 'edit used no slot')
  await p.click('text=See the comments')
  assert((await text(p, '[data-testid=comment]')).includes('short tutorial'), 'edited text')
  await closeModal(p)
  // An unassigned 1101 project is still off after finishing (extra reviews need instructor approval)…
  const extra = P1101.find((s) => s.id !== me.id && !mine.includes(s.id))
  await openDesk(p, extra.id); assert(await p.isDisabled('[data-testid=leave-thoughts]') || (await p.locator('[data-testid=full-message]').count()) > 0, 'no unassigned review by default'); await closeModal(p)
  // …and someone else cannot edit this comment.
  await signOut(p); await signIn(p, P1101[1].id); await openDesk(p, mine[0])
  eq(await p.locator('[data-testid=edit-comment]').count(), 0, "can't edit someone else's comment")
  await p.context().close()
})

await test('full project: every slot used → exact message, Leave Your Thoughts off, website + comments + Explore Another World still there', async () => {
  const p = await newPage(); await room(p, '2241')
  await signIn(p, P2241[0].id)
  const st = await demoState(p)
  const target = Object.entries(st.capacities).find(([id, n]) => n === 5 && S.find((s) => s.id === id).course === '2241')[0]
  const reviewers = st.assignments.filter((a) => a.projectId === target && a.status === 'pending').map((a) => a.reviewerId)
  eq(reviewers.length, 5, 'five reviewers assigned to a fifth-slot project')
  await signOut(p)
  for (const r of reviewers) { await signIn(p, r); await openDesk(p, target); await leaveFeedback(p); await closeModal(p); await signOut(p) }
  await openDesk(p, target)
  eq(await text(p, '[data-testid=comment-count]'), '5 / 5', 'count')
  eq((await p.innerText('[data-testid=full-message]')).replace(/\s+/g, ' ').trim(), 'All comment slots are full! This project has received its feedback for now. You can still explore the website and read what your classmates shared!', 'full message')
  assert(await p.isDisabled('[data-testid=leave-thoughts]'), 'Leave Your Thoughts disabled')
  assert(await p.isEnabled('[data-testid=explore-link]'), 'website button active')
  eq(await p.locator('[data-testid=comment]').count(), 5, 'existing feedback shown')
  eq(await p.locator('.slots-line .review-dots i.extra').count(), 1, 'the fifth slot is drawn as an additional slot')
  await shot(p, '11_full_project')
  await p.click('[data-testid=modal-explore-another]')
  await p.waitForFunction((t) => document.querySelector('[data-testid=profile-name]')?.textContent !== t, (S.find((s) => s.id === target).fullName))
  await closeModal(p)
  eq(await p.locator(`[data-testid=desk-${target}] .review-dots.full`).count(), 1, 'desk shows full but is still there')
  await p.context().close()
})

await test('Explore Another World: no sign-in needed, unlimited, varied, only working projects in this room', async () => {
  const p = await newPage(); await room(p, '1101')
  const seen = []
  for (let i = 0; i < 12; i++) {
    await p.click('[data-testid=explore-another]'); await p.waitForSelector('[data-testid=profile-modal]')
    const s = byName(await text(p, '[data-testid=profile-name]')); seen.push(s.id)
    assert(s.course === '1101' && isOk(s), `working 1101 project (${s.id})`)
    assert(await p.isEnabled('[data-testid=explore-link]'), 'explore link on')
    await closeModal(p)
  }
  eq(new Set(seen).size, 12, `twelve different worlds before any repeat (${seen.join(',')})`)
  await p.context().close()
}, { smoke: true })

await test('search', async () => {
  const p = await newPage(); await room(p, '2241')
  await p.fill('[data-testid=search]', 'labdon')
  assert((await text(p, '[data-testid=match-count]')).startsWith('1 seat matches'), 'one match')
  eq(await p.locator('.desk2d:not(.dim)').count(), 1, 'others dimmed')
  await p.context().close()
})

await test('keyboard: Tab between desks, Enter opens, focus trapped, Esc returns focus', async () => {
  const p = await newPage(); await room(p, '2241')
  await p.focus(`[data-testid=desk-${P2241[0].id}]`); await p.keyboard.press('Tab')
  eq(await p.evaluate(() => document.activeElement?.getAttribute('data-student')), P2241[1].id, 'Tab moves to the next desk')
  await p.keyboard.press('Enter'); await p.waitForSelector('[data-testid=profile-modal]')
  for (let i = 0; i < 14; i++) await p.keyboard.press('Tab')
  assert(await p.evaluate(() => !!document.activeElement?.closest('[data-testid=profile-modal]')), 'focus stays in the modal')
  await p.keyboard.press('Escape')
  eq(await p.evaluate(() => document.activeElement?.getAttribute('data-student')), P2241[1].id, 'focus returned')
  await p.context().close()
}, { smoke: true })

await test('reduced motion: creature animations off', async () => {
  const p = await newPage({ reducedMotion: 'reduce' }); await room(p, '1101')
  const durs = await p.$$eval('.creature .cr-root', (els) => els.slice(0, 10).map((e) => getComputedStyle(e).animationDuration))
  assert(durs.every((d) => parseFloat(d) < 0.01), `durations ${durs.join(',')}`)
  eq(await p.locator('.creature[class*="idle-"]').count(), 0, 'idle animation classes removed')
  await p.context().close()
}, { smoke: true })

await test('phone (390×844): home and both rooms without sideways scroll; 2D default; modal fits', async () => {
  const p = await newPage({ viewport: { width: 390, height: 844 }, isMobile: engine !== firefox, hasTouch: true })
  for (const h of ['', '#/1101', '#/2241', '#/guide']) {
    await p.goto(BASE + h, { waitUntil: 'networkidle' })
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert(over <= 0, `horizontal overflow ${over}px on ${h || 'home'}`)
  }
  await p.goto(BASE + '#/2241', { waitUntil: 'networkidle' })
  eq(await p.locator('[data-testid=classroom-2d]').count(), 1, 'phones default to 2D')
  await shot(p, '12_phone_room')
  await p.click(`[data-testid=desk-${P2241.find(isOk).id}]`); await p.waitForSelector('[data-testid=profile-modal]')
  const m = await p.locator('[data-testid=profile-modal]').boundingBox()
  assert(m.width <= 390 && m.x >= 0, 'modal within the screen')
  await shot(p, '13_phone_modal')
  await p.context().close()
}, { smoke: true })

for (const course of ['1101', '2241']) {
  await test(`3D ${course}: seats, creatures, camera rotate / zoom / pan / reset, hover tooltip + click`, async () => {
    const list = course === '1101' ? P1101 : P2241
    const p = await newPage(); await room(p, course, '3d')
    await p.waitForFunction(() => window.__fic3d?.ready, null, { timeout: 45000 })
    const info = await p.evaluate(() => ({ seats: window.__fic3d.seats, creatures: window.__fic3d.creatures }))
    eq(info.seats, list.length, 'seats'); eq(info.creatures, list.filter(isOk).length, 'creatures')
    await p.waitForTimeout(800)
    const dist = (c, t) => Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2])
    const cam0 = await p.evaluate(() => window.__fic3d.camera()); const t0 = await p.evaluate(() => window.__fic3d.target())
    await p.click('[data-testid=cam-zoom-in]'); await p.waitForTimeout(1200)
    const cam1 = await p.evaluate(() => window.__fic3d.camera())
    assert(dist(cam1, t0) < dist(cam0, t0) - 1, 'zoom in moves closer')
    await p.click('[data-testid=cam-rot-l]'); await p.waitForTimeout(1200)
    const cam2 = await p.evaluate(() => window.__fic3d.camera())
    assert(Math.abs(cam2[0] - cam1[0]) > 1, 'rotate button orbits')
    const box = await p.locator('canvas').boundingBox()
    await p.mouse.move(box.x + 200, box.y + box.height * 0.7); await p.mouse.down(); await p.mouse.move(box.x + 420, box.y + box.height * 0.68, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(600)
    const cam3 = await p.evaluate(() => window.__fic3d.camera())
    assert(Math.hypot(cam3[0] - cam2[0], cam3[2] - cam2[2]) > 0.5, 'mouse drag rotates')
    const tBefore = await p.evaluate(() => window.__fic3d.target())
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down({ button: 'right' }); await p.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 - 20, { steps: 6 }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(500)
    const tAfter = await p.evaluate(() => window.__fic3d.target())
    assert(Math.hypot(tAfter[0] - tBefore[0], tAfter[2] - tBefore[2]) > 0.2, 'right-drag pans')
    await p.click('[data-testid=cam-reset]'); await p.waitForTimeout(2200)
    const camR = await p.evaluate(() => window.__fic3d.camera())
    assert(Math.hypot(camR[0] - cam0[0], camR[1] - cam0[1], camR[2] - cam0[2]) < 0.3, `reset returns home (${camR})`)
    const target = list.filter(isOk)[course === '1101' ? 6 : 20]
    await p.fill('[data-testid=search]', target.lastName); await p.waitForTimeout(2200); await p.fill('[data-testid=search]', '')
    const pt = await p.evaluate((id) => window.__fic3d.project(id), target.id)
    await p.mouse.move(box.x + pt.x, box.y + pt.y); await p.waitForTimeout(700)
    eq(await p.evaluate(() => window.__fic3d.hovered), target.id, 'hovered creature')
    assert((await p.textContent('.tooltip')).includes(target.fullName), 'tooltip shows name')
    await shot(p, `14_3d_${course}_hover`)
    await p.mouse.click(box.x + pt.x, box.y + pt.y); await p.waitForSelector('[data-testid=profile-modal]')
    eq(await text(p, '[data-testid=profile-name]'), target.fullName, 'clicked the right creature')
    await closeModal(p)
    await p.click('[data-testid=cam-reset]'); await p.waitForTimeout(2000)
    await shot(p, `15_3d_${course}`)
    await p.context().close()
  }, { smoke: course === '2241' })
}

await test('instructor (demo): per-course statistics, fifth-slot plan, release + rebalance, pause, exports, moderation, reset', async () => {
  const p = await newPage(); await room(p, '2241')
  await signIn(p, byName('Hannah Natlo').id)
  const mine = await assignedTo(p, byName('Hannah Natlo').id)
  await openDesk(p, mine[0]); await leaveFeedback(p, 'I liked the brain regions you can click on.', 'Add a quiz at the end to test what we learned.'); await closeModal(p)
  await p.goto(`${BASE}#/instructor`, { waitUntil: 'networkidle' }); await p.waitForSelector('[data-testid=course-panel-2241]')
  const kpi = async (id) => text(p, `[data-testid=${id}] strong`)
  eq(await kpi('kpi-1101-students'), '28', '1101 students'); eq(await kpi('kpi-1101-working-websites'), '28', '1101 working')
  eq(await kpi('kpi-2241-students'), '58', '2241 students'); eq(await kpi('kpi-2241-working-websites'), '53', '2241 working')
  eq(await kpi('kpi-2241-missing-broken'), '5', '2241 missing'); eq(await kpi('kpi-2241-reviews-submitted'), '1', 'submitted')
  eq(await kpi('kpi-2241-extra-slots'), '20', 'fifth slots'); eq(await kpi('kpi-1101-extra-slots'), '0', 'no extra in 1101')
  eq(await text(p, '[data-testid=extra-needed-2241]'), '20', 'extra needed'); eq(await kpi('kpi-all-students'), '86', 'combined')
  await shot(p, '16_instructor')
  // regenerate: completed review kept, still 20 extra slots on 20 projects
  await p.click('[data-testid=plan-replace-2241]'); await p.waitForSelector('[data-testid=plan-ok]')
  eq(await text(p, '[data-testid=plan-extra]'), '20', 'plan extra'); eq(await text(p, '[data-testid=plan-extra-projects]'), '20', 'plan projects')
  await shot(p, '17_plan'); await p.click('[data-testid=plan-apply]'); await p.waitForSelector('[data-testid=plan-preview]', { state: 'detached' })
  let st = await demoState(p)
  assert(st.comments.length === 1 && st.assignments.some((a) => a.status === 'completed'), 'completed review kept')
  // release a non-participant, then rebalance: their four slots move to others, demand 228
  const gone = byName('Seth Feldman').id
  p.once('dialog', (d) => d.accept())
  await p.click(`[data-testid=release-${gone}]`); await p.waitForTimeout(300)
  await p.click('[data-testid=plan-rebalance-2241]'); await p.waitForSelector('[data-testid=plan-ok]'); await p.click('[data-testid=plan-apply]'); await p.waitForTimeout(300)
  st = await demoState(p)
  eq(st.assignments.filter((a) => a.reviewerId === gone && a.status === 'pending').length, 0, 'released student has no pending work')
  eq(st.assignments.filter((a) => a.course === '2241' && a.status !== 'released').length, 228, '57 × 4 assignments')
  // pause blocks students
  await p.click('[data-testid=toggle-open]'); await p.waitForTimeout(300)
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=export-completion]')])
  eq(readFileSync(await dl.path(), 'utf8').trim().split('\n').length, 87, 'completion CSV: header + 86')
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=export-feedback]')])
  assert(readFileSync(await dl2.path(), 'utf8').includes('brain regions'), 'comments CSV')
  await room(p, '2241'); await openDesk(p, mine[1])
  assert(await p.isDisabled('[data-testid=leave-thoughts]'), 'paused'); assert((await text(p, '[data-testid=block-message]')).includes('paused'), 'pause message')
  await closeModal(p)
  await p.goto(`${BASE}#/instructor`, { waitUntil: 'networkidle' }); await p.waitForSelector('[data-testid=course-panel-2241]')
  await p.click('[data-testid=toggle-open]')
  p.once('dialog', (d) => d.accept('Test removal')); await p.click('[data-testid=mod-remove]'); await p.waitForTimeout(400)
  eq(await kpi('kpi-2241-reviews-submitted'), '0', 'removed comment not counted')
  if (existsSync('Take-Home Exam (final).xlsm')) {
    await p.setInputFiles('[data-testid=roster-file]', 'Take-Home Exam (final).xlsm'); await p.waitForSelector('[data-testid=import-preview]')
    const t = await text(p, '[data-testid=import-preview]')
    assert(t.includes('86 students') && t.includes('0 new'), `re-import preview: ${t.slice(0, 160)}`)
    eq(await text(p, '[data-testid=import-changes]'), '0', 'no link changes against the published roster')
  }
  await p.click('[data-testid=reset-demo]'); await p.click('[data-testid=reset-demo-confirm]'); await p.waitForTimeout(300)
  eq(await p.locator('[data-testid=mod-item]').count(), 0, 'demo data reset')
  await p.context().close()
})

await test('student guide: 8 numbered steps exactly as specified, the key facts, no technical words', async () => {
  const p = await newPage(); await p.goto(`${BASE}#/guide`, { waitUntil: 'networkidle' })
  const steps = await p.$$eval('[data-testid=guide-step] h2', (els) => els.map((e) => e.textContent.replace(/^Step \d+: /, '').trim()))
  eq(JSON.stringify(steps), JSON.stringify(['Choose your classroom.', 'Explore the colorful classroom.', 'Click a classmate’s creature.', 'Visit their interactive website.', 'Return to the classroom.', 'Leave a compliment and a helpful suggestion.', 'Complete four reviews.', 'Keep exploring other students’ worlds!']), 'steps')
  const t = (await p.textContent('main'))
  for (const f of ['You cannot review your own website.', 'You can review only projects in your course.', 'Digital Marketing sections 01 and 02 are combined.', 'Each student completes four reviews.', 'Some projects may already have full comment slots.', 'Full projects can still be explored', 'No installation or programming is required.']) assert(t.includes(f), `guide says: ${f}`)
  for (const w of ['code editor', 'terminal', 'github', 'npm', 'localstorage', 'supabase']) assert(!t.toLowerCase().includes(w), `guide mentions "${w}"`)
  await shot(p, '18_guide')
  await p.context().close()
}, { smoke: true })

await test('no page errors or console errors during the run', async () => {
  eq(pageErrors.length, 0, `errors: ${pageErrors.slice(0, 3).join(' | ')}`)
}, { smoke: true })

await browser.close(); stopServer()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed (${CHANNEL})`)
process.exit(failed.length ? 1 : 0)
