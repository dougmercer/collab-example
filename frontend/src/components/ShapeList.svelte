<script lang="ts">
  import type { Polygon } from 'geojson'
  import type { SelectTarget } from '../lib/collab.svelte'
  import { userColor } from '../lib/identity'
  import { fitGeometry } from '../lib/map/mapRef'
  import { collab } from '../lib/stores'

  function open(target: SelectTarget, geometry: Polygon) {
    collab.stopDrawing()
    collab.select(target)
    fitGeometry(geometry)
  }

  const isSelected = (kind: SelectTarget['kind'], id: string) => collab.selection?.kind === kind && collab.selection.id === id
</script>

<aside class="panel">
  <div class="panel-header"><h3>Shapes</h3></div>

  {#if collab.drafts.length}
    <h4>Drafts <span class="muted">· only you see these</span></h4>
    <div class="rows">
      {#each collab.drafts as d (d.id)}
        <button class="row" class:selected={isSelected('draft', d.id)} onclick={() => open({ kind: 'draft', id: d.id }, d.geometry)}>
          <span class="swatch dashed" style:border-color={d.color}></span>
          <span class="name">{d.name}</span>
          <span class="badge">draft</span>
        </button>
      {/each}
    </div>
  {/if}

  <h4>Pinned</h4>
  <div class="rows">
    {#each collab.shapes as s (s.id)}
      {@const lock = collab.lockOn(s.id)}
      <button class="row" class:selected={isSelected('shape', s.id)} onclick={() => open({ kind: 'shape', id: s.id }, s.geometry)}>
        <span class="swatch" style:background={s.color}></span>
        <span class="name">{s.name}</span>
        {#if lock}
          <span class="badge lock" style:--who={userColor(lock.client_id)} title="{lock.user_name} holds the lock">
            {lock.client_id === collab.clientId ? 'you' : lock.user_name}
          </span>
        {/if}
      </button>
    {:else}
      <p class="muted">Nothing pinned yet. Draw a polygon, then pin it to share it.</p>
    {/each}
  </div>
</aside>

<style>
  .panel { border-right: 1px solid var(--border); background: var(--panel); }
  h4 { margin: 4px 0 0; }
  .rows { display: flex; flex-direction: column; gap: 2px; }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    padding: 6px 8px;
    border-radius: var(--radius);
  }
  .row:hover { background: #f0f2f5; }
  .row.selected { background: var(--accent-soft); }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .swatch { width: 12px; height: 12px; margin: 0; border-radius: 3px; flex: none; }
  .swatch.dashed { border: 2px dashed; }
  .badge.lock { color: var(--who); background: color-mix(in srgb, var(--who) 14%, white); }
</style>
