/**
 * The 3D classroom (lazy-loaded). Desks/chairs are instanced (a few draw calls for all 58), creatures only
 * appear at desks whose project link is valid. Camera: orbit (rotate), wheel/pinch (zoom), right-drag or
 * two-finger drag (pan), plus on-screen buttons and fly-to on selection.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitImpl } from 'three-stdlib'
import type { Student } from '../../shared/roster.ts'
import { CREATURE_BY_ID } from '../lib/app.tsx'
import { seats3d, type Seat } from '../lib/layout.ts'
import { Creature3D, mat } from './Creature3D.tsx'
import { Room, ROOM } from './Room.tsx'
import { namePlateTexture, softShadowTexture, bannerTexture } from './textures.ts'

export type CameraCmd = { kind: 'reset' | 'focus' | 'zoomIn' | 'zoomOut' | 'rotL' | 'rotR'; id?: string; n: number }
export interface Classroom3DProps {
  students: Student[]
  counts: Record<string, number>
  selected: string | null
  highlight: Set<string> | null
  animate: boolean
  paused: boolean
  cmd: CameraCmd | null
  onPick(id: string): void
  onHover(id: string | null, x: number, y: number): void
}

const HOME = { pos: new THREE.Vector3(0, 9.2, -12.6), target: new THREE.Vector3(0, 0.4, 5.4) }
const DESK_COLORS = ['#ffd6e0', '#d8f3dc', '#dbe7ff', '#fff1c1', '#e9d8fd', '#ffe1c6', '#c9f2ef']
const MAX_PER_PROJECT = 4

const g = {
  box: new THREE.BoxGeometry(1, 1, 1),
  leg: new THREE.CylinderGeometry(0.045, 0.045, 1, 8),
  plane: new THREE.PlaneGeometry(1, 1),
  ring: new THREE.RingGeometry(0.95, 1.12, 40),
}

function Desks({ seats, highlight }: { seats: Seat[]; highlight: Set<string> | null }) {
  const top = useRef<THREE.InstancedMesh>(null)
  const legs = useRef<THREE.InstancedMesh>(null)
  const seat = useRef<THREE.InstancedMesh>(null)
  const back = useRef<THREE.InstancedMesh>(null)
  const shadow = useMemo(() => new THREE.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, depthWrite: false }), [])
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const c = new THREE.Color(); const grey = new THREE.Color('#e7e3ee')
    seats.forEach((s, i) => {
      const dim = highlight && !highlight.has(s.student.id)
      c.set(DESK_COLORS[(i * 3) % DESK_COLORS.length]); if (dim) c.lerp(grey, 0.75)
      top.current!.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, 0.78, s.z), q, new THREE.Vector3(1.55, 0.08, 0.9)))
      top.current!.setColorAt(i, c)
      seat.current!.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, 0.47, s.z + 0.78), q, new THREE.Vector3(0.62, 0.07, 0.56)))
      back.current!.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, 0.86, s.z + 1.06), q, new THREE.Vector3(0.62, 0.62, 0.07)))
      const chair = new THREE.Color(DESK_COLORS[(i * 3 + 2) % DESK_COLORS.length]).offsetHSL(0, 0.15, -0.12); if (dim) chair.lerp(grey, 0.75)
      seat.current!.setColorAt(i, chair); back.current!.setColorAt(i, chair)
      ;[[-0.68, -0.36], [0.68, -0.36], [-0.68, 0.36], [0.68, 0.36]].forEach(([dx, dz], k) => {
        legs.current!.setMatrixAt(i * 4 + k, m.compose(new THREE.Vector3(s.x + dx, 0.38, s.z + dz), q, new THREE.Vector3(1, 0.76, 1)))
      })
    })
    for (const r of [top, legs, seat, back]) { r.current!.instanceMatrix.needsUpdate = true; if (r.current!.instanceColor) r.current!.instanceColor.needsUpdate = true }
  }, [seats, highlight])
  const n = seats.length
  return (
    <group>
      <instancedMesh ref={top} args={[g.box, undefined, n]}><meshLambertMaterial /></instancedMesh>
      <instancedMesh ref={seat} args={[g.box, undefined, n]}><meshLambertMaterial /></instancedMesh>
      <instancedMesh ref={back} args={[g.box, undefined, n]}><meshLambertMaterial /></instancedMesh>
      <instancedMesh ref={legs} args={[g.leg, mat('#b8a7d6'), n * 4]} />
      {seats.map((s) => <mesh key={s.student.id} geometry={g.plane} material={shadow} position={[s.x, 0.015, s.z + 0.3]} rotation={[-Math.PI / 2, 0, 0]} scale={[2.3, 2.1, 1]} />)}
    </group>
  )
}

function NamePlate({ seat, dim }: { seat: Seat; dim: boolean }) {
  const s = seat.student
  const tint = s.section === '01' ? '#ffadc6' : '#9cc9ff'
  const tex = useMemo(() => namePlateTexture(s.firstName, s.lastName, s.sectionCode, tint, s.urlStatus !== 'valid'), [s.firstName, s.lastName, s.sectionCode, tint, s.urlStatus])
  const face = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, transparent: true }), [tex])
  useEffect(() => () => { tex.dispose(); face.dispose() }, [tex, face])
  face.opacity = dim ? 0.35 : 1
  return (
    <group position={[seat.x, 0.82, seat.z - 0.3]}>
      {/* folded tent: front face toward the camera, back face plain */}
      <mesh geometry={g.plane} material={face} position={[0, 0.17, -0.06]} rotation={[0.32, Math.PI, 0]} scale={[1.28, 0.4, 1]} />
      <mesh geometry={g.plane} material={mat('#f4efe6')} position={[0, 0.17, 0.06]} rotation={[-0.32, 0, 0]} scale={[1.28, 0.4, 1]} />
    </group>
  )
}

function EmptyNote({ seat }: { seat: Seat }) {
  const tex = useMemo(() => bannerTexture([{ text: '✉ on its way', size: 46, color: '#8a6b2e', weight: 600 }], 320, 200, '#fff3b0'), [])
  const m = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, transparent: true }), [tex])
  // a small upright card standing on the empty desk, just behind the name plate
  return <mesh geometry={g.plane} material={m} position={[seat.x + 0.18, 1.06, seat.z + 0.12]} rotation={[0, Math.PI, 0.05]} scale={[0.62, 0.39, 1]} />
}

function Ring({ seat, color }: { seat: Seat; color: string }) {
  const r = useRef<THREE.Mesh>(null)
  const m = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }), [color])
  useFrame(({ clock }) => { if (r.current) r.current.scale.setScalar(1.05 + Math.sin(clock.elapsedTime * 3) * 0.04) })
  return <mesh ref={r} geometry={g.ring} material={m} position={[seat.x, 0.03, seat.z + 0.35]} rotation={[-Math.PI / 2, 0, 0]} />
}

function SectionSigns() {
  const make = (t: string, c: string, b: string) => new THREE.MeshBasicMaterial({ map: bannerTexture([{ text: t, size: 120, color: c, weight: 700 }], 900, 220, '#ffffff', b), transparent: true })
  const a = useMemo(() => make('MKTG 2241-01', '#c2577a', '#ffadc6'), [])
  const b = useMemo(() => make('MKTG 2241-02', '#3d6fb0', '#9cc9ff'), [])
  return (
    <group>
      <mesh geometry={g.plane} material={a} position={[7, 0.03, -2.1]} rotation={[-Math.PI / 2, 0, Math.PI]} scale={[5.2, 1.27, 1]} />
      <mesh geometry={g.plane} material={b} position={[-7, 0.03, -2.1]} rotation={[-Math.PI / 2, 0, Math.PI]} scale={[5.2, 1.27, 1]} />
    </group>
  )
}

function Rig({ cmd, seats, animate }: { cmd: CameraCmd | null; seats: Seat[]; animate: boolean }) {
  const { camera, controls, invalidate } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitImpl | null; invalidate: () => void }
  const fly = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  useEffect(() => {
    if (!cmd || !controls) return
    const t = controls.target
    const off = camera.position.clone().sub(t)
    if (cmd.kind === 'reset') fly.current = { pos: HOME.pos.clone(), target: HOME.target.clone() }
    else if (cmd.kind === 'focus') {
      const s = seats.find((x) => x.student.id === cmd.id)
      if (s) { const tg = new THREE.Vector3(s.x, 1.0, s.z); fly.current = { target: tg, pos: tg.clone().add(new THREE.Vector3(0, 2.6, -4.6)) } }
    } else if (cmd.kind === 'zoomIn' || cmd.kind === 'zoomOut') {
      const k = cmd.kind === 'zoomIn' ? 0.75 : 1.33
      const len = THREE.MathUtils.clamp(off.length() * k, controls.minDistance, controls.maxDistance)
      fly.current = { target: t.clone(), pos: t.clone().add(off.setLength(len)) }
    } else {
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), cmd.kind === 'rotL' ? -Math.PI / 8 : Math.PI / 8)
      fly.current = { target: t.clone(), pos: t.clone().add(off) }
    }
    if (!animate && fly.current) { camera.position.copy(fly.current.pos); controls.target.copy(fly.current.target); controls.update(); fly.current = null }
    invalidate()
  }, [cmd]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!controls) return
    const stop = () => { fly.current = null }
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])
  useFrame((_, dt) => {
    const f = fly.current
    if (!f || !controls) return
    const k = 1 - Math.exp(-dt * 4.5)
    camera.position.lerp(f.pos, k); controls.target.lerp(f.target, k); controls.update()
    if (camera.position.distanceTo(f.pos) < 0.02 && controls.target.distanceTo(f.target) < 0.02) fly.current = null
    invalidate()
  })
  return null
}

/** Exposes read-only state + a projection helper for automated tests (no data access). */
function TestHooks({ seats, hovered }: { seats: Seat[]; hovered: string | null }) {
  const { camera, size, controls, gl } = useThree() as unknown as { camera: THREE.PerspectiveCamera; size: { width: number; height: number }; controls: OrbitImpl | null; gl: THREE.WebGLRenderer }
  useEffect(() => {
    const w = window as unknown as { __fic3d?: unknown }
    w.__fic3d = {
      ready: true,
      seats: seats.length,
      creatures: seats.filter((s) => s.student.urlStatus === 'valid').length,
      hovered,
      camera: () => camera.position.toArray().map((v) => +v.toFixed(3)),
      target: () => controls?.target.toArray().map((v) => +v.toFixed(3)),
      drawCalls: () => gl.info.render.calls,
      /** screen point (CSS px, relative to canvas) of a desk's creature/chair area */
      project: (id: string) => {
        const s = seats.find((x) => x.student.id === id); if (!s) return null
        const v = new THREE.Vector3(s.x, 1.25, s.z + 0.6).project(camera)
        return { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height, visible: v.z < 1 }
      },
    }
  }, [seats, hovered, camera, size, controls, gl])
  return null
}

function clampTarget(c: OrbitImpl | null) {
  if (!c) return
  c.target.x = THREE.MathUtils.clamp(c.target.x, ROOM.minX + 1, ROOM.maxX - 1)
  c.target.z = THREE.MathUtils.clamp(c.target.z, ROOM.minZ + 1, ROOM.maxZ - 1)
  c.target.y = THREE.MathUtils.clamp(c.target.y, 0, 3)
}

export default function Classroom3D(p: Classroom3DProps) {
  const seats = useMemo(() => seats3d(p.students), [p.students])
  const [hovered, setHovered] = useState<string | null>(null)
  const [dpr, setDpr] = useState(1.5)
  const ctl = useRef<OrbitImpl>(null)
  const over = (s: Seat) => (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHovered(s.student.id); p.onHover(s.student.id, e.nativeEvent.clientX, e.nativeEvent.clientY); document.body.style.cursor = 'pointer' }
  const move = (s: Seat) => (e: ThreeEvent<PointerEvent>) => p.onHover(s.student.id, e.nativeEvent.clientX, e.nativeEvent.clientY)
  const out = () => { setHovered(null); p.onHover(null, 0, 0); document.body.style.cursor = '' }
  useEffect(() => () => { document.body.style.cursor = '' }, [])
  const hit = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }), [])
  const frameloop = p.paused || !p.animate ? 'demand' : 'always'

  return (
    <Canvas
      className="classroom-canvas"
      frameloop={frameloop}
      dpr={[1, dpr]}
      gl={{ antialias: true, powerPreference: 'default' }}
      camera={{ position: HOME.pos.toArray(), fov: 45, near: 0.1, far: 120 }}
      onPointerMissed={() => p.onHover(null, 0, 0)}
      aria-hidden="true"
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} />
      <color attach="background" args={['#fdf6ff']} />
      <fog attach="fog" args={['#fdf6ff', 40, 80]} />
      <hemisphereLight args={['#fffaf0', '#f2d9c4', 1.5]} />
      <directionalLight position={[14, 14, 6]} intensity={1.4} color="#fff1d6" />
      <directionalLight position={[-12, 8, -10]} intensity={0.55} color="#e3f0ff" />
      <Room />
      <SectionSigns />
      <Desks seats={seats} highlight={p.highlight} />
      {seats.map((s, i) => {
        const dim = !!p.highlight && !p.highlight.has(s.student.id)
        const spec = CREATURE_BY_ID.get(s.student.creatureId)
        const full = (p.counts[s.student.id] ?? 0) >= MAX_PER_PROJECT
        return (
          <group key={s.student.id}>
            <NamePlate seat={s} dim={dim} />
            {s.student.urlStatus === 'valid' && spec
              ? <group position={[s.x, 1.06, s.z + 0.74]} scale={1.2} visible={!dim || hovered === s.student.id}><Creature3D spec={spec} hovered={hovered === s.student.id} selected={p.selected === s.student.id} dimmed={dim} animate={p.animate} seed={i * 1.37} /></group>
              : <EmptyNote seat={s} />}
            {full && <mesh geometry={g.box} material={mat('#ffd166', { emissive: true })} position={[s.x - 0.55, 0.9, s.z + 0.1]} scale={[0.16, 0.16, 0.16]} rotation={[0.6, 0.6, 0]} />}
            {(p.selected === s.student.id || hovered === s.student.id || (p.highlight && !dim && p.highlight.size <= 12)) && <Ring seat={s} color={p.selected === s.student.id ? '#ff8fab' : '#b69cff'} />}
            <mesh geometry={g.box} material={hit} position={[s.x, 0.88, s.z + 0.4]} scale={[1.6, 1.76, 1.6]}
              onPointerOver={over(s)} onPointerMove={move(s)} onPointerOut={out}
              onClick={(e) => { e.stopPropagation(); if (e.delta <= 6) p.onPick(s.student.id) }} />
          </group>
        )
      })}
      <OrbitControls ref={ctl} makeDefault enableDamping dampingFactor={0.09} minDistance={3} maxDistance={34} maxPolarAngle={1.42} minPolarAngle={0.15}
        target={HOME.target.toArray()} onChange={() => clampTarget(ctl.current)} zoomToCursor />
      <Rig cmd={p.cmd} seats={seats} animate={p.animate} />
      <TestHooks seats={seats} hovered={hovered} />
    </Canvas>
  )
}
