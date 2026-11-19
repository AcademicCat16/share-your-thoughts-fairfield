/**
 * Draws one original classroom mascot from its parameters (shared/creatures.ts). Pure SVG + CSS animation.
 * viewBox 200×200; the creature sits so that its lower body can be hidden behind a desk.
 */
import { memo, type CSSProperties, type ReactElement } from 'react'
import type { CreatureSpec, Body, Ears, Tail } from '../../shared/creatureTypes.ts'

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)))
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`
}

interface Shape { d: string; top: number; left: number; right: number; eyeY: number; neckY: number }
const SHAPES: Record<Body, Shape> = {
  round: { d: 'M100 48 C140 48 164 78 164 116 C164 156 136 184 100 184 C64 184 36 156 36 116 C36 78 60 48 100 48 Z', top: 52, left: 38, right: 162, eyeY: 100, neckY: 140 },
  pear: { d: 'M100 46 C128 46 146 66 148 92 C150 112 170 132 170 156 C170 178 140 188 100 188 C60 188 30 178 30 156 C30 132 50 112 52 92 C54 66 72 46 100 46 Z', top: 50, left: 40, right: 160, eyeY: 92, neckY: 128 },
  bean: { d: 'M96 50 C134 44 166 70 164 110 C162 150 140 186 100 186 C60 186 34 160 38 120 C40 98 50 88 56 76 C64 60 78 52 96 50 Z', top: 52, left: 40, right: 162, eyeY: 100, neckY: 140 },
  tall: { d: 'M100 34 C134 34 150 62 150 100 L150 150 C150 174 130 188 100 188 C70 188 50 174 50 150 L50 100 C50 62 66 34 100 34 Z', top: 38, left: 52, right: 148, eyeY: 86, neckY: 126 },
  blob: { d: 'M100 56 C146 52 172 88 170 126 C168 150 176 168 162 180 C146 192 128 180 114 188 C100 194 86 182 70 188 C50 194 30 176 32 152 C34 134 28 118 34 100 C42 74 66 58 100 56 Z', top: 60, left: 36, right: 166, eyeY: 108, neckY: 146 },
  square: { d: 'M66 50 L134 50 C152 50 162 60 162 78 L162 158 C162 176 152 186 134 186 L66 186 C48 186 38 176 38 158 L38 78 C38 60 48 50 66 50 Z', top: 52, left: 40, right: 160, eyeY: 98, neckY: 138 },
}

function ear(type: Ears, x: number, y: number, side: 1 | -1, c: string, a: string, o: string): ReactElement | null {
  const t = `translate(${x} ${y}) scale(${side} 1)`
  switch (type) {
    case 'cat': return <g transform={t}><path d="M-16 6 L-4 -30 L14 2 Z" fill={c} stroke={o} strokeWidth="3" strokeLinejoin="round" /><path d="M-9 2 L-4 -18 L6 0 Z" fill={a} /></g>
    case 'bunny': return <g transform={`${t} rotate(-8)`}><ellipse cx="0" cy="-30" rx="11" ry="34" fill={c} stroke={o} strokeWidth="3" /><ellipse cx="0" cy="-28" rx="5" ry="24" fill={a} /></g>
    case 'round': return <g transform={t}><circle cx="0" cy="-8" r="16" fill={c} stroke={o} strokeWidth="3" /><circle cx="0" cy="-8" r="8" fill={a} /></g>
    case 'leaf': return <g transform={`${t} rotate(-20)`}><path d="M0 4 C-18 -10 -14 -34 0 -46 C14 -34 18 -10 0 4 Z" fill={a} stroke={o} strokeWidth="3" /><path d="M0 2 L0 -38" stroke={o} strokeWidth="2" opacity=".5" /></g>
    case 'flame': return <g transform={t}><path d="M-12 6 C-20 -8 -8 -18 -6 -34 C2 -24 4 -30 6 -40 C16 -26 20 -10 12 6 Z" fill={a} stroke={o} strokeWidth="3" strokeLinejoin="round" /><path d="M-4 4 C-8 -4 -2 -10 0 -18 C6 -10 8 -4 4 4 Z" fill="#fff3b0" /></g>
    case 'fin': return side === 1 ? <g transform={`translate(100 ${y - 4})`}><path d="M-18 8 C-12 -18 6 -34 22 -36 C14 -20 14 -4 20 8 Z" fill={a} stroke={o} strokeWidth="3" strokeLinejoin="round" /></g> : null
    case 'antenna': return <g transform={`${t} rotate(-14)`}><path d="M0 4 L0 -30" stroke={o} strokeWidth="3" strokeLinecap="round" /><circle cx="0" cy="-34" r="7" fill={a} stroke={o} strokeWidth="3" /></g>
    case 'horns': return <g transform={t}><path d="M-8 4 C-12 -12 -4 -24 8 -28 C2 -18 4 -8 8 2 Z" fill={a} stroke={o} strokeWidth="3" strokeLinejoin="round" /></g>
    case 'crystal': return <g transform={`${t} rotate(-12)`}><path d="M-10 6 L-6 -26 L2 -40 L10 -24 L10 6 Z" fill={a} stroke={o} strokeWidth="3" strokeLinejoin="round" /><path d="M2 -40 L0 0" stroke="#fff" strokeWidth="2" opacity=".7" /></g>
    case 'puff': return <g transform={t}><circle cx="-6" cy="-8" r="12" fill="#fff" stroke={o} strokeWidth="3" /><circle cx="8" cy="-16" r="10" fill="#fff" stroke={o} strokeWidth="3" /><circle cx="6" cy="-4" r="8" fill="#fff" /></g>
    case 'droop': return <g transform={`translate(${side === 1 ? x + 14 : x - 14} ${y + 26}) scale(${side} 1) rotate(18)`}><ellipse cx="0" cy="10" rx="12" ry="28" fill={a} stroke={o} strokeWidth="3" /></g>
    default: return null
  }
}

function tail(type: Tail, x: number, y: number, a: string, o: string): ReactElement | null {
  const t = `translate(${x} ${y})`
  switch (type) {
    case 'flame': return <g transform={t}><g className="cr-tail"><path d="M0 0 C18 -4 26 -22 22 -40 C32 -30 40 -14 34 4 C28 18 8 16 0 8 Z" fill={a} stroke={o} strokeWidth="3" strokeLinejoin="round" /></g></g>
    case 'leaf': return <g transform={t}><g className="cr-tail"><path d="M0 0 C24 -10 40 -30 42 -48 C20 -44 4 -26 0 0 Z" fill={a} stroke={o} strokeWidth="3" /></g></g>
    case 'fish': return <g transform={t}><g className="cr-tail"><path d="M0 0 L26 -8 L40 -26 L38 6 L40 26 L26 10 Z" fill={a} stroke={o} strokeWidth="3" strokeLinejoin="round" /></g></g>
    case 'bolt': return <g transform={t}><g className="cr-tail"><path d="M0 0 L18 -10 L12 -18 L34 -36 L24 -16 L32 -12 L8 8 Z" fill="#ffe066" stroke={o} strokeWidth="3" strokeLinejoin="round" /></g></g>
    case 'swirl': return <g transform={t}><g className="cr-tail"><path d="M0 0 C20 -2 34 -18 30 -32 C26 -44 10 -42 10 -32 C10 -24 20 -24 20 -30" fill="none" stroke={a} strokeWidth="9" strokeLinecap="round" /></g></g>
    case 'puff': return <g transform={t}><g className="cr-tail"><circle cx="14" cy="-8" r="15" fill="#fff" stroke={o} strokeWidth="3" /><circle cx="26" cy="-20" r="9" fill="#fff" stroke={o} strokeWidth="3" /></g></g>
    case 'star': return <g transform={t}><g className="cr-tail"><path d="M0 0 C12 -6 18 -14 22 -24" stroke={o} strokeWidth="3" fill="none" /><path d="M22 -42 L27 -30 L40 -30 L30 -22 L34 -10 L22 -17 L10 -10 L14 -22 L4 -30 L17 -30 Z" fill="#ffe7a3" stroke={o} strokeWidth="2.5" strokeLinejoin="round" /></g></g>
    case 'gear': return <g transform={`${t} translate(22 -16)`}><g className="cr-tail cr-gear"><circle r="15" fill={a} stroke={o} strokeWidth="3" strokeDasharray="7 4" /><circle r="12" fill={a} /><circle r="5" fill="#fff" stroke={o} strokeWidth="2" /></g></g>
    default: return null
  }
}

function Eyes({ type, y, o }: { type: CreatureSpec['look']['eyes']; y: number; o: string }) {
  const xs = [78, 122]
  const one = (x: number, k: number) => {
    switch (type) {
      case 'sleepy': return <path key={k} d={`M${x - 10} ${y} Q${x} ${y + 8} ${x + 10} ${y}`} stroke={o} strokeWidth="4" fill="none" strokeLinecap="round" />
      case 'happy': return <path key={k} d={`M${x - 10} ${y + 4} Q${x} ${y - 8} ${x + 10} ${y + 4}`} stroke={o} strokeWidth="4" fill="none" strokeLinecap="round" />
      case 'sparkle': return <g key={k}><ellipse cx={x} cy={y} rx="11" ry="13" fill="#2d2440" /><circle cx={x + 4} cy={y - 5} r="4.5" fill="#fff" /><circle cx={x - 4} cy={y + 5} r="2" fill="#fff" /><path d={`M${x + 8} ${y + 3} l1.5 3 l3 1.5 l-3 1.5 l-1.5 3 l-1.5 -3 l-3 -1.5 l3 -1.5 Z`} fill="#fff" /></g>
      case 'wide': return <g key={k}><ellipse cx={x} cy={y} rx="12" ry="12" fill="#fff" stroke={o} strokeWidth="2.5" /><circle cx={x + 1} cy={y + 1} r="6" fill="#2d2440" /><circle cx={x + 3} cy={y - 2} r="2" fill="#fff" /></g>
      default: return <g key={k}><ellipse cx={x} cy={y} rx="8" ry="10" fill="#2d2440" /><circle cx={x + 3} cy={y - 4} r="3" fill="#fff" /></g>
    }
  }
  return <g className="cr-eyes">{xs.map(one)}</g>
}

function Mouth({ type, y, o }: { type: CreatureSpec['look']['mouth']; y: number; o: string }) {
  switch (type) {
    case 'open': return <path d={`M90 ${y} Q100 ${y + 18} 110 ${y} Z`} fill="#c2416b" stroke={o} strokeWidth="2.5" strokeLinejoin="round" />
    case 'cat': return <path d={`M88 ${y} Q94 ${y + 7} 100 ${y} Q106 ${y + 7} 112 ${y}`} stroke={o} strokeWidth="3" fill="none" strokeLinecap="round" />
    case 'grin': return <g><path d={`M84 ${y - 2} Q100 ${y + 16} 116 ${y - 2} Z`} fill="#fff" stroke={o} strokeWidth="2.5" strokeLinejoin="round" /></g>
    default: return <path d={`M90 ${y} Q100 ${y + 9} 110 ${y}`} stroke={o} strokeWidth="3" fill="none" strokeLinecap="round" />
  }
}

function Accessory({ type, s, accent, o }: { type: CreatureSpec['look']['accessory']; s: Shape; accent: string; o: string }) {
  const n = s.neckY; const top = s.top; const ey = s.eyeY
  switch (type) {
    case 'scarf': return <g><path d={`M${s.left + 14} ${n} Q100 ${n + 18} ${s.right - 14} ${n} L${s.right - 16} ${n + 14} Q100 ${n + 32} ${s.left + 16} ${n + 14} Z`} fill="#ff8fab" stroke={o} strokeWidth="3" /><path d={`M${s.right - 40} ${n + 16} l6 34 l14 -4 l-4 -30 Z`} fill="#ff8fab" stroke={o} strokeWidth="3" /><path d={`M${s.left + 24} ${n + 8} L${s.right - 24} ${n + 8}`} stroke="#fff" strokeWidth="3" strokeDasharray="6 8" opacity=".8" /></g>
    case 'bowtie': return <g transform={`translate(100 ${n + 6})`}><path d="M0 0 L-20 -12 L-20 12 Z M0 0 L20 -12 L20 12 Z" fill={accent} stroke={o} strokeWidth="3" strokeLinejoin="round" /><circle r="5" fill={shade(accent, -0.2)} stroke={o} strokeWidth="2" /></g>
    case 'flower': return <g transform={`translate(${s.right - 26} ${top + 14})`}>{[0, 72, 144, 216, 288].map((r) => <ellipse key={r} cx="0" cy="-9" rx="6" ry="9" fill="#ffc8dd" stroke={o} strokeWidth="2" transform={`rotate(${r})`} />)}<circle r="5" fill="#ffd166" stroke={o} strokeWidth="2" /></g>
    case 'goggles': return <g transform={`translate(100 ${top + 22})`}><path d={`M${s.left - 100 + 6} 4 L${s.right - 100 - 6} 4`} stroke={o} strokeWidth="5" /><circle cx="-18" cy="2" r="12" fill="#bde0fe" stroke={o} strokeWidth="3.5" /><circle cx="18" cy="2" r="12" fill="#bde0fe" stroke={o} strokeWidth="3.5" /><circle cx="-22" cy="-2" r="3" fill="#fff" /><circle cx="14" cy="-2" r="3" fill="#fff" /></g>
    case 'leafhat': return <g transform={`translate(100 ${top + 2})`}><path d="M-30 4 C-24 -18 24 -18 30 4 Z" fill="#95d5b2" stroke={o} strokeWidth="3" /><path d="M0 -12 C6 -26 18 -30 24 -28 C20 -18 10 -12 0 -12 Z" fill="#52b788" stroke={o} strokeWidth="2.5" /></g>
    case 'crown': return <g transform={`translate(100 ${top - 2})`}><path d="M-22 6 L-24 -16 L-11 -4 L0 -20 L11 -4 L24 -16 L22 6 Z" fill="#ffd166" stroke={o} strokeWidth="3" strokeLinejoin="round" /><circle cx="0" cy="-2" r="3.5" fill="#ff8fab" /></g>
    case 'glasses': return <g transform={`translate(100 ${ey})`} fill="none" stroke={o} strokeWidth="3.5"><circle cx="-22" cy="0" r="15" fill="rgba(255,255,255,.25)" /><circle cx="22" cy="0" r="15" fill="rgba(255,255,255,.25)" /><path d="M-7 -2 Q0 -6 7 -2" /></g>
    case 'headphones': return <g><path d={`M${s.left + 6} ${ey - 4} C${s.left + 6} ${top - 26} ${s.right - 6} ${top - 26} ${s.right - 6} ${ey - 4}`} fill="none" stroke={o} strokeWidth="6" strokeLinecap="round" /><rect x={s.left - 6} y={ey - 18} width="18" height="30" rx="8" fill={accent} stroke={o} strokeWidth="3" /><rect x={s.right - 12} y={ey - 18} width="18" height="30" rx="8" fill={accent} stroke={o} strokeWidth="3" /></g>
    case 'beanie': return <g transform={`translate(100 ${top + 6})`}><path d="M-44 8 C-44 -32 44 -32 44 8 Z" fill="#a0c4ff" stroke={o} strokeWidth="3" /><rect x="-46" y="2" width="92" height="12" rx="6" fill="#cdb4db" stroke={o} strokeWidth="3" /><circle cy="-28" r="9" fill="#fff" stroke={o} strokeWidth="3" /></g>
    case 'bandana': return <g><path d={`M${s.left + 8} ${top + 26} Q100 ${top - 8} ${s.right - 8} ${top + 26} Q100 ${top + 12} ${s.left + 8} ${top + 26} Z`} fill="#ff686b" stroke={o} strokeWidth="3" /><circle cx="86" cy={top + 12} r="2.5" fill="#fff" /><circle cx="112" cy={top + 10} r="2.5" fill="#fff" /><path d={`M${s.right - 10} ${top + 24} l16 -6 l-4 14 Z`} fill="#ff686b" stroke={o} strokeWidth="2.5" /></g>
    case 'pilgrimhat': return <g transform={`translate(100 ${top + 2})`}><rect x="-38" y="-4" width="76" height="9" rx="4" fill="#8d6e63" stroke={o} strokeWidth="3" /><path d="M-24 -4 L-20 -40 L20 -40 L24 -4 Z" fill="#a1887f" stroke={o} strokeWidth="3" strokeLinejoin="round" /><rect x="-22" y="-14" width="44" height="8" fill="#5d4037" /><rect x="-7" y="-16" width="14" height="12" rx="2" fill="none" stroke="#ffd166" strokeWidth="3" /></g>
    default: return null
  }
}

function Pattern({ type, s, accent }: { type: CreatureSpec['look']['pattern']; s: Shape; accent: string }) {
  const op = 0.45
  switch (type) {
    case 'spots': return <g fill={accent} opacity={op}><circle cx={s.left + 22} cy={s.eyeY + 10} r="7" /><circle cx={s.right - 20} cy={s.eyeY + 30} r="9" /><circle cx={s.left + 30} cy={s.eyeY + 50} r="5" /><circle cx={s.right - 34} cy={s.top + 16} r="5" /></g>
    case 'stripes': return <g stroke={accent} strokeWidth="6" strokeLinecap="round" opacity={op} fill="none"><path d={`M86 ${s.top + 4} L90 ${s.top + 20}`} /><path d={`M100 ${s.top + 2} L100 ${s.top + 20}`} /><path d={`M114 ${s.top + 4} L110 ${s.top + 20}`} /><path d={`M${s.left + 4} ${s.eyeY + 30} L${s.left + 18} ${s.eyeY + 34}`} /><path d={`M${s.right - 4} ${s.eyeY + 30} L${s.right - 18} ${s.eyeY + 34}`} /></g>
    case 'stars': return <g fill="#fff" opacity=".85">{[[s.left + 22, s.eyeY + 22, 1], [s.right - 24, s.top + 24, 0.8], [s.right - 30, s.eyeY + 44, 1.1], [s.left + 34, s.top + 22, 0.7]].map(([x, y, k], i) => <path key={i} transform={`translate(${x} ${y}) scale(${k})`} d="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2 Z" />)}</g>
    case 'patch': return <ellipse cx="122" cy={s.eyeY} rx="20" ry="18" fill={accent} opacity={op} />
    default: return null
  }
}

function WingsSvg({ type, s, accent, o }: { type: CreatureSpec['look']['wings']; s: Shape; accent: string; o: string }) {
  const y = s.eyeY + 20
  const pair = (el: (side: 1 | -1) => ReactElement) => <g className="cr-wings">{el(-1)}{el(1)}</g>
  switch (type) {
    case 'tiny': return pair((side) => <ellipse key={side} cx={100 + side * (s.right - 100 + 6)} cy={y} rx="14" ry="10" fill="#fff" stroke={o} strokeWidth="3" transform={`rotate(${side * -20} ${100 + side * (s.right - 100 + 6)} ${y})`} />)
    case 'feather': return pair((side) => <path key={side} transform={`translate(${100 + side * (s.right - 100 - 4)} ${y}) scale(${side} 1)`} d="M0 0 C18 -28 40 -30 48 -24 C40 -16 42 -8 34 -2 C40 2 34 10 26 10 C24 16 10 14 0 8 Z" fill={shade(accent, 0.35)} stroke={o} strokeWidth="3" strokeLinejoin="round" />)
    case 'fairy': return pair((side) => <g key={side} transform={`translate(${100 + side * (s.right - 100 - 8)} ${y - 6}) scale(${side} 1)`} opacity=".75"><ellipse cx="20" cy="-14" rx="22" ry="14" fill="#e0f7ff" stroke={o} strokeWidth="2.5" transform="rotate(-25 20 -14)" /><ellipse cx="16" cy="10" rx="14" ry="9" fill="#fce1ff" stroke={o} strokeWidth="2.5" transform="rotate(20 16 10)" /></g>)
    default: return null
  }
}

export interface CreatureSvgProps {
  spec: CreatureSpec
  size?: number | string
  /** idle loop on (respecting prefers-reduced-motion via CSS) */
  animate?: boolean
  /** force the hover move (e.g. in the profile modal) */
  active?: boolean
  className?: string
  title?: string
}

export const CreatureSvg = memo(function CreatureSvg({ spec, size = 120, animate = true, active = false, className = '', title }: CreatureSvgProps) {
  const L = spec.look
  const s = SHAPES[L.body]
  const o = shade(L.color, -0.55)
  const armY = s.eyeY + 42
  const style = { '--spd': `${(1 / spec.idle.speed).toFixed(2)}s`, '--amt': spec.idle.amount } as CSSProperties
  const cls = ['creature', `cat-${spec.category.toLowerCase()}`, animate ? `idle-${spec.idle.motion}` : '', `hover-${spec.hover}`, active ? 'is-active' : '', className].filter(Boolean).join(' ')
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={cls} style={style} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <g className="cr-root">
        <WingsSvg type={L.wings} s={s} accent={L.accent} o={o} />
        {tail(L.tail, s.right - 8, s.eyeY + 66, L.accent, o)}
        <g className="cr-ears">
          {ear(L.ears, 100 - (100 - s.left) * 0.55, s.top + 10, -1, L.color, L.accent, o)}
          {ear(L.ears, 100 + (s.right - 100) * 0.55, s.top + 10, 1, L.color, L.accent, o)}
        </g>
        <path d={s.d} fill={L.color} stroke={o} strokeWidth="4" />
        <ellipse cx="100" cy={s.eyeY + 56} rx={(s.right - s.left) * 0.3} ry="34" fill={L.belly} opacity=".95" />
        <Pattern type={L.pattern} s={s} accent={L.accent} />
        <ellipse cx="68" cy={s.eyeY + 18} rx="10" ry="6" fill="#ff8fab" opacity=".45" />
        <ellipse cx="132" cy={s.eyeY + 18} rx="10" ry="6" fill="#ff8fab" opacity=".45" />
        <Eyes type={L.eyes} y={s.eyeY} o={o} />
        <Mouth type={L.mouth} y={s.eyeY + 22} o={o} />
        <Accessory type={L.accessory} s={s} accent={L.accent} o={o} />
        <g className="cr-arm cr-arm-l"><ellipse cx={s.left + 10} cy={armY} rx="12" ry="18" fill={L.color} stroke={o} strokeWidth="3.5" transform={`rotate(20 ${s.left + 10} ${armY})`} /></g>
        <g className="cr-arm cr-arm-r" style={{ transformOrigin: `${s.right - 14}px ${armY - 10}px` }}><ellipse cx={s.right - 10} cy={armY} rx="12" ry="18" fill={L.color} stroke={o} strokeWidth="3.5" transform={`rotate(-20 ${s.right - 10} ${armY})`} /></g>
        <g className="cr-fx" aria-hidden="true">
          <circle cx="40" cy="50" r="4" /><circle cx="164" cy="40" r="5" /><circle cx="172" cy="96" r="3" /><circle cx="26" cy="104" r="3.5" />
        </g>
      </g>
    </svg>
  )
})
