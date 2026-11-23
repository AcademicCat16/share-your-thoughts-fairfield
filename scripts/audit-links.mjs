/**
 * Browser-level audit of every interactive project link (both courses).
 *
 *   npm run audit-links                 # all 86 entries
 *   npm run audit-links -- --only pm-03,s02-07
 *
 * For each submitted link: syntax, whitespace, HTTPS, redirects (followed one hop at a time, https/public hosts only),
 * HTTP status, obvious 404 / "GitHub Pages site not found" pages, then a real Chrome visit (fresh, isolated
 * profile; nothing is downloaded or installed) checking that something visibly renders and recording page errors.
 * Bounded concurrency (4), 30 s per page. Student repositories are never cloned or run outside the browser sandbox.
 *
 * Writes:  src/data/link_audit.json, docs/FINAL_PROJECT_LINK_AUDIT.md, link status into src/data/roster.json and
 *          private/roster_full.json, thumbnails in tests/output/audit/ (git-ignored; look at them).
 * Only links whose verdict is "working" can receive reviews.
 */
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const args = process.argv.slice(2)
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null })()
const FULL = 'private/roster_full.json'
const PUB = 'src/data/roster.json'
const AUDIT = 'src/data/link_audit.json'
const SHOTS = 'tests/output/audit'
mkdirSync(SHOTS, { recursive: true }); mkdirSync('docs', { recursive: true })

const roster = JSON.parse(readFileSync(existsSync(FULL) ? FULL : PUB, 'utf8'))
const prevAudit = existsSync(AUDIT) ? JSON.parse(readFileSync(AUDIT, 'utf8')) : { results: {} }
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?)$/i
const NOT_FOUND = [
  /There isn't a GitHub Pages site here/i, /404\s*[-–|:]?\s*File not found/i, /^\s*404\b/m, /Page not found/i,
  /Site not found/i, /DEPLOYMENT_NOT_FOUND/i, /This page could not be found/i, /does not exist/i,
]
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36 FairfieldClassroomLinkAudit'

/** HTTP pass: follow redirects manually so every hop can be checked. */
async function httpCheck(url) {
  const hops = []
  let cur = url
  for (let i = 0; i < 6; i++) {
    let u
    try { u = new URL(cur) } catch { return { ok: false, hops, error: `Redirected to an invalid address: ${cur}` } }
    if (u.protocol !== 'https:') return { ok: false, hops, error: `Not HTTPS (${u.protocol}//${u.host})` }
    if (PRIVATE_HOST.test(u.hostname)) return { ok: false, hops, error: 'Points to a private or local address.' }
    let res
    try {
      res = await fetch(cur, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,*/*' }, signal: AbortSignal.timeout(20000) })
    } catch (e) { return { ok: false, hops, error: `Could not connect (${e.cause?.code ?? e.name ?? 'network error'})` } }
    hops.push({ url: cur, status: res.status })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), cur)
      // Keep the original #fragment (servers never see it; a browser keeps it across redirects).
      if (!next.hash && new URL(url).hash) next.hash = new URL(url).hash
      cur = next.href; await res.body?.cancel(); continue
    }
    const text = (await res.text().catch(() => '')).slice(0, 200_000)
    return { ok: res.status >= 200 && res.status < 300, status: res.status, finalUrl: cur, hops, html: text }
  }
  return { ok: false, hops, error: 'Too many redirects.' }
}

const browser = await chromium.launch({ channel: process.env.AUDIT_CHANNEL || 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

async function browserCheck(id, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA, acceptDownloads: false, serviceWorkers: 'block', permissions: [] })
  const page = await ctx.newPage()
  const errors = []; const failed = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
  page.on('requestfailed', (r) => { if (['document', 'script', 'stylesheet'].includes(r.resourceType())) failed.push(`${r.resourceType()} ${r.url().slice(0, 120)}`) })
  page.on('dialog', (d) => d.dismiss().catch(() => {}))
  let status = null; let finalUrl = url; let gotoError = null
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 })
    status = resp?.status() ?? null
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(2500)
    finalUrl = page.url()
  } catch (e) { gotoError = String(e.message).split('\n')[0] }
  let seen = { text: 0, visuals: 0, title: '', snippet: '', bigVisible: 0 }
  if (!gotoError) {
    seen = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 8 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 }
      const visuals = [...document.querySelectorAll('canvas,img,svg,video,iframe,picture')].filter(vis).length
      const big = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return vis(el) && r.width * r.height > vw * vh * 0.04 && r.top < vh && r.bottom > 0 }).length
      const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim()
      return { text: text.length, visuals, title: document.title.slice(0, 120), snippet: text.slice(0, 160), bigVisible: big }
    }).catch(() => seen)
    await page.screenshot({ path: `${SHOTS}/${id}.png` }).catch(() => {})
  }
  await ctx.close()
  return { status, finalUrl, gotoError, errors: [...new Set(errors)].slice(0, 5), failed: failed.slice(0, 5), ...seen }
}

function verdict(s, h, b) {
  if (s.urlStatus === 'missing') return { status: 'missing', note: 'No interactive website link was submitted.' }
  if (s.urlStatus === 'invalid') return { status: 'broken', note: s.urlNote }
  if (!h.ok && h.error) return { status: 'broken', note: h.error }
  const notFoundText = NOT_FOUND.some((re) => re.test(`${b.title}\n${b.snippet}`)) && b.text < 400
  if (h.status === 404 || notFoundText) {
    const gh = /github\.io$/i.test(new URL(h.finalUrl ?? s.url).hostname)
    return { status: 'broken', note: gh ? 'GitHub Pages returns "404 — not found" (the site is not published at this address, or the repository/path name differs).' : `The page reports "not found" (HTTP ${h.status ?? b.status}).` }
  }
  if (!h.ok) return { status: 'broken', note: `HTTP ${h.status}.` }
  if (b.gotoError) return { status: 'broken', note: `Chrome could not load the page: ${b.gotoError}` }
  const rendered = b.text >= 40 || b.visuals > 0 || b.bigVisible >= 2
  if (!rendered) return { status: 'broken', note: `The page loads but shows nothing visible${b.errors.length ? ` (JavaScript error: ${b.errors[0]})` : ''}${b.failed.length ? ` (failed to load: ${b.failed[0]})` : ''}.` }
  const extras = [b.errors.length ? `${b.errors.length} JavaScript error(s) reported, but the page renders` : '', b.failed.length ? `${b.failed.length} file(s) failed to load` : ''].filter(Boolean)
  return { status: 'working', note: `Renders (${b.text} characters of text, ${b.visuals} images/canvases)${extras.length ? `; ${extras.join('; ')}` : ''}.` }
}

const todo = roster.students.filter((s) => !only || only.has(s.id))
const results = { ...(only ? prevAudit.results : {}) }
let idx = 0
async function worker() {
  while (idx < todo.length) {
    const s = todo[idx++]
    let h = { ok: false, hops: [] }, b = { errors: [], failed: [], text: 0, visuals: 0, bigVisible: 0, title: '', snippet: '' }
    if (s.urlStatus === 'valid') {
      h = await httpCheck(s.url)
      if (h.ok || h.status === 404) b = await browserCheck(s.id, s.url)
    }
    const v = verdict(s, h, b)
    results[s.id] = {
      id: s.id, name: s.fullName, course: s.courseCode, section: s.sectionCode, originalUrl: s.url,
      resolvedUrl: b.finalUrl ?? h.finalUrl ?? null, httpStatus: h.status ?? null, redirects: (h.hops ?? []).length - 1,
      title: b.title || null, textLength: b.text, visuals: b.visuals, jsErrors: b.errors, failedLoads: b.failed,
      status: v.status, note: v.note, checkedAt: new Date().toISOString(),
    }
    console.log(`${v.status.padEnd(8)} ${s.id.padEnd(7)} ${s.fullName.padEnd(24)} ${v.note}`)
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
await browser.close()

const checkedAt = new Date().toISOString()
writeFileSync(AUDIT, JSON.stringify({ checkedAt, results }, null, 2) + '\n')

// Write link status into both rosters (only if the audited URL is still the roster's URL).
for (const file of [FULL, PUB]) {
  if (!existsSync(file)) continue
  const r = JSON.parse(readFileSync(file, 'utf8'))
  for (const s of r.students) {
    const a = results[s.id]
    if (!a || s.hidden || a.originalUrl !== s.url || s.urlStatus !== 'valid') { if (s.urlStatus !== 'valid') s.link = { status: 'unchecked' }; continue }
    s.link = { status: a.status === 'working' ? 'working' : 'broken', checkedAt: a.checkedAt, resolvedUrl: a.resolvedUrl ?? undefined, note: a.note }
  }
  writeFileSync(file, JSON.stringify(r, null, 2) + '\n')
}

// Markdown report.
const all = Object.values(results).sort((a, b) => a.id.localeCompare(b.id))
const esc = (x) => String(x ?? '').replace(/\|/g, '\\|')
const count = (course, st) => all.filter((r) => r.course === course && r.status === st).length
const md = [
  '# Final project link audit', '',
  `Run with \`npm run audit-links\` on ${checkedAt.slice(0, 16).replace('T', ' ')} UTC, from a Windows 11 machine in Chrome (Playwright, isolated profile, 30-second limit per page, four pages at a time).`, '',
  'Each link was checked for syntax and surrounding whitespace, fetched over HTTPS with redirects followed one hop at a time (public HTTPS hosts only), checked for its HTTP status and for "not found" pages (including GitHub Pages\' "There isn\'t a GitHub Pages site here"), then opened in Chrome to confirm that something visibly renders. JavaScript errors were recorded. Nothing from the students\' repositories was downloaded or run outside the browser. Any public HTTPS host is accepted (GitHub Pages, Netlify, Vercel, …).', '',
  '**Only links marked *working* can receive reviews.** Missing and broken projects keep their desk and name tag with an empty chair; those students can still review classmates.', '',
  '## Summary', '',
  '| Course | Entries | Working | Broken | Missing |', '|---|---:|---:|---:|---:|',
  ...['MKTG 1101', 'MKTG 2241'].map((c) => `| ${c} | ${all.filter((r) => r.course === c).length} | ${count(c, 'working')} | ${count(c, 'broken')} | ${count(c, 'missing')} |`),
  `| **All** | **${all.length}** | **${all.filter((r) => r.status === 'working').length}** | **${all.filter((r) => r.status === 'broken').length}** | **${all.filter((r) => r.status === 'missing').length}** |`, '',
  '## Every entry', '',
  '| Student | Course | Section | Original URL | Resolved URL | Result | Explanation |', '|---|---|---|---|---|---|---|',
  ...all.map((r) => `| ${esc(r.name)} | ${r.course} | ${r.section} | ${r.originalUrl ? `\`${esc(r.originalUrl)}\`` : '—'} | ${r.resolvedUrl && r.resolvedUrl !== r.originalUrl ? `\`${esc(r.resolvedUrl)}\`` : r.resolvedUrl ? 'same' : '—'} | **${r.status}** | ${esc(r.note)} |`), '',
  'The thumbnails taken during the audit are in `tests/output/audit/` on the instructor\'s computer (not published).', '',
]
writeFileSync('docs/FINAL_PROJECT_LINK_AUDIT.md', md.join('\n'))
console.log(`\nWorking ${all.filter((r) => r.status === 'working').length} · broken ${all.filter((r) => r.status === 'broken').length} · missing ${all.filter((r) => r.status === 'missing').length}. Wrote ${AUDIT} and docs/FINAL_PROJECT_LINK_AUDIT.md`)
