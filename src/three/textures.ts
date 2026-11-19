import * as THREE from 'three'

export const FONT = '"Fredoka", "Nunito", system-ui, sans-serif'

/** Fit text into maxWidth by shrinking the font. Returns the font size used. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, weight = 600): number {
  let size = start
  do { ctx.font = `${weight} ${size}px ${FONT}`; if (ctx.measureText(text).width <= maxWidth) break; size -= 2 } while (size > 10)
  return size
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

function toTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** Folded desk name plate face: first name large, last name below, section small. */
export function namePlateTexture(first: string, last: string, section: string, tint: string, empty: boolean) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 200
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fffdf7'; roundRect(ctx, 4, 4, 632, 192, 26); ctx.fill()
  ctx.fillStyle = tint; roundRect(ctx, 4, 4, 632, 26, 14); ctx.fill(); ctx.fillRect(4, 18, 632, 12)
  ctx.strokeStyle = 'rgba(80,60,110,.25)'; ctx.lineWidth = 4; roundRect(ctx, 4, 4, 632, 192, 26); ctx.stroke()
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillStyle = '#3b2e5a'
  fitText(ctx, first, 580, 74, 600); ctx.fillText(first, 320, 86)
  ctx.fillStyle = '#5b4d7a'
  fitText(ctx, last, 580, 50, 500); ctx.fillText(last, 320, 145)
  ctx.font = `600 22px ${FONT}`; ctx.fillStyle = empty ? '#b0758a' : 'rgba(59,46,90,.55)'
  ctx.fillText(empty ? `${section} · project on its way` : section, 320, 181)
  return toTexture(c)
}

export function bannerTexture(lines: { text: string; size: number; color: string; weight?: number }[], w: number, h: number, bg: string | null, border?: string) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  if (bg) { ctx.fillStyle = bg; roundRect(ctx, 6, 6, w - 12, h - 12, 36); ctx.fill() }
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 10; roundRect(ctx, 6, 6, w - 12, h - 12, 36); ctx.stroke() }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const total = lines.reduce((a, l) => a + l.size * 1.25, 0)
  let y = h / 2 - total / 2
  for (const l of lines) {
    fitText(ctx, l.text, w - 80, l.size, l.weight ?? 600)
    ctx.fillStyle = l.color; y += l.size * 0.625; ctx.fillText(l.text, w / 2, y); y += l.size * 0.625
  }
  return toTexture(c)
}

export function skyTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#9fd8ff'); g.addColorStop(0.7, '#d9f1ff'); g.addColorStop(1, '#fff3d6')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256)
  ctx.fillStyle = 'rgba(255,255,255,.95)'
  for (const [x, y, r] of [[60, 70, 22], [86, 62, 28], [112, 72, 20], [180, 130, 18], [200, 122, 24], [222, 132, 16]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill() }
  ctx.fillStyle = '#a8d5a2'; ctx.beginPath(); ctx.ellipse(70, 262, 120, 50, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#8fcb8b'; ctx.beginPath(); ctx.ellipse(210, 268, 110, 44, 0, 0, Math.PI * 2); ctx.fill()
  return toTexture(c)
}

export function floorTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512
  const ctx = c.getContext('2d')!
  const tones = ['#f3dcc0', '#efd4b4', '#f6e2c9', '#eed1ae']
  for (let i = 0; i < 8; i++) { ctx.fillStyle = tones[i % 4]; ctx.fillRect(0, i * 64, 512, 64); ctx.fillStyle = 'rgba(160,110,70,.12)'; ctx.fillRect(0, i * 64, 512, 2); ctx.fillRect(((i * 197) % 400) + 40, i * 64, 2, 64) }
  const t = toTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 5)
  return t
}

export function softShadowTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62); g.addColorStop(0, 'rgba(70,45,90,.35)'); g.addColorStop(1, 'rgba(70,45,90,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
  return toTexture(c)
}
