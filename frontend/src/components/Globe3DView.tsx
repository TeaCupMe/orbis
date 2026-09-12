import { Canvas } from '@react-three/fiber'
import { OrbitControls, Line, Stars, useTexture } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useState } from 'react'
import type { CoverageGrid, SnapshotAnalysis } from '../api'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { coverageToRgba } from '../coverageRender'

const R = 6371
const SCALE = 1 / 1000

type Props = {
  analysis: SnapshotAnalysis
  path: string[]
  pathSet: Set<string>
  clientId: string
  onSelectClient: (id: string) => void
  viewLayer: 'network' | 'coverage'
  coverage: CoverageGrid | null
}

function key(a: string, b: string) {
  return [a, b].sort().join('|')
}

function Earth() {
  const colorMap = useTexture('/earth.jpg')
  colorMap.colorSpace = THREE.SRGBColorSpace
  colorMap.anisotropy = 8

  return (
    <mesh>
      <sphereGeometry args={[R * SCALE, 96, 96]} />
      <meshStandardMaterial map={colorMap} roughness={0.9} metalness={0.05} />
    </mesh>
  )
}

function EarthFallback() {
  return (
    <mesh>
      <sphereGeometry args={[R * SCALE, 64, 64]} />
      <meshStandardMaterial color="#1b4f72" roughness={0.85} metalness={0.1} />
    </mesh>
  )
}

function CoverageOverlay({ coverage }: { coverage: CoverageGrid }) {
  const [tex, setTex] = useState<THREE.DataTexture | null>(null)

  useEffect(() => {
    const { data, width, height } = coverageToRgba(coverage)
    const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
    t.colorSpace = THREE.SRGBColorSpace
    t.needsUpdate = true
    t.flipY = false
    setTex(t)
    return () => {
      t.dispose()
    }
  }, [coverage])

  if (!tex) return null
  return (
    <mesh>
      <sphereGeometry args={[R * SCALE * 1.004, 96, 96]} />
      <meshBasicMaterial
        map={tex}
        transparent
        depthWrite={false}
        opacity={0.85}
        side={THREE.FrontSide}
      />
    </mesh>
  )
}

export function Globe3DView({
  analysis,
  path,
  pathSet,
  clientId,
  onSelectClient,
  viewLayer,
  coverage,
}: Props) {
  const sats = analysis.snapshot.satellites
  const ground = analysis.ground_sites
  const showNetwork = viewLayer === 'network'

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
    if (!showNetwork) return []
    const lines: Array<{ pts: Array<[number, number, number]>; route: boolean }> = []
    for (const [a, b] of analysis.snapshot.edges) {
      const pa = byId.get(a)
      const pb = byId.get(b)
      if (!pa || !pb) continue
      lines.push({ pts: [pa, pb], route: pathSet.has(key(a, b)) })
    }
    return lines
  }, [analysis.snapshot.edges, byId, pathSet, showNetwork])

  return (
    <div className="globe3d">
      <Canvas camera={{ position: [0, 4, 14], fov: 45 }}>
        <color attach="background" args={['#050d14']} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[8, 6, 10]} intensity={1.35} />
        <Stars radius={80} depth={40} count={2500} factor={3} saturation={0} fade />
        <Suspense fallback={<EarthFallback />}>
          <Earth />
        </Suspense>
        {viewLayer === 'coverage' && coverage && <CoverageOverlay coverage={coverage} />}
        {isl
          .filter((l) => !l.route)
          .map((l, i) => (
            <Line
              key={`isl-${i}`}
              points={l.pts}
              color="#4a6d7c"
              lineWidth={0.6}
              transparent
              opacity={0.35}
            />
          ))}
        {isl
          .filter((l) => l.route)
          .map((l, i) => (
            <Line key={`rt-${i}`} points={l.pts} color="#e85d04" lineWidth={2} />
          ))}
        {showNetwork &&
          sats.map((s) => {
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
                g.role === 'client' && showNetwork
                  ? (e: ThreeEvent<MouseEvent>) => {
                      e.stopPropagation()
                      onSelectClient(g.id)
                    }
                  : undefined
              }
            >
              <sphereGeometry args={[selected ? 0.12 : 0.09, 12, 12]} />
              <meshStandardMaterial
                color={selected ? '#e85d04' : g.role === 'gateway' ? '#ae2012' : '#005f73'}
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
