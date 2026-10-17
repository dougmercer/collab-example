import { CollabStore } from './collab.svelte'
import { loadName } from './identity'
import { ToastStore } from './toasts.svelte'

export const toasts = new ToastStore()
export const collab = new CollabStore(loadName(), (message, kind) => toasts.show(message, kind))
