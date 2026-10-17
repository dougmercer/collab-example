<script lang="ts">
  import { onMount } from 'svelte'
  import PropertiesPanel from './components/PropertiesPanel.svelte'
  import ShapeList from './components/ShapeList.svelte'
  import Toasts from './components/Toasts.svelte'
  import TopBar from './components/TopBar.svelte'
  import MapView from './lib/map/MapView.svelte'
  import { collab } from './lib/stores'

  onMount(() => collab.start())

  const touch = () => collab.touch()
</script>

<svelte:window onpointerdown={touch} onpointermove={touch} onkeydown={touch} />

<div class="app">
  <TopBar />
  <div class="body">
    <ShapeList />
    <main class="map-area"><MapView /></main>
    <PropertiesPanel />
  </div>
</div>
<Toasts />

<style>
  .app { display: grid; grid-template-rows: 44px minmax(0, 1fr); height: 100%; }
  .body { display: grid; grid-template-columns: 240px minmax(0, 1fr) 300px; min-height: 0; }
  .map-area { position: relative; }
</style>
