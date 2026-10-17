import type { Polygon } from 'geojson'

/** The parts of a shape a user edits. */
export interface ShapeFields {
  name: string
  color: string
  geometry: Polygon
}

export interface Shape extends ShapeFields {
  id: string
  version: number
  updated_by: string
  updated_at: string
}

export interface Lock {
  /** Higher for every new lock, so stale lock events can be told apart from current ones. */
  id: number
  shape_id: string
  client_id: string
  user_name: string
}

export interface User {
  client_id: string
  name: string
}

export interface ServerConfig {
  lock_ttl_seconds: number
  idle_release_seconds: number
}

export type ReleaseReason = 'released' | 'expired' | 'disconnected'

export type ServerEvent =
  | { type: 'snapshot'; shapes: Shape[]; locks: Lock[]; users: User[]; config: ServerConfig }
  | { type: 'shape_created'; shape: Shape }
  | { type: 'shape_updated'; shape: Shape }
  | { type: 'shape_deleted'; shape_id: string; by_client_id: string; by_name: string }
  | { type: 'lock_acquired'; lock: Lock }
  | { type: 'lock_released'; lock: Lock; reason: ReleaseReason }
  | { type: 'presence'; users: User[] }
