<script lang="ts">
  import type { Feature, Polygon } from 'geojson'
  import { Map as MlMap, NavigationControl, ScaleControl, type MapMouseEvent } from 'maplibre-gl'
  import { onMount, untrack } from 'svelte'
  import type { SelectTarget } from '../collab.svelte'
  import { userColor } from '../identity'
  import { collab, toasts } from '../stores'
  import { DrawController } from './draw'
  import { setMapRef } from './mapRef'
  import { addShapeLayers, CLICKABLE_LAYERS, setShapeFeatures, type ShapeCollection, type ShapeFeatureProps } from './shapeLayers'
  import { BASEMAP_STYLE } from './style'
  import './maplibreWorker'

  let container: HTMLDivElement
  let map = $state.raw<MlMap | null>(null)
  let draw: DrawController | null = null

  function hit(e: MapMouseEvent): SelectTarget | null {
    if (!map) return null
    const { x, y } = e.point
    const features = map.queryRenderedFeatures(
      [
        [x - 3, y - 3],
        [x + 3, y + 3],
      ],
      { layers: CLICKABLE_LAYERS },
    )
    const p = features[0]?.properties as ShapeFeatureProps | undefined
    return p ? { kind: p.kind, id: p.id } : null
  }

  function onClick(e: MapMouseEvent) {
    // Clicks on the polygon being edited belong to Terra Draw; anything else selects or deselects.
    if (collab.drawing || draw?.isEditHit(e.lngLat)) return
    collab.select(hit(e))
  }

  function onMouseMove(e: MapMouseEvent) {
    // Terra Draw sets its own cursor while drawing or editing.
    if (collab.drawing || collab.editTarget) return
    e.target.getCanvas().style.cursor = hit(e) ? 'pointer' : ''
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) return
    if (collab.drawing) collab.stopDrawing()
    else collab.deselect()
  }

  /** What the app draws: every shape and draft except the one Terra Draw is showing. */
  function shapeFeatures(): ShapeCollection {
    const sel = collab.selection
    const inTerraDraw = collab.editTarget?.id
    const features: Feature<Polygon, ShapeFeatureProps>[] = []
    for (const shape of collab.shapes) {
      if (shape.id === inTerraDraw) continue
      const lock = collab.lockOn(shape.id)
      const other = lock && lock.client_id !== collab.clientId ? lock : null
      const selected = sel?.kind === 'shape' && sel.id === shape.id
      // After a lost lock, keep showing the unsaved version so the user sees what they'd be giving up.
      const shown = selected && sel.status === 'lost' ? sel.edit : shape
      features.push({
        type: 'Feature',
        geometry: shown.geometry,
        properties: {
          kind: 'shape',
          id: shape.id,
          name: shown.name,
          color: shown.color,
          selected,
          lockedBy: other?.user_name ?? '',
          lockColor: other ? userColor(other.client_id) : '',
        },
      })
    }
    for (const d of collab.drafts) {
      if (d.id === inTerraDraw) continue
      features.push({
        type: 'Feature',
        geometry: d.geometry,
        properties: { kind: 'draft', id: d.id, name: `${d.name} (draft)`, color: d.color, selected: false, lockedBy: '', lockColor: '' },
      })
    }
    return { type: 'FeatureCollection', features }
  }

  onMount(() => {
    const m = new MlMap({ container, style: BASEMAP_STYLE, center: [-0.1276, 51.5072], zoom: 13, attributionControl: { compact: true } })
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')
    m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    m.on('load', () => {
      addShapeLayers(m)
      draw = new DrawController(m, {
        drawn: (g) => collab.finishDrawing(g),
        edited: (g) => collab.setGeometry(g),
      })
      setMapRef(m)
      map = m
    })
    m.on('click', onClick)
    m.on('mousemove', onMouseMove)
    return () => {
      draw?.destroy()
      setMapRef(null)
      m.remove()
    }
  })

  $effect(() => {
    if (map) setShapeFeatures(map, $state.snapshot(shapeFeatures()) as ShapeCollection)
  })

  // Terra Draw is either drawing a new polygon, editing the selected one, or idle.
  // Only the mode and the edit key are tracked, so in-progress edits don't reload it.
  $effect(() => {
    const drawing = collab.drawing
    const key = collab.editKey
    const d = draw
    if (!map || !d) return
    untrack(() => {
      if (drawing) {
        d.draw()
      } else if (key && collab.editTarget) {
        const { geometry, color } = collab.editTarget.fields
        if (!d.edit($state.snapshot(geometry) as Polygon, color)) toasts.show("This shape's geometry can't be edited", 'error')
      } else {
        d.stop()
      }
    })
  })

  $effect(() => {
    const color = collab.editTarget?.fields.color
    if (color) draw?.setColor(color)
  })

  const hint = $derived.by(() => {
    if (collab.drawing) return 'Click to add corners · click the first corner to finish · Esc to cancel'
    const t = collab.editTarget
    if (!t) return null
    return collab.selection?.kind === 'draft'
      ? 'Drag the shape or its corners · pin it to share it'
      : 'Drag the shape or its corners · click away to release the lock'
  })
</script>

<svelte:window onkeydown={onKeydown} />

<div class="map" bind:this={container}></div>

<div class="top">
  <button class="btn draw" class:active={collab.drawing} onclick={() => (collab.drawing ? collab.stopDrawing() : collab.startDrawing())}>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 18 9 5l9 4-3 11z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <circle cx="4" cy="18" r="2" fill="currentColor" />
      <circle cx="9" cy="5" r="2" fill="currentColor" />
      <circle cx="18" cy="9" r="2" fill="currentColor" />
      <circle cx="15" cy="20" r="2" fill="currentColor" />
    </svg>
    {collab.drawing ? 'Cancel drawing' : 'Draw polygon'}
  </button>
  {#if hint}<div class="hint">{hint}</div>{/if}
</div>

<style>
  .map { position: absolute; inset: 0; }
  .top {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    pointer-events: none;
  }
  .top > :global(*) { pointer-events: auto; }
  .draw {
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    font-weight: 600;
  }
  .draw.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .hint {
    background: rgba(31, 41, 51, 0.9);
    color: #fff;
    padding: 6px 12px;
    border-radius: var(--radius);
    white-space: nowrap;
  }
</style>
