import type { Lock, Shape, ShapeFields } from './types'

export class ApiError extends Error {
  readonly status: number
  /** The backend's error code: locked, lock_required, lock_lost, version_conflict, not_connected, … */
  readonly code: string
  readonly detail: Record<string, unknown>

  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** REST calls, made as the client whose WebSocket is open. */
export function createApi(clientId: string) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new ApiError(0, 'network', "Couldn't reach the server")
    }
    if (res.status === 204) return undefined as T
    const data = await res.json().catch(() => null)
    if (res.ok) return data as T
    const detail = data?.detail
    if (detail && typeof detail === 'object' && 'code' in detail) {
      throw new ApiError(res.status, String(detail.code), String(detail.message), detail)
    }
    if (res.status === 422) throw new ApiError(422, 'invalid', 'The server rejected this shape as invalid')
    throw new ApiError(res.status, 'error', `Request failed (${res.status})`)
  }

  return {
    createShape: (fields: ShapeFields) => request<Shape>('POST', '/shapes', fields),
    updateShape: (id: string, fields: ShapeFields, baseVersion: number) =>
      request<Shape>('PUT', `/shapes/${id}`, { ...fields, base_version: baseVersion }),
    deleteShape: (id: string) => request<void>('DELETE', `/shapes/${id}`),
    acquireLock: (id: string) => request<Lock>('POST', `/shapes/${id}/lock`),
    renewLock: (id: string) => request<Lock>('POST', `/shapes/${id}/lock/renew`),
    releaseLock: (id: string) => request<void>('DELETE', `/shapes/${id}/lock`),
  }
}

export type Api = ReturnType<typeof createApi>
