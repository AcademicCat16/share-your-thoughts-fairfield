/**
 * Optional ambient sound — OFF by default, only starts after the visitor presses the button.
 * Synthesised with Web Audio (no audio files): a very soft warm pad plus an occasional gentle chime.
 */
let ctx: AudioContext | null = null
let master: GainNode | null = null
let timer = 0
const nodes: AudioScheduledSourceNode[] = []

export function soundOn(): boolean { return !!ctx && ctx.state === 'running' }

export async function startAmbient() {
  if (ctx) { await ctx.resume(); return }
  ctx = new AudioContext()
  master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination)
  master.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2)
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.connect(master)
  for (const f of [196, 246.94, 293.66, 392]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f
    const g = ctx.createGain(); g.gain.value = 0.22
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.08
    const lg = ctx.createGain(); lg.gain.value = 0.12; lfo.connect(lg); lg.connect(g.gain)
    o.connect(g); g.connect(filter); o.start(); lfo.start(); nodes.push(o, lfo)
  }
  const chime = () => {
    if (!ctx || !master) return
    const notes = [587.33, 659.25, 783.99, 880, 987.77]
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = notes[Math.floor(Math.random() * notes.length)]
    const g = ctx.createGain(); g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.5)
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + 2.6)
    timer = window.setTimeout(chime, 5000 + Math.random() * 7000)
  }
  timer = window.setTimeout(chime, 2500)
}

export function stopAmbient() {
  clearTimeout(timer)
  nodes.forEach((n) => { try { n.stop() } catch { /* already stopped */ } })
  nodes.length = 0
  ctx?.close(); ctx = null; master = null
}
