/**
 * Simple 3D version of a creature, built from a handful of shared primitive geometries and cached materials.
 * Faces −z (toward the default camera). Idle + hover motion are computed in one useFrame per creature.
 */
import { useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { CreatureSpec, Category } from '../../shared/creatureTypes.ts'

const G = {
  sphere: new THREE.SphereGeometry(1, 24, 16),
  lowSphere: new THREE.SphereGeometry(1, 12, 8),
  cone: new THREE.ConeGeometry(1, 1, 16),
  capsule: new THREE.CapsuleGeometry(1, 1.6, 4, 10),
  torus: new THREE.TorusGeometry(1, 0.22, 8, 24),
  halfTorus: new THREE.TorusGeometry(1, 0.28, 6, 14, Math.PI),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  octa: new THREE.OctahedronGeometry(1, 0),
  box: new RoundedBoxGeometry(1, 1, 1, 3, 0.32),
}

const matCache = new Map<string, THREE.Material>()
export function mat(color: string, opts: { emissive?: boolean; opacity?: number } = {}): THREE.Material {
  const key = `${color}|${opts.emissive ? 1 : 0}|${opts.opacity ?? 1}`
  let m = matCache.get(key)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive: opts.emissive ? new THREE.Color(color).multiplyScalar(0.35) : undefined, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1 })
    matCache.set(key, m)
  }
  return m
}

const FX_COLOR: Record<Category, string> = {
  Fire: '#ff9e6d', Water: '#7cc6fe', Forest: '#80c980', Electric: '#ffe066', Crystal: '#c3f0ff', Cloud: '#ffffff', Cosmic: '#d0b8ff', Ocean: '#5ec8d8', Mechanical: '#ffc06e', Floral: '#ffb3d1',
}

type V3 = [number, number, number]
const M = ({ g, m, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0] }: { g: THREE.BufferGeometry; m: THREE.Material; p?: V3; s?: V3 | number; r?: V3 }) =>
  <mesh geometry={g} material={m} position={p} scale={s} rotation={r} />

const BODY: Record<CreatureSpec['look']['body'], { s: V3; top: number; w: number }> = {
  round: { s: [0.44, 0.44, 0.42], top: 0.42, w: 0.42 },
  pear: { s: [0.4, 0.46, 0.4], top: 0.44, w: 0.4 },
  bean: { s: [0.47, 0.4, 0.4], top: 0.38, w: 0.45 },
  tall: { s: [0.36, 0.55, 0.36], top: 0.53, w: 0.35 },
  blob: { s: [0.5, 0.37, 0.44], top: 0.35, w: 0.48 },
  square: { s: [0.78, 0.8, 0.7], top: 0.4, w: 0.38 },
}

function Ears({ spec }: { spec: CreatureSpec }) {
  const L = spec.look; const b = BODY[L.body]
  const c = mat(L.color); const a = mat(L.accent)
  const y = b.top * 0.86; const x = b.w * 0.55
  const pair = (el: (side: number) => ReactNode) => <>{el(-1)}{el(1)}</>
  switch (L.ears) {
    case 'cat': return pair((s) => <M key={s} g={G.cone} m={c} p={[s * x, y + 0.08, 0]} s={[0.11, 0.22, 0.08]} r={[0, 0, -s * 0.3]} />)
    case 'bunny': return pair((s) => <M key={s} g={G.capsule} m={c} p={[s * x * 0.7, y + 0.24, 0]} s={[0.065, 0.13, 0.05]} r={[0, 0, -s * 0.15]} />)
    case 'round': return pair((s) => <M key={s} g={G.sphere} m={a} p={[s * x, y + 0.02, 0]} s={[0.11, 0.11, 0.06]} />)
    case 'leaf': return pair((s) => <M key={s} g={G.sphere} m={a} p={[s * x, y + 0.12, 0]} s={[0.07, 0.18, 0.03]} r={[0, 0, -s * 0.45]} />)
    case 'flame': return pair((s) => <M key={s} g={G.cone} m={mat(L.accent, { emissive: true })} p={[s * x, y + 0.1, 0]} s={[0.1, 0.26, 0.1]} r={[0, 0, -s * 0.2]} />)
    case 'fin': return <M g={G.cone} m={a} p={[0, y + 0.12, 0.05]} s={[0.05, 0.28, 0.16]} r={[-0.3, 0, 0]} />
    case 'antenna': return pair((s) => <group key={s}><M g={G.cyl} m={mat('#6b5b8c')} p={[s * x * 0.6, y + 0.14, 0]} s={[0.012, 0.26, 0.012]} r={[0, 0, -s * 0.25]} /><M g={G.sphere} m={a} p={[s * (x * 0.6 + 0.04), y + 0.28, 0]} s={0.05} /></group>)
    case 'horns': return pair((s) => <M key={s} g={G.cone} m={a} p={[s * x * 0.8, y + 0.06, 0]} s={[0.06, 0.16, 0.06]} r={[0, 0, -s * 0.5]} />)
    case 'crystal': return pair((s) => <M key={s} g={G.octa} m={mat(L.accent, { opacity: 0.85 })} p={[s * x, y + 0.12, 0]} s={[0.07, 0.17, 0.07]} r={[0, 0.4, -s * 0.25]} />)
    case 'puff': return pair((s) => <group key={s}><M g={G.lowSphere} m={mat('#ffffff')} p={[s * x, y + 0.04, 0]} s={0.1} /><M g={G.lowSphere} m={mat('#ffffff')} p={[s * (x + 0.08), y + 0.1, 0]} s={0.07} /></group>)
    case 'droop': return pair((s) => <M key={s} g={G.capsule} m={a} p={[s * (b.w + 0.02), y - 0.18, 0]} s={[0.06, 0.1, 0.05]} r={[0, 0, s * 0.3]} />)
    default: return null
  }
}

function Tail({ spec }: { spec: CreatureSpec }) {
  const L = spec.look; const b = BODY[L.body]
  const a = mat(L.accent); const p: V3 = [b.w * 0.75, -0.12, 0.34]
  switch (L.tail) {
    case 'flame': return <M g={G.cone} m={mat(L.accent, { emissive: true })} p={p} s={[0.1, 0.3, 0.1]} r={[0.5, 0, -0.6]} />
    case 'leaf': return <M g={G.sphere} m={a} p={p} s={[0.06, 0.2, 0.03]} r={[0.4, 0, -0.7]} />
    case 'fish': return <M g={G.cone} m={a} p={p} s={[0.14, 0.2, 0.04]} r={[0, 0.4, -1.4]} />
    case 'bolt': return <group position={p} rotation={[0, 0, -0.5]}><M g={G.cyl} m={mat('#ffe066', { emissive: true })} p={[0, 0, 0]} s={[0.04, 0.2, 0.04]} r={[0, 0, 0.6]} /><M g={G.cyl} m={mat('#ffe066', { emissive: true })} p={[0.05, 0.14, 0]} s={[0.04, 0.2, 0.04]} r={[0, 0, -0.6]} /></group>
    case 'swirl': return <M g={G.torus} m={a} p={p} s={0.1} r={[0, 0.6, 0]} />
    case 'puff': return <M g={G.lowSphere} m={mat('#ffffff')} p={p} s={0.12} />
    case 'star': return <M g={G.octa} m={mat('#ffe7a3', { emissive: true })} p={[p[0], p[1] + 0.12, p[2]]} s={[0.1, 0.1, 0.04]} />
    case 'gear': return <M g={G.torus} m={a} p={p} s={0.09} r={[0, 0.6, 0]} />
    default: return null
  }
}

function Accessory({ spec }: { spec: CreatureSpec }) {
  const L = spec.look; const b = BODY[L.body]
  const z = -b.s[2] * (L.body === 'square' ? 0.5 : 1)
  switch (L.accessory) {
    case 'scarf': return <M g={G.torus} m={mat('#ff8fab')} p={[0, -0.12, 0]} s={[b.w * 0.92, b.w * 0.92, 0.5]} r={[Math.PI / 2, 0, 0]} />
    case 'bowtie': return <group position={[0, -0.12, z - 0.01]}><M g={G.cone} m={mat(L.accent)} p={[-0.06, 0, 0]} s={[0.05, 0.1, 0.03]} r={[0, 0, Math.PI / 2]} /><M g={G.cone} m={mat(L.accent)} p={[0.06, 0, 0]} s={[0.05, 0.1, 0.03]} r={[0, 0, -Math.PI / 2]} /></group>
    case 'flower': return <group position={[b.w * 0.55, b.top * 0.7, -0.1]}>{[0, 1, 2, 3, 4].map((i) => <M key={i} g={G.lowSphere} m={mat('#ffc8dd')} p={[Math.cos(i * 1.256) * 0.05, Math.sin(i * 1.256) * 0.05, 0]} s={0.035} />)}<M g={G.lowSphere} m={mat('#ffd166')} s={0.03} /></group>
    case 'goggles': return <group position={[0, b.top * 0.5, z * 0.9]}>{[-1, 1].map((s) => <M key={s} g={G.torus} m={mat('#6b5b8c')} p={[s * 0.1, 0, 0]} s={0.07} />)}</group>
    case 'leafhat': return <M g={G.sphere} m={mat('#95d5b2')} p={[0, b.top * 0.92, 0]} s={[0.2, 0.06, 0.2]} />
    case 'crown': return <M g={G.cyl} m={mat('#ffd166', { emissive: true })} p={[0, b.top + 0.02, 0]} s={[0.12, 0.1, 0.12]} />
    case 'glasses': return <group position={[0, 0.08, z * 0.98]}>{[-1, 1].map((s) => <M key={s} g={G.torus} m={mat('#4a3b6b')} p={[s * 0.13, 0, 0]} s={0.075} />)}</group>
    case 'headphones': return <group><M g={G.halfTorus} m={mat('#6b5b8c')} p={[0, 0.05, 0]} s={[b.w + 0.03, b.top + 0.02, 0.4]} />{[-1, 1].map((s) => <M key={s} g={G.cyl} m={mat(L.accent)} p={[s * (b.w + 0.03), 0.05, 0]} s={[0.07, 0.05, 0.07]} r={[0, 0, Math.PI / 2]} />)}</group>
    case 'beanie': return <group><M g={G.sphere} m={mat('#a0c4ff')} p={[0, b.top * 0.72, 0]} s={[b.w * 0.85, 0.2, b.w * 0.85]} /><M g={G.lowSphere} m={mat('#ffffff')} p={[0, b.top + 0.1, 0]} s={0.05} /></group>
    case 'bandana': return <M g={G.torus} m={mat('#ff686b')} p={[0, b.top * 0.62, 0]} s={[b.w * 0.82, b.w * 0.82, 0.4]} r={[Math.PI / 2, 0, 0]} />
    case 'pilgrimhat': return <group position={[0, b.top + 0.02, 0]}><M g={G.cyl} m={mat('#8d6e63')} s={[0.22, 0.02, 0.22]} /><M g={G.cyl} m={mat('#a1887f')} p={[0, 0.1, 0]} s={[0.13, 0.2, 0.13]} /><M g={G.cyl} m={mat('#ffd166')} p={[0, 0.04, 0]} s={[0.135, 0.04, 0.135]} /></group>
    default: return null
  }
}

function Face({ spec }: { spec: CreatureSpec }) {
  const L = spec.look; const b = BODY[L.body]
  const z = L.body === 'square' ? -0.36 : -b.s[2] * 0.9
  const ink = mat('#2d2440'); const white = mat('#ffffff')
  const eyeScale: V3 = L.eyes === 'sleepy' ? [0.06, 0.018, 0.03] : L.eyes === 'happy' ? [0.06, 0.03, 0.03] : L.eyes === 'wide' ? [0.075, 0.075, 0.04] : L.eyes === 'sparkle' ? [0.07, 0.08, 0.04] : [0.055, 0.065, 0.04]
  return (
    <group>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.13, 0.07, z]} name="eye">
          {L.eyes === 'wide' && <M g={G.sphere} m={white} s={[0.085, 0.085, 0.04]} p={[0, 0, 0.005]} />}
          <M g={G.sphere} m={ink} s={L.eyes === 'wide' ? [0.045, 0.045, 0.04] : eyeScale} p={[0, 0, -0.01]} />
          {L.eyes !== 'sleepy' && L.eyes !== 'happy' && <M g={G.lowSphere} m={white} s={0.018} p={[0.02, 0.025, -0.045]} />}
        </group>
      ))}
      {[-1, 1].map((s) => <M key={`c${s}`} g={G.lowSphere} m={mat('#ffb3c7')} p={[s * 0.22, -0.02, z + 0.04]} s={[0.05, 0.03, 0.02]} />)}
      {L.mouth === 'open' || L.mouth === 'grin'
        ? <M g={G.sphere} m={mat(L.mouth === 'grin' ? '#ffffff' : '#c2416b')} p={[0, -0.06, z + 0.01]} s={[L.mouth === 'grin' ? 0.07 : 0.04, 0.03, 0.02]} />
        : <M g={G.halfTorus} m={ink} p={[0, -0.04, z]} s={[0.04, 0.035, 0.04]} r={[0, 0, Math.PI]} />}
      {L.pattern === 'spots' && [[-0.25, 0.2], [0.27, -0.1], [-0.2, -0.22]].map(([x, y], i) => <M key={`p${i}`} g={G.lowSphere} m={mat(L.accent)} p={[x, y, z * 0.75]} s={[0.05, 0.05, 0.02]} />)}
      {L.pattern === 'patch' && <M g={G.sphere} m={mat(L.accent)} p={[0.13, 0.07, z + 0.012]} s={[0.1, 0.1, 0.02]} />}
    </group>
  )
}

export interface Creature3DProps { spec: CreatureSpec; hovered: boolean; selected: boolean; dimmed: boolean; animate: boolean; seed: number }

export function Creature3D({ spec, hovered, selected, animate, seed }: Creature3DProps) {
  const root = useRef<THREE.Group>(null)
  const arm = useRef<THREE.Group>(null)
  const eyes = useRef<THREE.Group>(null)
  const fx = useRef<THREE.Group>(null)
  const hoverT = useRef(0)
  const L = spec.look; const b = BODY[L.body]
  const bodyMat = mat(L.color)
  const fxMat = useMemo(() => mat(FX_COLOR[spec.category], { emissive: true }), [spec.category])

  useFrame(({ clock }, dt) => {
    const g = root.current; if (!g) return
    const t = clock.elapsedTime + seed
    const on = hovered || selected
    hoverT.current = THREE.MathUtils.damp(hoverT.current, on ? 1 : 0, 8, dt)
    const h = hoverT.current
    const w = Math.PI * 2 * spec.idle.speed
    const a = animate ? spec.idle.amount : 0
    let y = 0, rx = 0, ry = 0, rz = 0, sy = 1
    switch (spec.idle.motion) {
      case 'bob': y = Math.sin(t * w) * 0.035 * a; break
      case 'sway': rz = Math.sin(t * w) * 0.12 * a; break
      case 'breathe': sy = 1 + Math.sin(t * w) * 0.035 * a; break
      case 'hop': y = Math.abs(Math.sin(t * w)) * 0.07 * a; break
      case 'float': y = (Math.sin(t * w) * 0.5 + 0.5) * 0.08 * a; ry = Math.sin(t * w * 0.5) * 0.1 * a; break
      case 'wiggle': ry = Math.sin(t * w * 2) * 0.12 * a; break
      case 'tilt': rz = Math.sin(t * w) * 0.09 * a; rx = Math.cos(t * w) * 0.05 * a; break
      case 'spin': ry = Math.sin(t * w * 0.5) * 0.5 * a; break
    }
    // hover moves (only animated when motion is allowed; otherwise just a lift)
    let armZ = 0.35
    if (animate) {
      switch (spec.hover) {
        case 'wave': armZ = 0.35 + h * (2.2 + Math.sin(t * 12) * 0.45); break
        case 'raise': armZ = 0.35 + h * 2.75; break
        case 'bounce': y += h * Math.abs(Math.sin(t * 9)) * 0.16; break
        case 'spin': ry += h * ((t * 5) % (Math.PI * 2)); break
        case 'float': y += h * 0.22; break
        case 'sparkle': armZ = 0.35 + h * 1.2; break
      }
    }
    y += h * 0.06
    g.position.y = y; g.rotation.set(rx, ry, rz); g.scale.set(1 + h * 0.08, (1 + h * 0.08) * sy, 1 + h * 0.08)
    if (arm.current) arm.current.rotation.z = armZ
    // blink every few seconds
    if (eyes.current) { const ph = (t * 0.27 + seed) % 1; eyes.current.scale.y = animate && ph < 0.035 ? 0.15 : 1 }
    if (fx.current) {
      fx.current.visible = h > 0.05 && animate
      fx.current.children.forEach((c, i) => {
        const k = ((t * 0.8 + i / 6) % 1)
        c.position.set(Math.cos(i * 1.05 + t) * (b.w + 0.12), b.top * 0.2 + k * 0.7, Math.sin(i * 1.05 + t) * 0.3 - 0.05)
        c.scale.setScalar(0.035 * (1 - k) * h + 0.001)
      })
    }
  })

  return (
    <group ref={root}>
      {L.body === 'square' ? <M g={G.box} m={bodyMat} s={b.s} /> : <M g={G.sphere} m={bodyMat} s={b.s} />}
      {L.body === 'pear' && <M g={G.sphere} m={bodyMat} p={[0, -0.18, 0]} s={[0.47, 0.3, 0.44]} />}
      <M g={G.sphere} m={mat(L.belly)} p={[0, -0.13, L.body === 'square' ? -0.33 : -b.s[2] * 0.72]} s={[b.w * 0.6, b.s[1] * 0.45, 0.12]} />
      <group ref={eyes}><Face spec={spec} /></group>
      <Ears spec={spec} />
      <Tail spec={spec} />
      <Accessory spec={spec} />
      {L.wings !== 'none' && [-1, 1].map((s) => <M key={`w${s}`} g={G.sphere} m={mat(L.wings === 'fairy' ? '#e0f7ff' : L.wings === 'feather' ? L.accent : '#ffffff', { opacity: L.wings === 'fairy' ? 0.7 : 1 })} p={[s * (b.w * 0.8), 0.05, 0.28]} s={[0.16, 0.1, 0.03]} r={[0, s * 0.5, s * 0.5]} />)}
      <M g={G.capsule} m={bodyMat} p={[-(b.w + 0.03), -0.12, -0.1]} s={[0.06, 0.06, 0.06]} r={[0, 0, -0.35]} />
      <group ref={arm} position={[b.w + 0.01, -0.04, -0.1]}>
        <M g={G.capsule} m={bodyMat} p={[0.0, -0.1, 0]} s={[0.06, 0.06, 0.06]} />
      </group>
      <group ref={fx} visible={false}>{[0, 1, 2, 3, 4, 5].map((i) => <mesh key={i} geometry={G.octa} material={fxMat} />)}</group>
    </group>
  )
}
