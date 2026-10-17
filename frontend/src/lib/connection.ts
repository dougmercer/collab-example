import type { ServerEvent } from './types'

/** The live WebSocket. Reconnects with backoff whenever it drops. */
export class Connection {
  #ws: WebSocket | null = null
  #attempt = 0
  #retryTimer: ReturnType<typeof setTimeout> | null = null
  #url: () => string
  #onEvent: (e: ServerEvent) => void
  #onDown: () => void

  constructor(url: () => string, onEvent: (e: ServerEvent) => void, onDown: () => void) {
    this.#url = url
    this.#onEvent = onEvent
    this.#onDown = onDown
  }

  open(): void {
    this.#retryTimer = null
    const ws = new WebSocket(this.#url())
    this.#ws = ws
    ws.onopen = () => {
      this.#attempt = 0
    }
    ws.onmessage = (m) => {
      if (this.#ws === ws) this.#onEvent(JSON.parse(m.data) as ServerEvent)
    }
    ws.onclose = () => {
      if (this.#ws !== ws) return // replaced by reconnect()
      this.#ws = null
      this.#onDown()
      this.#retryTimer = setTimeout(() => this.open(), Math.min(8000, 500 * 2 ** this.#attempt++))
    }
  }

  /** Drops the current socket and connects again right away (e.g. with a new name). */
  reconnect(): void {
    const old = this.#ws
    this.#ws = null
    old?.close()
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
    this.#onDown()
    this.open()
  }
}
