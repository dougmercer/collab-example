import type { Polygon } from 'geojson'
import type { Map as MlMap } from 'maplibre-gl'

let map: MlMap | null = null

export function setMapRef(m: MlMap | null): void {
  map = m
}

export function fitGeometry(geometry: Polygon): void {
  if (!map) return
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of geometry.coordinates[0]) {
    w = Math.min(w, x)
    s = Math.min(s, y)
    e = Math.max(e, x)
    n = Math.max(n, y)
  }
  map.fitBounds([w, s, e, n], { padding: 80, maxZoom: 16, duration: 500 })
}
