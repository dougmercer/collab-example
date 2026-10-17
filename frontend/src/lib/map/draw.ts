import type { Polygon } from 'geojson'
import type { Map as MlMap } from 'maplibre-gl'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, type GeoJSONStoreFeatures, type HexColor } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'

type FeatureId = string | number

const DRAW_COLOR = '#1e6fd9'
const editable = { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } }
const colorOf = (f: GeoJSONStoreFeatures): HexColor =>
  (typeof f.properties.color === 'string' ? f.properties.color : DRAW_COLOR) as HexColor

export interface DrawHandlers {
  /** A new polygon was finished. */
  drawn(geometry: Polygon): void
  /** The polygon being edited changed (after a drag, or a corner added or removed). */
  edited(geometry: Polygon): void
}

/**
 * Thin wrapper over Terra Draw, which only handles interaction. A finished polygon is handed
 * over and removed, because the app's own layers render it. A polygon being edited stays in
 * Terra Draw until stop().
 */
export class DrawController {
  #draw: TerraDraw
  #editingId: FeatureId | null = null

  constructor(map: MlMap, handlers: DrawHandlers) {
    this.#draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({
          styles: { fillColor: DRAW_COLOR, fillOpacity: 0.2, outlineColor: DRAW_COLOR, outlineWidth: 2 },
        }),
        new TerraDrawSelectMode({
          flags: { polygon: { feature: editable } },
          // The app decides when editing ends and what Delete means.
          keyEvents: null,
          styles: {
            selectedPolygonColor: colorOf,
            selectedPolygonOutlineColor: colorOf,
            selectedPolygonFillOpacity: 0.35,
            selectedPolygonOutlineWidth: 3,
            selectionPointColor: '#ffffff',
            selectionPointOutlineColor: '#1f2933',
            selectionPointWidth: 5,
            selectionPointOutlineWidth: 2,
            midPointColor: '#ffffff',
            midPointOutlineColor: '#6b7785',
            midPointWidth: 3,
            midPointOutlineWidth: 1,
          },
        }),
      ],
    })
    this.#draw.start()
    this.#draw.on('finish', (id, context) => {
      if (context.action === 'draw') {
        const feature = this.#draw.getSnapshotFeature(id)
        this.#draw.removeFeatures([id])
        if (feature?.geometry.type === 'Polygon') handlers.drawn(feature.geometry)
      } else if (id === this.#editingId) {
        const geometry = this.#draw.getSnapshotFeature(id)?.geometry
        if (geometry?.type === 'Polygon') handlers.edited(geometry)
      }
    })
  }

  draw(): void {
    this.stop()
    this.#draw.setMode('polygon')
  }

  /** Loads a polygon for editing. Returns false if Terra Draw rejects it. */
  edit(geometry: Polygon, color: string): boolean {
    this.stop()
    const id = this.#draw.getFeatureId()
    const [result] = this.#draw.addFeatures([{ id, type: 'Feature', geometry, properties: { mode: 'polygon', color } }])
    if (!result?.valid) return false
    this.#draw.setMode('select')
    this.#draw.selectFeature(id)
    this.#editingId = id
    return true
  }

  setColor(color: string): void {
    if (this.#editingId !== null) this.#draw.updateFeatureProperties(this.#editingId, { color })
  }

  /** Whether a click here belongs to the edit (the polygon, a corner, or a midpoint). */
  isEditHit(lngLat: { lng: number; lat: number }): boolean {
    if (this.#editingId === null) return false
    return this.#draw.getFeaturesAtLngLat(lngLat, { pointerDistance: 10, includePolygonsWithinPointerDistance: true }).length > 0
  }

  stop(): void {
    this.#editingId = null
    this.#draw.setMode('static')
    this.#draw.clear()
  }

  destroy(): void {
    this.#draw.stop()
  }
}
