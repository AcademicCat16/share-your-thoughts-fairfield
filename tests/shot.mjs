// Screenshot helper for visual inspection:  node tests/shot.mjs <name> <hash-route> [width] [height] [script]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const [name = 'home', route = '', w = '1440', h = '900', extra = ''] = process.argv.slice(2)
mkdirSync('tests/output', { recursive: true })
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: +w, height: +h } })
const errors = []
p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await p.goto(`http://localhost:4310/share-your-thoughts-fairfield/?nowelcome${route.startsWith('?') ? '&' + route.slice(1) : ''}${route.startsWith('#') ? route : ''}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
if (extra) await new Function('p', `return (async () => { ${extra} })()`)(p)
await p.screenshot({ path: `tests/output/${name}.png` })
console.log(JSON.stringify({ errors, fic3d: await p.evaluate(() => window.__fic3d ? { seats: window.__fic3d.seats, creatures: window.__fic3d.creatures, draw: window.__fic3d.drawCalls() } : null) }))
await b.close()
