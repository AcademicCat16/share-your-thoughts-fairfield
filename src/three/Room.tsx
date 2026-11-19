/** The classroom shell and decorations. Everything static; cheap materials; textures drawn on canvas. */
import { useMemo } from 'react'
import * as THREE from 'three'
import { bannerTexture, floorTexture, skyTexture } from './textures.ts'
import { mat } from './Creature3D.tsx'

export const ROOM = { minX: -15, maxX: 15, minZ: -8, maxZ: 15, h: 6.2 }

const box = new THREE.BoxGeometry(1, 1, 1)
const sph = new THREE.SphereGeometry(1, 16, 12)
const cyl = new THREE.CylinderGeometry(1, 1, 1, 14)
const plane = new THREE.PlaneGeometry(1, 1)
const tri = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -0.8, 0], 3)); g.computeVertexNormals(); return g })()

function Window({ x, z, side }: { x: number; z: number; side: 1 | -1 }) {
  const sky = useMemo(() => new THREE.MeshBasicMaterial({ map: skyTexture() }), [])
  const frame = mat('#ffffff')
  const ry = side === 1 ? -Math.PI / 2 : Math.PI / 2
  return (
    <group position={[x, 3.1, z]} rotation={[0, ry, 0]}>
      <mesh geometry={plane} material={sky} scale={[4.2, 3.2, 1]} position={[0, 0, 0.01]} />
      {[[0, 1.65, 4.6, 0.18], [0, -1.65, 4.6, 0.18], [0, 0, 0.14, 3.3], [-2.2, 0, 0.18, 3.4], [2.2, 0, 0.18, 3.4], [0, 0.2, 4.4, 0.12]].map(([px, py, w, h], i) => (
        <mesh key={i} geometry={box} material={frame} position={[px, py, 0.05]} scale={[w, h, 0.12]} />
      ))}
      <mesh geometry={box} material={mat('#fdf3e1')} position={[0, -1.85, 0.25]} scale={[4.8, 0.14, 0.55]} />
      {/* curtains */}
      {[-1, 1].map((s) => <mesh key={s} geometry={box} material={mat(side === 1 ? '#ffd6e0' : '#d8f3dc')} position={[s * 2.6, 0.1, 0.12]} scale={[0.5, 3.6, 0.08]} />)}
      {/* pumpkin on the sill */}
      <group position={[1.3, -1.6, 0.35]} scale={0.22}>
        {[-0.5, 0, 0.5].map((o) => <mesh key={o} geometry={sph} material={mat('#ffb067')} position={[o, 0, 0]} scale={[0.6, 0.75, 0.75]} />)}
        <mesh geometry={cyl} material={mat('#7cb56b')} position={[0, 0.85, 0]} scale={[0.1, 0.4, 0.1]} />
      </group>
    </group>
  )
}

function Sunbeam({ x, z, side }: { x: number; z: number; side: 1 | -1 }) {
  const m = useMemo(() => new THREE.MeshBasicMaterial({ color: '#fff4c9', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }), [])
  return <mesh geometry={plane} material={m} position={[x - side * 3.2, 1.5, z + 0.6]} rotation={[-Math.PI / 2 + 0.25, 0, side * 0.35]} scale={[3.8, 7, 1]} />
}

function Bunting({ z, y, from, to }: { z: number; y: number; from: number; to: number }) {
  const colors = ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff']
  const n = Math.floor((to - from) / 0.9)
  return (
    <group>
      <mesh geometry={box} material={mat('#c9b6e4')} position={[(from + to) / 2, y, z]} scale={[to - from, 0.03, 0.03]} />
      {Array.from({ length: n }, (_, i) => {
        const x = from + 0.45 + i * 0.9
        const sag = -Math.sin((i / (n - 1)) * Math.PI) * 0.25
        const m = new THREE.MeshLambertMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide })
        return <mesh key={i} geometry={tri} material={m} position={[x, y + sag, z]} scale={[0.6, 0.6, 1]} />
      })}
    </group>
  )
}

function Plant({ p }: { p: [number, number, number] }) {
  return (
    <group position={p}>
      <mesh geometry={cyl} material={mat('#f7a399')} position={[0, 0.35, 0]} scale={[0.35, 0.7, 0.35]} />
      {[[0, 1.05, 0, 0.45], [0.25, 0.95, 0.1, 0.32], [-0.22, 1.0, -0.12, 0.34], [0.05, 1.35, -0.05, 0.3]].map(([x, y, z, s], i) => <mesh key={i} geometry={sph} material={mat(i % 2 ? '#95d5b2' : '#74c69d')} position={[x, y, z]} scale={s} />)}
    </group>
  )
}

function Shelf({ p }: { p: [number, number, number] }) {
  const books = ['#ffadad', '#a0c4ff', '#caffbf', '#ffd6a5', '#bdb2ff', '#9bf6ff', '#ffc6ff', '#fdffb6']
  return (
    <group position={p}>
      <mesh geometry={box} material={mat('#e9c9a8')} position={[0, 1.1, 0]} scale={[3, 2.2, 0.6]} />
      {[0.55, 1.3].map((y, r) => books.map((c, i) => <mesh key={`${r}${i}`} geometry={box} material={mat(c)} position={[-1.2 + i * 0.32, y + 0.12 + (i % 3) * 0.03, -0.32]} scale={[0.24, 0.5 + (i % 3) * 0.08, 0.4]} />))}
    </group>
  )
}

export function Room() {
  const floor = useMemo(() => new THREE.MeshLambertMaterial({ map: floorTexture() }), [])
  const wallBack = mat('#fff1e6'); const wallSide = mat('#eef6ff'); const wallFront = mat('#fdf0ff')
  const W = ROOM.maxX - ROOM.minX, D = ROOM.maxZ - ROOM.minZ, cx = (ROOM.maxX + ROOM.minX) / 2, cz = (ROOM.maxZ + ROOM.minZ) / 2
  const title = useMemo(() => new THREE.MeshBasicMaterial({ map: bannerTexture([
    { text: 'The Feedback Classroom', size: 120, color: '#5b3f8c', weight: 700 },
    { text: 'Fairfield Interactive World · Thanksgiving 2026', size: 54, color: '#c2577a', weight: 600 },
  ], 1600, 360, '#ffffff', '#ffc8dd'), transparent: true }), [])
  const board = useMemo(() => new THREE.MeshBasicMaterial({ map: bannerTexture([
    { text: 'Be kind · Be specific · Be helpful', size: 84, color: '#ffffff', weight: 600 },
    { text: 'One compliment + one idea for each world you visit', size: 52, color: '#d8f3dc', weight: 500 },
  ], 1600, 520, '#4f7d6b', '#c9a26b') }), [])
  const gratitude = useMemo(() => new THREE.MeshBasicMaterial({ map: bannerTexture([
    { text: 'We are thankful for', size: 64, color: '#8a4b2e', weight: 600 },
    { text: 'creative classmates 🍂', size: 64, color: '#c2577a', weight: 600 },
  ], 900, 420, '#fff6d8', '#ffb067') }), [])

  return (
    <group>
      <mesh geometry={plane} material={floor} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} scale={[W, D, 1]} />
      {/* walls face inward (FrontSide), so from outside the room you can see in */}
      <mesh geometry={plane} material={wallBack} position={[cx, ROOM.h / 2, ROOM.maxZ]} rotation={[0, Math.PI, 0]} scale={[W, ROOM.h, 1]} />
      <mesh geometry={plane} material={wallFront} position={[cx, ROOM.h / 2, ROOM.minZ]} scale={[W, ROOM.h, 1]} />
      <mesh geometry={plane} material={wallSide} position={[ROOM.minX, ROOM.h / 2, cz]} rotation={[0, Math.PI / 2, 0]} scale={[D, ROOM.h, 1]} />
      <mesh geometry={plane} material={wallSide} position={[ROOM.maxX, ROOM.h / 2, cz]} rotation={[0, -Math.PI / 2, 0]} scale={[D, ROOM.h, 1]} />
      {/* baseboards */}
      <mesh geometry={box} material={mat('#e3c7a6')} position={[cx, 0.15, ROOM.maxZ - 0.05]} scale={[W, 0.3, 0.1]} />
      {/* back wall: title banner, gratitude board, shelves */}
      <mesh geometry={plane} material={title} position={[0, 4.55, ROOM.maxZ - 0.06]} rotation={[0, Math.PI, 0]} scale={[11, 2.47, 1]} />
      <mesh geometry={plane} material={gratitude} position={[-10, 2.9, ROOM.maxZ - 0.06]} rotation={[0, Math.PI, 0]} scale={[4, 1.87, 1]} />
      <Shelf p={[9.5, 0, ROOM.maxZ - 0.4]} />
      <Bunting z={ROOM.maxZ - 0.3} y={5.9} from={ROOM.minX + 0.5} to={ROOM.maxX - 0.5} />
      {/* front wall board (visible when you turn the camera around) */}
      <mesh geometry={plane} material={board} position={[0, 2.8, ROOM.minZ + 0.06]} scale={[9, 2.92, 1]} />
      {/* windows on both side walls */}
      {[-1, 1].flatMap((side) => [2, 8.5].map((z) => (
        <group key={`${side}${z}`}>
          <Window x={side === 1 ? ROOM.maxX - 0.02 : ROOM.minX + 0.02} z={z} side={side as 1 | -1} />
          <Sunbeam x={side === 1 ? ROOM.maxX : ROOM.minX} z={z} side={side as 1 | -1} />
        </group>
      )))}
      <Plant p={[ROOM.maxX - 1, 0, ROOM.maxZ - 1]} />
      <Plant p={[ROOM.minX + 1, 0, ROOM.maxZ - 1]} />
      <Plant p={[ROOM.minX + 1, 0, ROOM.minZ + 1.2]} />
      <Plant p={[ROOM.maxX - 1, 0, ROOM.minZ + 1.2]} />
      {/* section rugs */}
      <mesh geometry={plane} material={mat('#ffe5ec')} rotation={[-Math.PI / 2, 0, 0]} position={[7.0, 0.01, 4.9]} scale={[12.4, 13, 1]} />
      <mesh geometry={plane} material={mat('#e2f0ff')} rotation={[-Math.PI / 2, 0, 0]} position={[-7.0, 0.01, 4.9]} scale={[12.4, 13, 1]} />
    </group>
  )
}
