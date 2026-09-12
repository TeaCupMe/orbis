import type { CoverageGrid } from './api'

/** Canvas data URL for Leaflet ImageOverlay / debugging. Rows = north→south. */
export function coverageToDataUrl(grid: CoverageGrid): string {
  const rows = grid.values.length
  const cols = grid.values[0]?.length ?? 0
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(cols, rows)
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const v = grid.values[i][j]
      const elev = grid.elevation_max_deg[i][j]
      const idx = (i * cols + j) * 4
      if (v > 0.5) {
        // бирюзовый, яркость от elevation
        const t = Math.min(1, Math.max(0, (elev - 10) / 50))
        img.data[idx] = Math.round(10 + 40 * t)
        img.data[idx + 1] = Math.round(120 + 80 * t)
        img.data[idx + 2] = Math.round(130 + 60 * t)
        img.data[idx + 3] = Math.round(120 + 100 * t)
      } else {
        img.data[idx] = 0
        img.data[idx + 1] = 0
        img.data[idx + 2] = 0
        img.data[idx + 3] = 0
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/** RGBA bytes for Three.js DataTexture; need flip for equirectangular sphere UV. */
export function coverageToRgba(grid: CoverageGrid): {
  data: Uint8Array
  width: number
  height: number
} {
  const rows = grid.values.length
  const cols = grid.values[0]?.length ?? 0
  // Three.js equirectangular: v=0 at south pole bottom of image typically
  // Our rows are north→south; SphereGeometry expects top = +Y (north) at v=0 in three.js
  // Three.js SphereGeometry: v=0 at north (+Y). Image top = v=0. So north-first rows are correct.
  const data = new Uint8Array(rows * cols * 4)
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const v = grid.values[i][j]
      const elev = grid.elevation_max_deg[i][j]
      const idx = (i * cols + j) * 4
      if (v > 0.5) {
        const t = Math.min(1, Math.max(0, (elev - 10) / 50))
        data[idx] = Math.round(10 + 40 * t)
        data[idx + 1] = Math.round(120 + 80 * t)
        data[idx + 2] = Math.round(130 + 60 * t)
        data[idx + 3] = Math.round(140 + 80 * t)
      } else {
        data[idx + 3] = 0
      }
    }
  }
  return { data, width: cols, height: rows }
}
