import type { Lock, Shape } from './types'

/**
 * The client's copy of what the server has.
 *
 * REST responses and WebSocket events travel separately and can arrive in either order,
 * so every merge keeps whichever information is newest: shapes by version, locks by id.
 */
export interface Replica {
  shapes: Record<string, Shape>
  /** Keyed by shape id. */
  locks: Record<string, Lock>
  /** Shapes known to be deleted, so a late update can't bring one back. */
  deleted: Record<string, true>
  /** Per shape, the highest lock id known to be released, so a late "acquired" can't revive it. */
  releasedLockIds: Record<string, number>
}

export const emptyReplica = (): Replica => ({ shapes: {}, locks: {}, deleted: {}, releasedLockIds: {} })

/** Replaces shapes and locks with the server's full state (on every connect). */
export function applySnapshot(r: Replica, shapes: Shape[], locks: Lock[]): void {
  r.shapes = Object.fromEntries(shapes.map((s) => [s.id, s]))
  r.locks = Object.fromEntries(locks.map((l) => [l.shape_id, l]))
}

export function upsertShape(r: Replica, shape: Shape): boolean {
  if (r.deleted[shape.id]) return false
  const current = r.shapes[shape.id]
  if (current && current.version >= shape.version) return false
  r.shapes[shape.id] = shape
  return true
}

export function removeShape(r: Replica, id: string): void {
  delete r.shapes[id]
  delete r.locks[id]
  r.deleted[id] = true
}

export function setLock(r: Replica, lock: Lock): boolean {
  if (r.deleted[lock.shape_id]) return false
  if (lock.id <= (r.releasedLockIds[lock.shape_id] ?? 0)) return false
  const current = r.locks[lock.shape_id]
  if (current && current.id > lock.id) return false
  r.locks[lock.shape_id] = lock
  return true
}

export function clearLock(r: Replica, lock: Lock): boolean {
  r.releasedLockIds[lock.shape_id] = Math.max(lock.id, r.releasedLockIds[lock.shape_id] ?? 0)
  const current = r.locks[lock.shape_id]
  // A newer lock than the one released stays.
  if (!current || current.id > lock.id) return false
  delete r.locks[lock.shape_id]
  return true
}
