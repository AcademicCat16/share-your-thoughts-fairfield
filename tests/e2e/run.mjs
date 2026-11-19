/**
 * End-to-end tests in real Chrome (playwright-core, channel "chrome"). Builds must exist (npm run build).
 * Starts `vite preview` on port 4311, runs every scenario, writes screenshots to tests/output/e2e/.
 *   npm run test:e2e
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'

const PORT = 4311
const BASE = `http://localhost:${PORT}/share-your-thoughts-fairfield/`
const OUT = 'tests/output/e2e'
mkdirSync(OUT, { recursive: true })
const roster = JSON.parse(readFileSync('src/data/roster.json', 'utf8'))
const S = roster.students
const valid = S.filter((s) => s.urlStatus === 'valid')
const empty = S.filter((s) => s.urlStatus !== 'valid')
const byName = (n) => S.find((s) => s.fullName === n)

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' })
const stopServer = () => { try { server.kill() } catch { /* ignore */ } }
process.on('exit', stopServer)
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)) }

const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const results = []
const pageErrors = []
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(`${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()) })
  return page
}
async function test(name, fn) {
  const t0 = Date.now()
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✔ ${name}`) } catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✖ ${name}\n      ${e.message.split('\n')[0]}`) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const go = (p, q = 'view=2d', hash = '') => p.goto(`${BASE}?nowelcome&${q}${hash}`, { waitUntil: 'networkidle' })
const shot = async (p, n) => { await p.waitForTimeout(450); await p.screenshot({ path: `${OUT}/${n}.png` }) }

const GOOD1 = 'I loved the cozy cabin music and the snowy window animation.'
const GOOD2 = 'Add a button that lets visitors decorate the tree themselves.'
async function signIn(p, studentId) {
  await p.selectOption('[data-testid=signin-who]', studentId)
  await p.click('[data-testid=signin-submit]')
}
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

console.log('E2E — The Feedback Classroom')

await test('welcome screen, demo banner and entering the classroom', async () => {
  const p = await newPage()
  await p.goto(BASE + '?view=2d', { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid=welcome]')
  eq((await p.textContent('[data-testid=demo-banner] strong')).trim(), 'Demo Mode — Comments are stored only in this browser.', 'banner text')
  await shot(p, '01_welcome')
  await p.click('[data-testid=enter-classroom]')
  await p.waitForSelector('[data-testid=welcome]', { state: 'detached' })
  await p.reload({ waitUntil: 'networkidle' })
  eq(await p.locator('[data-testid=welcome]').count(), 0, 'welcome not shown again this session')
  await p.context().close()
})

await test('exactly 58 seats: 28 in 2241-01 and 30 in 2241-02, correct names and sections', async () => {
  const p = await newPage(); await go(p)
  eq(await p.locator('.desk2d').count(), 58, 'desks')
  eq(await p.locator('.section2d.sec-01 .desk2d').count(), 28, 'section 01')
  eq(await p.locator('.section2d.sec-02 .desk2d').count(), 30, 'section 02')
  for (const s of S) {
    const label = await p.getAttribute(`[data-testid=desk-${s.id}]`, 'aria-label')
    assert(label.startsWith(`${s.fullName}, ${s.sectionCode}.`), `label for ${s.id}: ${label}`)
    eq(await p.textContent(`[data-testid=desk-${s.id}] .np-first`), s.firstName, `first name ${s.id}`)
    eq(await p.textContent(`[data-testid=desk-${s.id}] .np-last`), s.lastName, `last name ${s.id}`)
    assert(await p.locator(`.section2d.sec-${s.section} [data-testid=desk-${s.id}]`).count() === 1, `${s.id} in its section`)
  }
  await shot(p, '02_classroom_2d')
  await p.context().close()
})

await test('name tags do not overlap each other (2D, desktop and phone)', async () => {
  for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    const p = await newPage({ viewport: vp }); await go(p)
    const boxes = await p.$$eval('.nameplate', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }))
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]]
      const overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1
      assert(!overlap, `name plates ${i} and ${j} overlap at ${vp.width}px`)
    }
    const clipped = await p.$$eval('.nameplate span', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
    eq(clipped.length, 0, `text clipped at ${vp.width}px: ${clipped.join(', ')}`)
    await p.context().close()
  }
})

await test(`empty seats: ${empty.length} chairs without a creature, message, and no feedback button`, async () => {
  const p = await newPage(); await go(p)
  eq(await p.locator('.desk2d.empty').count(), empty.length, 'empty desks')
  eq(await p.locator('.desk2d:not(.empty) .creature').count(), valid.length, 'creatures only at valid desks')
  const ava = byName('Ava Goldberg'); eq(ava.urlStatus, 'invalid', 'file:/// link is invalid')
  await openDesk(p, ava.id)
  eq((await p.textContent('[data-testid=empty-message]')).trim(), "This project hasn't arrived yet!", 'message')
  eq(await p.locator('[data-testid=leave-thoughts]').count(), 0, 'no feedback button')
  eq(await p.locator('[data-testid=explore-link]').count(), 0, 'no project link for a file:/// URL')
  await shot(p, '03_empty_seat')
  await closeModal(p)
  await p.context().close()
})

await test('profile modal: creature details, validated project link opening in a new tab', async () => {
  const p = await newPage(); await go(p)
  const seen = new Set()
  for (const s of [valid[0], valid[12], valid[30]]) {
    await openDesk(p, s.id)
    eq(await p.textContent('[data-testid=profile-name]'), s.fullName, 'name')
    const cname = await p.textContent('[data-testid=creature-name]'); seen.add(cname)
    const a = p.locator('[data-testid=explore-link]')
    eq(await a.getAttribute('href'), new URL(s.url).href, 'href = roster URL')
    eq(await a.getAttribute('target'), '_blank', 'target')
    eq(await a.getAttribute('rel'), 'noopener noreferrer', 'rel')
    if (s === valid[0]) await shot(p, '04_profile_modal')
    await closeModal(p)
  }
  eq(seen.size, 3, 'different creatures')
  eq(await p.locator('iframe').count(), 0, 'student sites are never embedded')
  await p.context().close()
})

await test('feedback: sign-in, validation, preview wording, submit, progress 1 / 4, celebration', async () => {
  const p = await newPage(); await go(p)
  const reviewer = byName('Graham Fields'), target = byName('Antonia Rolo')
  await openDesk(p, target.id)
  await p.click('[data-testid=leave-thoughts]')
  await p.waitForSelector('[data-testid=signin-form]')
  await signIn(p, reviewer.id)
  await p.waitForSelector('[data-testid=feedback-form]')
  eq(await p.inputValue('[data-testid=fb-first]'), reviewer.firstName, 'first name from identity')
  eq(await p.inputValue('[data-testid=fb-last]'), reviewer.lastName, 'last name from identity')
  assert(await p.locator('[data-testid=fb-first]').getAttribute('readonly') !== null, 'name not editable')
  await p.fill('[data-testid=fb-q1]', 'nice'); await p.fill('[data-testid=fb-q2]', GOOD2)
  await p.click('[data-testid=fb-preview]')
  assert((await p.textContent('[data-testid=form-error]')).includes('Question 1'), 'too-short answer rejected')
  await p.fill('[data-testid=fb-q1]', 'This is stupid but the music is ok')
  await p.click('[data-testid=fb-preview]')
  assert((await p.textContent('[data-testid=form-error]')).toLowerCase().includes('kind'), 'unkind wording rejected')
  await p.fill('[data-testid=fb-q1]', GOOD1); await p.fill('[data-testid=fb-pronouns]', 'he/him')
  await p.click('[data-testid=fb-preview]')
  const preview = await p.textContent('[data-testid=preview-text]')
  eq(preview, 'Graham Fields loved the cozy cabin music and the snowy window animation. One suggestion was to add a button that lets visitors decorate the tree themselves.', 'composed paragraph')
  assert(!preview.includes('What did you enjoy'), 'questions not shown')
  await shot(p, '05_preview')
  await p.click('[data-testid=fb-submit]'); await p.waitForSelector('[data-testid=done]')
  eq((await p.textContent('[data-testid=done-progress]')).trim(), 'Your reviews: 1 / 4', 'done progress')
  eq((await p.textContent('[data-testid=my-progress]')).trim(), 'Your reviews: 1 / 4', 'header progress')
  await shot(p, '06_done')
  await closeModal(p)
  await openDesk(p, target.id)
  eq(await p.locator('[data-testid=comment]').count(), 1, 'comment shown')
  const c = await p.textContent('[data-testid=comment]')
  assert(c.includes('Graham Fields') && c.includes('(he/him)') && c.includes(preview), 'comment content')
  eq(await p.textContent('[data-testid=comment-count]'), '1 / 4', 'count')
  await shot(p, '07_comment')
  await p.context().close()
})

await test('self-review is blocked; duplicate becomes "edit"; editing keeps identity and slot; other reviewers cannot edit', async () => {
  const p = await newPage(); await go(p)
  const a = byName('Antonia Rolo'), b = byName('Daniel Sherry'), c = byName('Grace Costello')
  await p.click('[data-testid=header-signin]'); await signIn(p, a.id); await p.waitForSelector('[data-testid=me-chip]')
  await openDesk(p, a.id)
  assert(await p.locator('[data-testid=leave-thoughts]').isDisabled(), 'own project disabled')
  await p.waitForSelector('[data-testid=self-message]')
  await closeModal(p)
  await openDesk(p, b.id); await leaveFeedback(p); await closeModal(p)
  await openDesk(p, b.id)
  eq(await p.locator('[data-testid=leave-thoughts]').count(), 0, 'no second submission button')
  await p.click('[data-testid=edit-comment]')
  await p.fill('[data-testid=fb-q2]', 'Maybe add a short tutorial for first-time visitors.')
  await p.click('[data-testid=fb-preview]'); await p.click('[data-testid=fb-submit]'); await p.waitForSelector('[data-testid=done]')
  eq((await p.textContent('[data-testid=done-progress]')).trim(), 'Your reviews: 1 / 4', 'editing did not use a slot')
  await p.click('text=See the comments')
  eq(await p.locator('[data-testid=comment]').count(), 1, 'still one comment')
  const txt = await p.textContent('[data-testid=comment]')
  assert(txt.includes('Antonia Rolo') && txt.includes('short tutorial') && txt.includes('edited'), 'edited text, same reviewer')
  await closeModal(p)
  await p.click('[aria-label="Sign out"]')
  await p.click('[data-testid=header-signin]'); await signIn(p, c.id); await p.waitForSelector('[data-testid=me-chip]')
  await openDesk(p, b.id)
  eq(await p.locator('[data-testid=edit-comment]').count(), 0, "can't edit someone else's comment")
  await p.context().close()
})

await test('four-comment limit: 4th accepted, then "full" for everyone else', async () => {
  const p = await newPage(); await go(p)
  const target = byName('Emma Schonfeld')
  const reviewers = [byName('Zoe Labdon'), byName('Fiona Sheehan'), byName('Neve McHugh'), byName('Leah Goodman')]
  for (const r of reviewers) {
    await p.click('[data-testid=header-signin]'); await signIn(p, r.id); await p.waitForSelector('[data-testid=me-chip]')
    await openDesk(p, target.id); await leaveFeedback(p); await closeModal(p)
    await p.click('[aria-label="Sign out"]')
  }
  await p.click('[data-testid=header-signin]'); await signIn(p, byName('Mary McElroy').id); await p.waitForSelector('[data-testid=me-chip]')
  await openDesk(p, target.id)
  eq(await p.textContent('[data-testid=comment-count]'), '4 / 4', 'count')
  eq((await p.textContent('[data-testid=full-message]')).trim(), 'This desk is full of thoughtful feedback! Thank you for helping your classmates.', 'full message')
  assert(await p.locator('[data-testid=leave-thoughts]').isDisabled(), 'button disabled')
  eq(await p.locator('[data-testid=comment]').count(), 4, 'four comments displayed')
  await shot(p, '08_full_desk')
  await closeModal(p)
  eq(await p.locator(`[data-testid=desk-${target.id}] .review-dots.full`).count(), 1, 'desk shows full')
  await p.context().close()
})

await test('fair recommendation: never own/reviewed/full/empty; spreads reviewers across desks', async () => {
  const p = await newPage(); await go(p)
  const picks = []
  for (const r of S.slice(0, 8)) {
    await p.click('[data-testid=header-signin]'); await signIn(p, r.id); await p.waitForSelector('[data-testid=me-chip]')
    await p.click('[data-testid=find-world]'); await p.waitForSelector('[data-testid=profile-modal]')
    const name = await p.textContent('[data-testid=profile-name]')
    const s = byName(name); picks.push(s.id)
    assert(s.urlStatus === 'valid' && s.id !== r.id, `recommended ${name} for ${r.fullName}`)
    await closeModal(p); await p.click('[aria-label="Sign out"]')
  }
  eq(new Set(picks).size, picks.length, `distinct recommendations (${picks.join(',')})`)
  await p.context().close()
})

await test('search and section filter', async () => {
  const p = await newPage(); await go(p)
  await p.fill('[data-testid=search]', 'labdon')
  assert((await p.textContent('[data-testid=match-count]')).startsWith('1 seat matches'), 'one match')
  eq(await p.locator('.desk2d:not(.dim)').count(), 1, 'others dimmed')
  await p.fill('[data-testid=search]', '')
  await p.click('[data-testid=filter-02]')
  eq(await p.locator('.desk2d').count(), 30, 'section 02 only')
  await p.click('[data-testid=filter-01]')
  eq(await p.locator('.desk2d').count(), 28, 'section 01 only')
  await p.context().close()
})

await test('keyboard: Tab to a desk, Enter opens, focus trapped, Esc closes and returns focus', async () => {
  const p = await newPage(); await go(p)
  const first = S[0]
  await p.focus(`[data-testid=desk-${first.id}]`)
  await p.keyboard.press('Tab')
  const second = await p.evaluate(() => document.activeElement?.getAttribute('data-student'))
  eq(second, S[1].id, 'Tab moves to the next desk')
  await p.keyboard.press('Enter'); await p.waitForSelector('[data-testid=profile-modal]')
  for (let i = 0; i < 12; i++) await p.keyboard.press('Tab')
  assert(await p.evaluate(() => !!document.activeElement?.closest('[data-testid=profile-modal]')), 'focus stays in the modal')
  await p.keyboard.press('Escape')
  eq(await p.evaluate(() => document.activeElement?.getAttribute('data-student')), S[1].id, 'focus returned')
  await p.context().close()
})

await test('reduced motion: creature animations effectively off', async () => {
  const p = await newPage({ reducedMotion: 'reduce' }); await go(p)
  const durs = await p.$$eval('.creature .cr-root', (els) => els.slice(0, 10).map((e) => getComputedStyle(e).animationDuration))
  assert(durs.every((d) => parseFloat(d) < 0.01), `durations ${durs.join(',')}`)
  const motionClass = await p.locator('.creature[class*="idle-"]').count()
  eq(motionClass, 0, 'idle animation classes removed')
  await p.context().close()
})

await test('mobile (390×844): no horizontal scroll, 3 desks per row, modal fits', async () => {
  const p = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await go(p, '')
  eq(await p.locator('[data-testid=classroom-2d]').count(), 1, 'phones default to 2D')
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert(over <= 0, `horizontal overflow ${over}px`)
  const xs = await p.$$eval('.section2d.sec-01 .desk-cell', (els) => [...new Set(els.slice(0, 6).map((e) => Math.round(e.getBoundingClientRect().left)))].length)
  eq(xs, 3, 'three columns')
  await shot(p, '09_mobile')
  await p.click(`[data-testid=desk-${valid[0].id}]`); await p.waitForSelector('[data-testid=profile-modal]')
  const m = await p.locator('[data-testid=profile-modal]').boundingBox()
  assert(m.width <= 390 && m.x >= 0, 'modal within the screen')
  await shot(p, '10_mobile_modal')
  await p.context().close()
})

await test('3D classroom: 58 seats, creatures, camera rotate / zoom / pan / reset, hover + click', async () => {
  const p = await newPage(); await go(p, 'view=3d')
  await p.waitForFunction(() => window.__fic3d?.ready, null, { timeout: 30000 })
  const info = await p.evaluate(() => ({ seats: window.__fic3d.seats, creatures: window.__fic3d.creatures }))
  eq(info.seats, 58, 'seats'); eq(info.creatures, valid.length, 'creatures')
  await p.waitForTimeout(800)
  const cam0 = await p.evaluate(() => window.__fic3d.camera())
  const dist = (c, t) => Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2])
  const t0 = await p.evaluate(() => window.__fic3d.target())
  await p.click('[data-testid=cam-zoom-in]'); await p.waitForTimeout(1200)
  const cam1 = await p.evaluate(() => window.__fic3d.camera())
  assert(dist(cam1, t0) < dist(cam0, t0) - 1, 'zoom in moves closer')
  await p.click('[data-testid=cam-rot-l]'); await p.waitForTimeout(1200)
  const cam2 = await p.evaluate(() => window.__fic3d.camera())
  assert(Math.abs(cam2[0] - cam1[0]) > 1, 'rotate button orbits')
  const box = await p.locator('canvas').boundingBox()
  await p.mouse.move(box.x + 200, box.y + 500); await p.mouse.down(); await p.mouse.move(box.x + 420, box.y + 480, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(600)
  const cam3 = await p.evaluate(() => window.__fic3d.camera())
  assert(Math.hypot(cam3[0] - cam2[0], cam3[2] - cam2[2]) > 0.5, 'mouse drag rotates')
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.wheel(0, 600); await p.waitForTimeout(600)
  const cam4 = await p.evaluate(() => window.__fic3d.camera())
  assert(Math.abs(dist(cam4, await p.evaluate(() => window.__fic3d.target())) - dist(cam3, t0)) > 0.3, 'wheel zooms')
  const tBefore = await p.evaluate(() => window.__fic3d.target())
  await p.mouse.move(box.x + 700, box.y + 400); await p.mouse.down({ button: 'right' }); await p.mouse.move(box.x + 600, box.y + 380, { steps: 6 }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(500)
  const tAfter = await p.evaluate(() => window.__fic3d.target())
  assert(Math.hypot(tAfter[0] - tBefore[0], tAfter[2] - tBefore[2]) > 0.2, 'right-drag pans')
  await p.click('[data-testid=cam-reset]'); await p.waitForTimeout(2200)
  const camR = await p.evaluate(() => window.__fic3d.camera())
  assert(Math.hypot(camR[0] - cam0[0], camR[1] - cam0[1], camR[2] - cam0[2]) < 0.3, `reset returns home (${camR})`)
  // hover + click a specific creature
  const target = byName('Zoe Labdon')
  await p.fill('[data-testid=search]', 'Zoe'); await p.waitForTimeout(2200); await p.fill('[data-testid=search]', '')
  const pt = await p.evaluate((id) => window.__fic3d.project(id), target.id)
  await p.mouse.move(box.x + pt.x, box.y + pt.y); await p.waitForTimeout(700)
  eq(await p.evaluate(() => window.__fic3d.hovered), target.id, 'hovered creature')
  assert((await p.textContent('.tooltip')).includes('Zoe Labdon'), 'tooltip shows name')
  await shot(p, '11_3d_hover')
  await p.mouse.click(box.x + pt.x, box.y + pt.y); await p.waitForSelector('[data-testid=profile-modal]')
  eq(await p.textContent('[data-testid=profile-name]'), 'Zoe Labdon', 'clicked the right creature')
  await closeModal(p)
  await p.click('[data-testid=cam-reset]'); await p.waitForTimeout(2000)
  await shot(p, '12_3d_overview')
  await p.context().close()
})

await test('instructor dashboard: counts, shortfall, exports, moderation and demo reset', async () => {
  const p = await newPage(); await go(p)
  await p.click('[data-testid=header-signin]'); await signIn(p, byName('Hannah Natlo').id); await p.waitForSelector('[data-testid=me-chip]')
  await openDesk(p, byName('Leah Goodman').id); await leaveFeedback(p, 'I liked the brain regions you can click on.', 'Add a quiz at the end to test what we learned.'); await closeModal(p)
  await p.goto(`${BASE}?nowelcome#/instructor`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid=instructor]')
  const kpi = async (k) => (await p.textContent(`[data-testid=kpi-${k}] strong`)).trim()
  eq(await kpi('students'), '58', 'students'); eq(await kpi('submitted-projects'), String(valid.length), 'submitted')
  eq(await kpi('missing-projects'), String(S.filter((s) => s.urlStatus === 'missing').length), 'missing')
  eq(await kpi('invalid-links'), String(S.filter((s) => s.urlStatus === 'invalid').length), 'invalid'); eq(await kpi('comments'), '1', 'comments')
  const sf = await p.textContent('[data-testid=structural-shortfall]')
  assert(sf.includes(String(valid.length * 4)) && sf.includes(String(232 - valid.length * 4)), `shortfall text: ${sf}`)
  await shot(p, '13_instructor')
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=export-completion]')])
  const csv = readFileSync(await dl.path(), 'utf8').trim().split('\n')
  eq(csv.length, 59, 'completion CSV rows (header + 58)')
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=export-feedback]')])
  const fb = readFileSync(await dl2.path(), 'utf8')
  assert(fb.includes('Hannah Natlo') && fb.includes('brain regions'), 'feedback CSV has the record')
  p.once('dialog', (d) => d.accept('Test removal'))
  await p.click('[data-testid=mod-remove]'); await p.waitForTimeout(400)
  eq(await kpi('comments'), '0', 'removed comment no longer counted')
  await p.click('[data-testid=reset-demo]'); await p.click('[data-testid=reset-demo-confirm]'); await p.waitForTimeout(300)
  eq(await p.locator('[data-testid=mod-item]').count(), 0, 'demo data reset')
  eq(await p.evaluate(() => localStorage.getItem('fic.demo.state.v1')), null, 'storage cleared')
  if (existsSync('Take-Home Exam.xlsx')) {
    await p.setInputFiles('[data-testid=roster-file]', 'Take-Home Exam.xlsx')
    await p.waitForSelector('[data-testid=import-preview]')
    const t = await p.textContent('[data-testid=import-preview]')
    assert(t.includes('58 students') && t.includes('0 new') && t.includes('0 link changes'), `re-import preview: ${t.slice(0, 120)}`)
  }
  await p.context().close()
})

await test('student guide: 8 numbered steps, no installation or code', async () => {
  const p = await newPage(); await p.goto(`${BASE}?nowelcome#/guide`, { waitUntil: 'networkidle' })
  eq(await p.locator('.step').count(), 8, 'steps')
  const t = (await p.textContent('main')).toLowerCase()
  for (const w of ['install', 'code editor', 'terminal', 'github', 'url', 'browser storage']) assert(!t.includes(w), `guide mentions "${w}"`)
  await shot(p, '14_guide')
  await p.context().close()
})

await test('no page errors or console errors during the run', async () => {
  eq(pageErrors.length, 0, `errors: ${pageErrors.slice(0, 3).join(' | ')}`)
})

await browser.close(); stopServer()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
