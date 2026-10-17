export type ToastKind = 'info' | 'error'

export interface Toast {
  id: number
  message: string
  kind: ToastKind
}

export type Notify = (message: string, kind?: ToastKind) => void

export class ToastStore {
  items = $state<Toast[]>([])
  #nextId = 1

  show(message: string, kind: ToastKind = 'info', ms = 4000): void {
    const id = this.#nextId++
    this.items.push({ id, message, kind })
    if (ms > 0) setTimeout(() => this.dismiss(id), ms)
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id)
  }
}
