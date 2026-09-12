import { Canvas } from '@react-three/fiber'
import { OrbitControls, Line, Stars, useTexture } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useState } from 'react'
import type { CoverageGrid, SnapshotAnalysis } from '../api'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { coverageToRgba } from '../coverageRender'
import {
  EARTH_R_KM,
  ecefToLatLon,
  footprintHalfAngleRad,
  footprintRingEcef,
} from '../footprint'
import { useMedia } from '../useMedia'

const R = EARTH_R_KM
const SCALE = 1 / 1000
const noRaycast = (() => {}) as unknown as THREE.Mesh['raycast']

function elevate(
  p: [number, number, number],
  extra: number,
): [number, number, number] {
  const len = Math.hypot(p[0], p[1], p[2]) || 1
  const s = (len + extra) / len
  return [p[0] * s, p[1] * s, p[2] * s]
}

type Props = {
  analysis: SnapshotAnalysis
  path: string[]
  pathSet: Set<string>
  clientId: string
  onSelectClient: (id: string) => void
  selectedSatId: string | null
  onSelectSat: (id: string) => void
  minElevationDeg: number
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

  // Земля должна участвовать в raycast, иначе клик «пробивает» глобус
  // и попадает в КА на обратной стороне.
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

function Footprint3D({
  sat,
  minElevationDeg,
}: {
  sat: { x_km: number; y_km: number; z_km: number }
  minElevationDeg: number
}) {
  const { outline, fill } = useMemo(() => {
    const r = Math.hypot(sat.x_km, sat.y_km, sat.z_km)
    const psi = footprintHalfAngleRad(r, minElevationDeg)
    if (psi <= 0) return { outline: null as Array<[number, number, number]> | null, fill: null }
    const { lat, lon } = ecefToLatLon(sat.x_km, sat.y_km, sat.z_km)
    const ecef = footprintRingEcef(lat, lon, psi, 96)
    const to3 = (p: [number, number, number]): [number, number, number] => [
      p[0] * SCALE,
      p[2] * SCALE,
      -p[1] * SCALE,
    ]
    const ring3 = ecef.map(to3)
    const outlinePts = [...ring3, ring3[0]]

    const nh = r > 0 ? EARTH_R_KM / r : 0
    const nadir: [number, number, number] = to3([
      sat.x_km * nh,
      sat.y_km * nh,
      sat.z_km * nh,
    ])
    const positions = new Float32Array(ring3.length * 9)
    for (let i = 0; i < ring3.length; i++) {
      const a = ring3[i]
      const b = ring3[(i + 1) % ring3.length]
      const o = i * 9
      positions[o] = nadir[0]
      positions[o + 1] = nadir[1]
      positions[o + 2] = nadir[2]
      positions[o + 3] = a[0]
      positions[o + 4] = a[1]
      positions[o + 5] = a[2]
      positions[o + 6] = b[0]
      positions[o + 7] = b[1]
      positions[o + 8] = b[2]
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.computeVertexNormals()
    return { outline: outlinePts, fill: geo }
  }, [sat.x_km, sat.y_km, sat.z_km, minElevationDeg])

  useEffect(() => {
    return () => {
      fill?.dispose()
    }
  }, [fill])

  if (!outline) return null
  return (
    <group>
      <Line points={outline} color="#4cc9f0" lineWidth={2} raycast={noRaycast} />
      {fill && (
        <mesh geometry={fill} raycast={noRaycast}>
          <meshBasicMaterial
            color="#4cc9f0"
            transparent
            opacity={0.22}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  )
}

/** Невидимая увеличенная сфера для надёжного raycast-клика. */
function HitSphere({
  position,
  radius,
  onPick,
}: {
  position: [number, number, number]
  radius: number
  onPick: () => void
}) {
  return (
    <mesh
      position={position}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        onPick()
      }}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto'
      }}
    >
      <sphereGeometry args={[radius, 16, 16]} />
      {/* colorWrite:false — невидима, но стабильно участвует в raycast */}
      <meshBasicMaterial colorWrite={false} depthWrite={false} />
    </mesh>
  )
}

export function Globe3DView({
  analysis,
  path,
  pathSet,
  clientId,
  onSelectClient,
  selectedSatId,
  onSelectSat,
  minElevationDeg,
  viewLayer,
  coverage,
}: Props) {
  const sats = analysis.snapshot.satellites
  const ground = analysis.ground_sites
  const showNetwork = viewLayer === 'network'
  const satIds = useMemo(() => new Set(sats.map((s) => s.id)), [sats])
  const selectedSat = useMemo(
    () => (selectedSatId ? sats.find((s) => s.id === selectedSatId) ?? null : null),
    [sats, selectedSatId],
  )

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
    const lines: Array<{
      pts: Array<[number, number, number]>
      highlight: boolean
      a: string
      b: string
    }> = []
    for (const [a, b] of analysis.snapshot.edges) {
      if (!satIds.has(a) || !satIds.has(b)) continue
      // Рёбра маршрута (в т.ч. станция–КА) — отдельно по path.
      if (pathSet.has(key(a, b))) continue
      const pa = byId.get(a)
      const pb = byId.get(b)
      if (!pa || !pb) continue
      const highlight = Boolean(
        selectedSatId && (a === selectedSatId || b === selectedSatId),
      )
      lines.push({ pts: [pa, pb], highlight, a, b })
    }
    return lines
  }, [analysis.snapshot.edges, byId, pathSet, showNetwork, selectedSatId, satIds])

  const routeSegs = useMemo(() => {
    if (!showNetwork || path.length < 2) return [] as Array<Array<[number, number, number]>>
    const segs: Array<Array<[number, number, number]>> = []
    for (let i = 0; i < path.length - 1; i++) {
      const rawA = byId.get(path[i])
      const rawB = byId.get(path[i + 1])
      if (!rawA || !rawB) continue
      // Станции чуть приподнимаем, как маркеры.
      const pa = satIds.has(path[i]) ? rawA : elevate(rawA, 0.12)
      const pb = satIds.has(path[i + 1]) ? rawB : elevate(rawB, 0.12)
      segs.push([pa, pb])
    }
    return segs
  }, [showNetwork, path, byId, satIds])

  const neighborIds = useMemo(() => {
    if (!selectedSatId) return new Set<string>()
    const n = new Set<string>()
    for (const l of isl) {
      if (!l.highlight) continue
      if (l.a !== selectedSatId) n.add(l.a)
      if (l.b !== selectedSatId) n.add(l.b)
    }
    return n
  }, [isl, selectedSatId])

  const dimOthers = Boolean(selectedSatId)
  const compactGlobe = useMedia('(max-width: 480px), (pointer: coarse)')

  return (
    <div className="globe3d">
      <Canvas dpr={[1, compactGlobe ? 1.25 : 1.5]} camera={{ position: [0, 4, 14], fov: 45 }}>
        <color attach="background" args={['#050d14']} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[8, 6, 10]} intensity={1.35} />
        <Stars
          radius={80}
          depth={40}
          count={compactGlobe ? 900 : 2500}
          factor={3}
          saturation={0}
          fade
        />
        <Suspense fallback={<EarthFallback />}>
          <Earth />
        </Suspense>
        {viewLayer === 'coverage' && coverage && <CoverageOverlay coverage={coverage} />}
        {showNetwork && selectedSat && (
          <Footprint3D sat={selectedSat} minElevationDeg={minElevationDeg} />
        )}
        {isl
          .filter((l) => !l.highlight)
          .map((l, i) => (
            <Line
              key={`isl-${i}`}
              points={l.pts}
              color="#4a6d7c"
              lineWidth={0.6}
              transparent
              opacity={dimOthers ? 0.12 : 0.35}
              raycast={noRaycast}
            />
          ))}
        {isl
          .filter((l) => l.highlight)
          .map((l, i) => (
            <Line
              key={`isl-hi-${i}`}
              points={l.pts}
              color="#4cc9f0"
              lineWidth={2.5}
              raycast={noRaycast}
            />
          ))}
        {routeSegs.map((pts, i) => (
          <Line
            key={`rt-${i}`}
            points={pts}
            color="#e85d04"
            lineWidth={2}
            raycast={noRaycast}
          />
        ))}
        {showNetwork &&
          sats.map((s) => {
            const p = byId.get(s.id)!
            const onPath = path.includes(s.id)
            const selected = s.id === selectedSatId
            const neighbor = neighborIds.has(s.id)
            return (
              <group key={s.id}>
                <mesh position={p} raycast={noRaycast}>
                  <sphereGeometry
                    args={[selected ? 0.1 : onPath ? 0.08 : neighbor ? 0.07 : 0.05, 12, 12]}
                  />
                  <meshStandardMaterial
                    color={
                      selected
                        ? '#4cc9f0'
                        : neighbor
                          ? '#90e0ef'
                          : s.active
                            ? onPath
                              ? '#e85d04'
                              : '#94d2bd'
                            : '#6c757d'
                    }
                    emissive={selected ? '#4cc9f0' : s.active ? '#0a9396' : '#000'}
                    emissiveIntensity={selected ? 0.55 : 0.25}
                    opacity={dimOthers && !selected && !neighbor ? 0.35 : 1}
                    transparent={dimOthers && !selected && !neighbor}
                  />
                </mesh>
                <HitSphere position={p} radius={0.22} onPick={() => onSelectSat(s.id)} />
              </group>
            )
          })}
        {ground.map((g) => {
          const p = byId.get(g.id)!
          // Чуть выше поверхности — иначе Земля перехватывает raycast.
          const pVis = elevate(p, 0.12)
          const pHit = elevate(p, 0.28)
          const selected = g.id === clientId
          return (
            <group key={g.id}>
              <mesh position={pVis} raycast={noRaycast}>
                <sphereGeometry args={[selected ? 0.14 : 0.11, 12, 12]} />
                <meshStandardMaterial
                  color={selected ? '#e85d04' : g.role === 'gateway' ? '#ae2012' : '#005f73'}
                  emissive={
                    selected ? '#e85d04' : g.role === 'gateway' ? '#9b2226' : '#001219'
                  }
                  emissiveIntensity={0.4}
                />
              </mesh>
              {g.role === 'client' && showNetwork && (
                <HitSphere position={pHit} radius={0.42} onPick={() => onSelectClient(g.id)} />
              )}
            </group>
          )
        })}
        <OrbitControls enablePan={!compactGlobe} makeDefault />
      </Canvas>
    </div>
  )
}
