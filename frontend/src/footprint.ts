/** Геометрия зоны связи Земля–КА при пороге угла возвышения. */

export const EARTH_R_KM = 6371

/**
 * Максимальный центральный угол Земли ψ (рад) от надира до края зоны,
 * где elevation ≥ minElevationDeg:
 *   ψ = arccos((R/r)·cos ε) − ε
 */
export function footprintHalfAngleRad(
  orbitRadiusKm: number,
  minElevationDeg: number,
  earthRKm = EARTH_R_KM,
): number {
  if (orbitRadiusKm <= earthRKm) return 0
  const eps = (minElevationDeg * Math.PI) / 180
  const arg = Math.min(1, Math.max(-1, (earthRKm / orbitRadiusKm) * Math.cos(eps)))
  const psi = Math.acos(arg) - eps
  return Math.max(0, psi)
}

export function ecefToLatLon(
  xKm: number,
  yKm: number,
  zKm: number,
): { lat: number; lon: number } {
  return {
    lon: (Math.atan2(yKm, xKm) * 180) / Math.PI,
    lat: (Math.atan2(zKm, Math.hypot(xKm, yKm)) * 180) / Math.PI,
  }
}

/** Точка на сфере: из (lat,lon) сдвиг на угловое расстояние angularRad по азимуту bearingRad. */
export function destinationPoint(
  latDeg: number,
  lonDeg: number,
  bearingRad: number,
  angularRad: number,
): [number, number] {
  const φ1 = (latDeg * Math.PI) / 180
  const λ1 = (lonDeg * Math.PI) / 180
  const δ = angularRad
  const θ = bearingRad
  const sinφ1 = Math.sin(φ1)
  const cosφ1 = Math.cos(φ1)
  const sinδ = Math.sin(δ)
  const cosδ = Math.cos(δ)
  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ)
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)))
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2))
  let lon = (λ2 * 180) / Math.PI
  const lat = (φ2 * 180) / Math.PI
  // нормализация lon в [-180, 180]
  lon = ((((lon + 180) % 360) + 360) % 360) - 180
  return [lat, lon]
}

/** Замкнутый контур footprint (lat,lon)°, n точек. */
export function footprintRingLatLon(
  nadirLat: number,
  nadirLon: number,
  halfAngleRad: number,
  n = 72,
): [number, number][] {
  if (halfAngleRad <= 0) return []
  const ring: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const bearing = (2 * Math.PI * i) / n
    ring.push(destinationPoint(nadirLat, nadirLon, bearing, halfAngleRad))
  }
  ring.push(ring[0])
  return ring
}

/** ECEF точки контура на поверхности Земли (км) для 3D. */
export function footprintRingEcef(
  nadirLat: number,
  nadirLon: number,
  halfAngleRad: number,
  n = 72,
  earthRKm = EARTH_R_KM,
): Array<[number, number, number]> {
  const ring = footprintRingLatLon(nadirLat, nadirLon, halfAngleRad, n)
  return ring.slice(0, -1).map(([lat, lon]) => {
    const φ = (lat * Math.PI) / 180
    const λ = (lon * Math.PI) / 180
    const x = earthRKm * Math.cos(φ) * Math.cos(λ)
    const y = earthRKm * Math.cos(φ) * Math.sin(λ)
    const z = earthRKm * Math.sin(φ)
    return [x, y, z]
  })
}
