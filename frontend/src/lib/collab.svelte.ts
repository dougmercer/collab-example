import type { Polygon } from 'geojson'
import { ApiError, createApi, errorMessage, type Api } from './api'
import { Connection } from './connection'
import { saveName } from './identity'
import { applySnapshot, clearLock, emptyReplica, removeShape, setLock, upsertShape } from './sync'
import type { Notify } from './toasts.svelte'
import type { Lock, ReleaseReason, ServerConfig, ServerEvent, ShapeFields, User } from './types'

/** A polygon drawn but not pinned yet. Lives only in this tab. */
export interface Draft extends ShapeFields {
  id: string
}

/**
 * locking:  asked the server for the lock
 * editing:  we hold the lock; edits stay local until Save
 * readonly: someone else holds the lock (or we couldn't get it)
 * lost:     we had the lock but it expired or the connection dropped; unsaved edits are kept
 */
export type EditStatus = 'locking' | 'editing' | 'readonly' | 'lost'

export type Selection =
  | { kind: 'draft'; id: string; token: number }
  | {
      kind: 'shape'
      id: string
      /** Tells this selection apart from a later one of the same shape. */
      token: number
      status: EditStatus
      /** The version our edit started from. The server refuses a save if the shape has moved on. */
      baseVersion: number
      /** The local working copy. */
      edit: ShapeFields
      lostReason: string | null
    }

export type SelectTarget = { kind: 'shape' | 'draft'; id: string }

const SHAPE_COLORS = ['#1e6fd9', '#e8590c', '#2b8a3e', '#9c36b5', '#0c8599', '#c2255c', '#f08c00', '#5f3dc4']

export const fieldsOf = (s: ShapeFields): ShapeFields => ({ name: s.name, color: s.color, geometry: $state.snapshot(s.geometry) })

export const sameFields = (a: ShapeFields, b: ShapeFields): boolean =>
  a.name === b.name && a.color === b.color && JSON.stringify(a.geometry) === JSON.stringify(b.geometry)

const LOST_REASONS: Record<ReleaseReason, string> = {
  expired: 'Your lock expired because you were inactive.',
  disconnected: 'Your connection dropped, so your lock was released.',
  released: 'Your lock was released.',
}

/** Shared shapes, who's online, and this tab's selection and drafts. */
export class CollabStore {
  /** New per page load, so a duplicated tab is a separate client. */
  readonly clientId = crypto.randomUUID()
  name = $state('')
  connection = $state<'connecting' | 'online' | 'offline'>('connecting')
  replica = $state(emptyReplica())
  users = $state<User[]>([])
  config = $state<ServerConfig>({ lock_ttl_seconds: 30, idle_release_seconds: 120 })
  drafts = $state<Draft[]>([])
  selection = $state<Selection | null>(null)
  drawing = $state(false)
  /** A save, pin, or delete is in flight. */
  busy = $state(false)
  /** Bumped when the edited geometry is replaced from outside Terra Draw (Reject). */
  #reloads = $state(0)

  shapes = $derived(Object.values(this.replica.shapes).sort((a, b) => a.name.localeCompare(b.name)))

  /** The server's copy of the selected shape. */
  selectedShape = $derived.by(() => {
    const s = this.selection
    return s?.kind === 'shape' ? (this.replica.shapes[s.id] ?? null) : null
  })

  selectedDraft = $derived.by(() => {
    const s = this.selection
    return s?.kind === 'draft' ? (this.drafts.find((d) => d.id === s.id) ?? null) : null
  })

  /** What the properties panel shows. */
  fields = $derived.by((): ShapeFields | null => {
    const s = this.selection
    if (!s) return null
    return s.kind === 'draft' ? this.selectedDraft : s.edit
  })

  /** What can be edited right now: the selected draft, or a shape whose lock we hold. */
  editTarget = $derived.by((): { id: string; fields: ShapeFields } | null => {
    const s = this.selection
    if (s?.kind === 'draft') return this.selectedDraft ? { id: s.id, fields: this.selectedDraft } : null
    if (s?.kind === 'shape' && s.status === 'editing') return { id: s.id, fields: s.edit }
    return null
  })

  /** Changes only when Terra Draw has to (re)load the edited geometry. */
  editKey = $derived(this.editTarget ? `${this.editTarget.id}:${this.#reloads}` : '')

  /** The working copy differs from the server's copy. */
  dirty = $derived.by(() => {
    const s = this.selection
    if (s?.kind !== 'shape' || (s.status !== 'editing' && s.status !== 'lost')) return false
    const server = this.replica.shapes[s.id]
    return !server || !sameFields(s.edit, server)
  })

  #api: Api
  #conn: Connection
  #notify: Notify
  #queue: Promise<unknown> = Promise.resolve()
  #nextToken = 1
  #nextColor = 0
  #lastActivity = Date.now()
  #renewTimer: ReturnType<typeof setInterval> | null = null

  constructor(name: string, notify: Notify) {
    this.name = name
    this.#notify = notify
    this.#api = createApi(this.clientId)
    this.#conn = new Connection(
      () => this.#wsUrl(),
      (e) => this.#onEvent(e),
      () => this.#onDown(),
    )
  }

  start(): void {
    this.#conn.open()
    this.#scheduleRenewals()
  }

  lockOn(shapeId: string): Lock | null {
    return this.replica.locks[shapeId] ?? null
  }

  /** Called on any user input. Once the user goes idle, their lock is left to expire. */
  touch(): void {
    this.#lastActivity = Date.now()
  }

  rename(name: string): void {
    const trimmed = name.trim().slice(0, 40)
    if (!trimmed || trimmed === this.name) return
    this.deselect()
    this.name = trimmed
    saveName(trimmed)
    this.#conn.reconnect()
  }

  // ---- selection and locks ----------------------------------------------------

  /** Selects a shape (claiming its lock if it's free) or a draft. Null deselects. */
  select(target: SelectTarget | null): void {
    const s = this.selection
    if (target && s?.kind === target.kind && s.id === target.id) return
    this.deselect()
    if (!target) return
    if (target.kind === 'draft') {
      this.selection = { kind: 'draft', id: target.id, token: this.#nextToken++ }
      return
    }
    const shape = this.replica.shapes[target.id]
    if (!shape) return
    const lock = this.replica.locks[shape.id]
    const canClaim = (!lock || lock.client_id === this.clientId) && this.connection === 'online'
    this.selection = {
      kind: 'shape',
      id: shape.id,
      token: this.#nextToken++,
      status: canClaim ? 'locking' : 'readonly',
      baseVersion: shape.version,
      edit: fieldsOf(shape),
      lostReason: null,
    }
    if (canClaim) void this.#claim(false)
  }

  /** Clicking away: releases the lock and throws away unsaved changes. Drafts stay. */
  deselect(): void {
    const s = this.selection
    if (!s) return
    this.selection = null
    if (s.kind !== 'shape' || s.status === 'readonly') return
    const server = this.replica.shapes[s.id]
    if (server && (s.status === 'editing' || s.status === 'lost') && !sameFields(s.edit, server)) {
      this.#notify(`Discarded unsaved changes to "${server.name}"`)
    }
    const lock = this.replica.locks[s.id]
    if (lock?.client_id === this.clientId) clearLock(this.replica, lock)
    // Queued behind any lock request still in flight, so the release always lands last.
    this.#send(() => this.#api.releaseLock(s.id)).catch(() => {})
  }

  /** Takes the lock on the selected shape: once someone else has let go, or to win back a lost lock. */
  claim(): void {
    const s = this.selection
    if (s?.kind !== 'shape' || (s.status !== 'readonly' && s.status !== 'lost')) return
    void this.#claim(s.status === 'lost')
  }

  async #claim(keepEdits: boolean): Promise<void> {
    const s = this.selection
    if (s?.kind !== 'shape') return
    const { id, token } = s
    s.status = 'locking'
    try {
      setLock(this.replica, await this.#send(() => this.#api.acquireLock(id)))
    } catch (e) {
      const locked = e instanceof ApiError && e.code === 'locked'
      if (locked) setLock(this.replica, e.detail.lock as Lock)
      const current = this.#current(token)
      if (!current) return
      current.status = 'readonly'
      const shape = this.replica.shapes[id]
      if (shape) current.edit = fieldsOf(shape)
      if (keepEdits) this.#notify(`Couldn't get the lock back (${errorMessage(e)}), so your changes were discarded`, 'error')
      else if (!locked) this.#notify(errorMessage(e), 'error')
      return
    }
    const current = this.#current(token)
    // The user moved on while we waited; deselect() has already queued the release.
    if (!current) return
    const shape = this.replica.shapes[id]
    if (!shape) return
    if (keepEdits && shape.version !== current.baseVersion) {
      this.#notify(`${shape.updated_by} changed "${shape.name}" in the meantime, so your changes were discarded`, 'error')
      keepEdits = false
    }
    if (!keepEdits) {
      current.edit = fieldsOf(shape)
      current.baseVersion = shape.version
    }
    current.status = 'editing'
    current.lostReason = null
  }

  /** The selected shape, if it's still the selection identified by token. */
  #current(token: number) {
    const s = this.selection
    return s?.kind === 'shape' && s.token === token ? s : null
  }

  #lose(token: number, reason: string): void {
    const s = this.#current(token)
    if (!s || s.status !== 'editing') return
    s.status = 'lost'
    s.lostReason = reason
    this.#notify(reason, 'error')
  }

  #scheduleRenewals(): void {
    if (this.#renewTimer) clearInterval(this.#renewTimer)
    this.#renewTimer = setInterval(() => void this.#renew(), (this.config.lock_ttl_seconds * 1000) / 3)
  }

  async #renew(): Promise<void> {
    const s = this.selection
    if (s?.kind !== 'shape' || s.status !== 'editing') return
    // Idle: stop renewing and let the lock expire, so nobody holds a shape by walking away.
    if (Date.now() - this.#lastActivity > this.config.idle_release_seconds * 1000) return
    const { id, token } = s
    try {
      setLock(this.replica, await this.#send(() => this.#api.renewLock(id)))
    } catch (e) {
      if (e instanceof ApiError && e.code === 'lock_lost') this.#lose(token, LOST_REASONS.expired)
    }
  }

  // ---- editing ----------------------------------------------------------------

  /** Edits the name or color of whatever is editable right now. */
  setField(key: 'name' | 'color', value: string): void {
    const t = this.editTarget
    if (t) t.fields[key] = value
  }

  setGeometry(geometry: Polygon): void {
    const t = this.editTarget
    if (t) t.fields.geometry = geometry
  }

  async save(): Promise<void> {
    const s = this.selection
    if (s?.kind !== 'shape' || s.status !== 'editing' || this.busy) return
    const { id, token, baseVersion } = s
    const sent = fieldsOf(s.edit)
    this.busy = true
    try {
      const shape = await this.#send(() => this.#api.updateShape(id, sent, baseVersion))
      upsertShape(this.replica, shape)
      const current = this.#current(token)
      if (current) {
        current.baseVersion = shape.version
        // Keep anything the user changed while the save was in flight.
        if (sameFields(current.edit, sent)) current.edit = fieldsOf(shape)
      }
      this.#notify(`Saved "${shape.name}"`)
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'lock_required' || e.code === 'version_conflict')) this.#lose(token, e.message)
      else this.#notify(errorMessage(e), 'error')
    } finally {
      this.busy = false
    }
  }

  /** Throws away local changes and goes back to the server's copy. */
  reject(): void {
    const s = this.selection
    if (s?.kind !== 'shape') return
    const shape = this.replica.shapes[s.id]
    if (!shape) return
    s.edit = fieldsOf(shape)
    s.baseVersion = shape.version
    if (s.status === 'lost') {
      s.status = 'readonly'
      s.lostReason = null
    }
    this.#reloads++
  }

  async remove(): Promise<void> {
    const s = this.selection
    if (s?.kind !== 'shape' || s.status !== 'editing' || this.busy) return
    const { id, token } = s
    const name = this.replica.shapes[id]?.name ?? s.edit.name
    this.busy = true
    try {
      await this.#send(() => this.#api.deleteShape(id))
      removeShape(this.replica, id)
      if (this.#current(token)) this.selection = null
      this.#notify(`Deleted "${name}"`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'lock_required') this.#lose(token, e.message)
      else this.#notify(errorMessage(e), 'error')
    } finally {
      this.busy = false
    }
  }

  // ---- drafts -----------------------------------------------------------------

  startDrawing(): void {
    this.deselect()
    this.drawing = true
  }

  stopDrawing(): void {
    this.drawing = false
  }

  finishDrawing(geometry: Polygon): void {
    this.drawing = false
    const n = this.drafts.length + this.shapes.length + 1
    const draft: Draft = {
      id: crypto.randomUUID(),
      name: `Polygon ${n}`,
      color: SHAPE_COLORS[this.#nextColor++ % SHAPE_COLORS.length],
      geometry,
    }
    this.drafts.push(draft)
    this.select({ kind: 'draft', id: draft.id })
  }

  discardDraft(): void {
    const d = this.selectedDraft
    if (!d) return
    this.selection = null
    this.drafts = this.drafts.filter((x) => x.id !== d.id)
  }

  /** Saves the selected draft to the server, which shows it to everyone. */
  async pin(): Promise<void> {
    const d = this.selectedDraft
    if (!d || this.busy) return
    const draftId = d.id
    this.busy = true
    try {
      const shape = await this.#send(() => this.#api.createShape(fieldsOf(d)))
      upsertShape(this.replica, shape)
      this.drafts = this.drafts.filter((x) => x.id !== draftId)
      if (this.selection?.kind === 'draft' && this.selection.id === draftId) this.selection = null
      this.#notify(`Pinned "${shape.name}". Everyone can see it now.`)
    } catch (e) {
      this.#notify(errorMessage(e), 'error')
    } finally {
      this.busy = false
    }
  }

  // ---- server -----------------------------------------------------------------

  /** Requests go out one at a time, so the server sees them in the order the user acted. */
  #send<T>(request: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(request)
    this.#queue = result.catch(() => {})
    return result
  }

  #wsUrl(): string {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const q = new URLSearchParams({ client_id: this.clientId, name: this.name })
    return `${scheme}://${location.host}/ws?${q}`
  }

  #onDown(): void {
    this.connection = 'offline'
    const s = this.selection
    if (s?.kind === 'shape') this.#lose(s.token, LOST_REASONS.disconnected)
  }

  #onEvent(e: ServerEvent): void {
    const r = this.replica
    switch (e.type) {
      case 'snapshot':
        applySnapshot(r, e.shapes, e.locks)
        this.users = e.users
        this.config = e.config
        this.connection = 'online'
        this.#scheduleRenewals()
        this.#reconcile(LOST_REASONS.disconnected)
        break
      case 'shape_created':
      case 'shape_updated':
        upsertShape(r, e.shape)
        this.#reconcile(LOST_REASONS.released)
        break
      case 'shape_deleted': {
        const s = this.selection
        if (s?.kind === 'shape' && s.id === e.shape_id) {
          this.selection = null
          if (e.by_client_id !== this.clientId) this.#notify(`${e.by_name} deleted "${s.edit.name}"`)
        }
        removeShape(r, e.shape_id)
        break
      }
      case 'lock_acquired':
        setLock(r, e.lock)
        this.#reconcile(`${e.lock.user_name} took over the lock.`)
        break
      case 'lock_released':
        clearLock(r, e.lock)
        this.#reconcile(LOST_REASONS[e.reason])
        break
      case 'presence':
        this.users = e.users
        break
    }
  }

  /** Brings the selection in line with the replica after news from the server. */
  #reconcile(lostReason: string): void {
    const s = this.selection
    if (s?.kind !== 'shape') return
    const shape = this.replica.shapes[s.id]
    if (!shape) {
      this.selection = null
      this.#notify(`"${s.edit.name}" no longer exists`)
      return
    }
    if (s.status === 'editing' && this.replica.locks[s.id]?.client_id !== this.clientId) this.#lose(s.token, lostReason)
    else if (s.status === 'readonly') s.edit = fieldsOf(shape)
  }
}
