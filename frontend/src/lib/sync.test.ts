import { describe, expect, it } from 'vitest'
import { applySnapshot, clearLock, emptyReplica, removeShape, setLock, upsertShape } from './sync'
import type { Lock, Shape } from './types'

const shape = (version: number, name = 'Field'): Shape => ({
  id: 's1',
  name,
  color: '#1e6fd9',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  version,
  updated_by: 'Alice',
  updated_at: '2026-10-17T12:00:00Z',
})

const lock = (id: number, client_id = 'a'): Lock => ({ id, shape_id: 's1', client_id, user_name: client_id })

describe('shapes', () => {
  it('keeps the newest version whatever order updates arrive in', () => {
    const r = emptyReplica()
    expect(upsertShape(r, shape(2, 'new'))).toBe(true)
    expect(upsertShape(r, shape(1, 'old'))).toBe(false)
    expect(r.shapes.s1.name).toBe('new')
  })

  it('does not bring back a deleted shape', () => {
    const r = emptyReplica()
    upsertShape(r, shape(1))
    removeShape(r, 's1')
    expect(upsertShape(r, shape(2))).toBe(false)
    expect(r.shapes.s1).toBeUndefined()
  })
})

describe('locks', () => {
  it('ignores an acquire that arrives after its release', () => {
    const r = emptyReplica()
    clearLock(r, lock(5))
    expect(setLock(r, lock(5))).toBe(false)
    expect(r.locks.s1).toBeUndefined()
  })

  it('does not let an old release remove a newer lock', () => {
    const r = emptyReplica()
    setLock(r, lock(6, 'b'))
    expect(clearLock(r, lock(5, 'a'))).toBe(false)
    expect(r.locks.s1.client_id).toBe('b')
  })

  it('does not let an old acquire replace a newer lock', () => {
    const r = emptyReplica()
    setLock(r, lock(6, 'b'))
    expect(setLock(r, lock(5, 'a'))).toBe(false)
    expect(r.locks.s1.client_id).toBe('b')
  })

  it('takes the snapshot as the truth but remembers what was released', () => {
    const r = emptyReplica()
    clearLock(r, lock(5))
    applySnapshot(r, [shape(3)], [lock(7, 'b')])
    expect(r.shapes.s1.version).toBe(3)
    expect(r.locks.s1.id).toBe(7)
    expect(setLock(r, lock(5))).toBe(false)
  })
})
