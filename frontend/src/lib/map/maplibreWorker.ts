import { setWorkerUrl } from 'maplibre-gl'
// MapLibre 6 finds its worker relative to its own module file, which breaks once Vite
// pre-bundles or bundles it. Let Vite build the worker and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)
