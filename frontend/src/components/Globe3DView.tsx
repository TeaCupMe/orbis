import { Canvas } from '@react-three/fiber'
import { OrbitControls, Line, Stars } from '@react-three/drei'
import { useMemo } from 'react'
import type { SnapshotAnalysis } from '../api'
import type { ThreeEvent } from '@react-three/fiber'

const R = 6371
const SCALE = 1 / 1000

type Props = {
  analysis: SnapshotAnalysis
  path: string[]
  pathSet: Set<string>
  clientId: string
  onSelectClient: (id: string) => void
}

function key(a: string, b: string) {
  return [a, b].sort().join('|')
}

function Earth() {
  return (
    <mesh>
      <sphereGeometry args={[R * SCALE, 64, 64]} />
      <meshStandardMaterial color="#1b4f72" roughness={0.85} metalness={0.1} />
    </mesh>
  )
}

export function Globe3DView({ analysis, path, pathSet, clientId, onSelectClient }: Props) {
  const sats = analysis.snapshot.satellites
  const ground = analysis.ground_sites
  const byId = useMemo(() => {
    const m = new Map<string, [number, number, number]>()
    for (const s of sats) {
      m.set(s.id, [s.x_km * SCALE, s.z_km * SCALE, -s.y_km * SCALE])
    }
    for (const g of ground) {
      const lat = (g.lat_deg * Math.PI) / 180
      const lon = (g.lon_deg * Math.PI) / 180
      const x = R * Math.cos(lat) * Math.cos(lon)
      const y = R * Math.cos(lat) * Math.sin(lon)
      const z = R * Math.sin(lat)
      m.set(g.id, [x * SCALE, z * SCALE, -y * SCALE])
    }
    return m
  }, [sats, ground])

  const isl = useMemo(() => {
    const lines: Array<{ pts: Array<[number, number, number]>; route: boolean }> = []
    for (const [a, b] of analysis.snapshot.edges) {
      const pa = byId.get(a)
      const pb = byId.get(b)
      if (!pa || !pb) continue
      lines.push({ pts: [pa, pb], route: pathSet.has(key(a, b)) })
    }
    return lines
  }, [analysis.snapshot.edges, byId, pathSet])

  return (
    <div className="globe3d">
      <Canvas camera={{ position: [0, 4, 14], fov: 45 }}>
        <color attach="background" args={['#050d14']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[10, 12, 8]} intensity={1.1} />
        <Stars radius={80} depth={40} count={2500} factor={3} saturation={0} fade />
        <Earth />
        {isl
          .filter((l) => !l.route)
          .map((l, i) => (
            <Line key={`isl-${i}`} points={l.pts} color="#4a6d7c" lineWidth={0.6} transparent opacity={0.35} />
          ))}
        {isl
          .filter((l) => l.route)
          .map((l, i) => (
            <Line key={`rt-${i}`} points={l.pts} color="#e85d04" lineWidth={2} />
          ))}
        {sats.map((s) => {
          const p = byId.get(s.id)!
          const onPath = path.includes(s.id)
          return (
            <mesh key={s.id} position={p}>
              <sphereGeometry args={[onPath ? 0.08 : 0.05, 12, 12]} />
              <meshStandardMaterial
                color={s.active ? (onPath ? '#e85d04' : '#94d2bd') : '#6c757d'}
                emissive={s.active ? '#0a9396' : '#000'}
                emissiveIntensity={0.25}
              />
            </mesh>
          )
        })}
        {ground.map((g) => {
          const p = byId.get(g.id)!
          const selected = g.id === clientId
          return (
            <mesh
              key={g.id}
              position={p}
              onClick={
                g.role === 'client'
                  ? (e: ThreeEvent<MouseEvent>) => {
                      e.stopPropagation()
                      onSelectClient(g.id)
                    }
                  : undefined
              }
            >
              <sphereGeometry args={[selected ? 0.12 : 0.09, 12, 12]} />
              <meshStandardMaterial
                color={
                  selected ? '#e85d04' : g.role === 'gateway' ? '#ae2012' : '#005f73'
                }
                emissive={
                  selected ? '#e85d04' : g.role === 'gateway' ? '#9b2226' : '#001219'
                }
                emissiveIntensity={0.4}
              />
            </mesh>
          )
        })}
        <OrbitControls enablePan makeDefault />
      </Canvas>
    </div>
  )
}
