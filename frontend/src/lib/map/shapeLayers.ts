import type { FeatureCollection, Polygon } from 'geojson'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { FONT } from './style'

const SOURCE = 'shapes'

/** Layers a click can select a shape from. */
export const CLICKABLE_LAYERS = ['shapes-fill', 'shapes-line', 'drafts-line']

export interface ShapeFeatureProps {
  kind: 'shape' | 'draft'
  id: string
  name: string
  color: string
  selected: boolean
  /** Name of the other person holding the lock, or ''. */
  lockedBy: string
  lockColor: string
}

export type ShapeCollection = FeatureCollection<Polygon, ShapeFeatureProps>

/** Pinned shapes and drafts, drawn by the app. (The shape being edited is drawn by Terra Draw.) */
export function addShapeLayers(map: MlMap): void {
  map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'shapes-fill',
    type: 'fill',
    source: SOURCE,
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['case', ['get', 'selected'], 0.4, ['==', ['get', 'kind'], 'draft'], 0.15, 0.25],
    },
  })
  // A wide dashed halo in the lock holder's color, under the shape's own outline.
  map.addLayer({
    id: 'locks-line',
    type: 'line',
    source: SOURCE,
    filter: ['!=', ['get', 'lockedBy'], ''],
    paint: { 'line-color': ['get', 'lockColor'], 'line-width': 6, 'line-opacity': 0.8, 'line-dasharray': [1, 1] },
  })
  map.addLayer({
    id: 'shapes-line',
    type: 'line',
    source: SOURCE,
    filter: ['==', ['get', 'kind'], 'shape'],
    paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 3, 2] },
  })
  map.addLayer({
    id: 'drafts-line',
    type: 'line',
    source: SOURCE,
    filter: ['==', ['get', 'kind'], 'draft'],
    paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 1.5] },
  })
  map.addLayer({
    id: 'shapes-label',
    type: 'symbol',
    source: SOURCE,
    layout: {
      'text-field': [
        'case',
        ['==', ['get', 'lockedBy'], ''],
        ['get', 'name'],
        [
          'format',
          ['get', 'name'],
          {},
          '\n',
          {},
          ['concat', ['get', 'lockedBy'], ' is editing'],
          { 'font-scale': 0.85, 'text-color': ['get', 'lockColor'] },
        ],
      ],
      'text-font': FONT,
      'text-size': 12,
      'text-max-width': 14,
    },
    paint: { 'text-color': '#1f2933', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  })
}

export function setShapeFeatures(map: MlMap, data: ShapeCollection): void {
  ;(map.getSource(SOURCE) as GeoJSONSource).setData(data)
}
