"""Shared polygons with short-lived edit locks.

REST endpoints change things; one WebSocket per client pushes every change to everyone.
Clients identify themselves with an X-Client-Id header that matches their open WebSocket,
so a client's locks can be released the moment its connection drops.

Run as a single process (locks are in memory):  uv run uvicorn app.main:create_app --factory --reload
"""

import asyncio
import os
import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket

from .hub import Client, Hub
from .locks import LockHeld, LockManager
from .models import Shape, ShapeFields, ShapeUpdate
from .store import ShapeStore, VersionConflict


def _conflict(code: str, message: str, **extra: object) -> HTTPException:
    return HTTPException(409, {"code": code, "message": message, **extra})


def _current_client(request: Request, x_client_id: Annotated[str, Header()]) -> Client:
    client = request.app.state.hub.get(x_client_id)
    if client is None:
        raise HTTPException(403, {"code": "not_connected", "message": "Connect to /ws before making changes"})
    return client


CurrentClient = Annotated[Client, Depends(_current_client)]


def create_app(
    db_path: str | None = None,
    lock_ttl: float | None = None,
    idle_release: float | None = None,
    sweep_interval: float = 1.0,
    clock: Callable[[], float] = time.monotonic,
) -> FastAPI:
    db_path = db_path or os.environ.get("DB_PATH", "shapes.db")
    # How long a lock lives without being renewed.
    lock_ttl = lock_ttl or float(os.environ.get("LOCK_TTL_SECONDS", "30"))
    # Clients stop renewing after this long without user activity, so an abandoned lock expires.
    idle_release = idle_release or float(os.environ.get("IDLE_RELEASE_SECONDS", "120"))

    store = ShapeStore(db_path)
    locks = LockManager(lock_ttl, clock)
    hub = Hub()

    def sweep() -> None:
        for lock in locks.expire():
            hub.broadcast({"type": "lock_released", "lock": lock.public(), "reason": "expired"})

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async def sweep_forever() -> None:
            while True:
                await asyncio.sleep(sweep_interval)
                sweep()

        task = asyncio.create_task(sweep_forever())
        yield
        task.cancel()
        store.close()

    app = FastAPI(title="Collaborative shapes", lifespan=lifespan)
    app.state.hub = hub
    app.state.sweep = sweep

    def existing_shape(shape_id: str) -> Shape:
        shape = store.get(shape_id)
        if shape is None:
            raise HTTPException(404, {"code": "not_found", "message": "That shape no longer exists"})
        return shape

    def require_lock(shape_id: str, client: Client) -> None:
        sweep()
        if not locks.holds(shape_id, client.id):
            raise _conflict("lock_required", "You don't hold the lock on this shape")

    def snapshot() -> dict:
        return {
            "type": "snapshot",
            "shapes": [s.model_dump(mode="json") for s in store.list()],
            "locks": [lock.public() for lock in locks.all()],
            "users": hub.users(),
            "config": {"lock_ttl_seconds": lock_ttl, "idle_release_seconds": idle_release},
        }

    # ---- shapes ---------------------------------------------------------------

    @app.get("/api/shapes")
    async def list_shapes() -> dict:
        sweep()
        return {"shapes": store.list(), "locks": [lock.public() for lock in locks.all()]}

    @app.post("/api/shapes", status_code=201)
    async def create_shape(body: ShapeFields, client: CurrentClient) -> Shape:
        """Pins a drafted polygon so everyone sees it."""
        shape = store.create(body, client.name)
        hub.broadcast({"type": "shape_created", "shape": shape.model_dump(mode="json")})
        return shape

    @app.put("/api/shapes/{shape_id}")
    async def update_shape(shape_id: str, body: ShapeUpdate, client: CurrentClient) -> Shape:
        """Saves an edit. Needs the lock, and the shape must still be at base_version."""
        existing_shape(shape_id)
        require_lock(shape_id, client)
        try:
            shape = store.update(shape_id, body, body.base_version, client.name)
        except VersionConflict as e:
            raise _conflict(
                "version_conflict",
                f"This shape changed since you started editing (now version {e.current.version})",
                shape=e.current.model_dump(mode="json"),
            ) from e
        hub.broadcast({"type": "shape_updated", "shape": shape.model_dump(mode="json")})
        return shape

    @app.delete("/api/shapes/{shape_id}", status_code=204)
    async def delete_shape(shape_id: str, client: CurrentClient) -> None:
        existing_shape(shape_id)
        require_lock(shape_id, client)
        store.delete(shape_id)
        locks.discard(shape_id)
        hub.broadcast({"type": "shape_deleted", "shape_id": shape_id, "by_client_id": client.id, "by_name": client.name})

    # ---- locks ----------------------------------------------------------------

    @app.post("/api/shapes/{shape_id}/lock")
    async def acquire_lock(shape_id: str, client: CurrentClient) -> dict:
        existing_shape(shape_id)
        sweep()
        try:
            lock, is_new = locks.acquire(shape_id, client.id, client.name)
        except LockHeld as e:
            raise _conflict("locked", str(e), lock=e.lock.public()) from e
        if is_new:
            hub.broadcast({"type": "lock_acquired", "lock": lock.public()})
        return lock.public()

    @app.post("/api/shapes/{shape_id}/lock/renew")
    async def renew_lock(shape_id: str, client: CurrentClient) -> dict:
        sweep()
        lock = locks.renew(shape_id, client.id)
        if lock is None:
            raise _conflict("lock_lost", "Your lock on this shape has expired")
        return lock.public()

    @app.delete("/api/shapes/{shape_id}/lock", status_code=204)
    async def release_lock(shape_id: str, client: CurrentClient) -> None:
        """Idempotent: releasing a lock you don't hold is a no-op."""
        lock = locks.release(shape_id, client.id)
        if lock:
            hub.broadcast({"type": "lock_released", "lock": lock.public(), "reason": "released"})

    # ---- live connection ------------------------------------------------------

    @app.websocket("/ws")
    async def live(ws: WebSocket, client_id: str, name: str) -> None:
        await ws.accept()
        client = Client(client_id, name.strip()[:40] or "Anonymous", ws)
        # Queue the snapshot and register in one step, so the client misses no event in between.
        client.send(snapshot())
        replaced = hub.add(client)
        if replaced:
            replaced.close()
        hub.broadcast({"type": "presence", "users": hub.users()})
        writer = asyncio.create_task(client.write_loop())
        try:
            # Clients don't send anything yet; this just waits for the disconnect.
            while (await ws.receive())["type"] != "websocket.disconnect":
                pass
        finally:
            writer.cancel()
            if hub.remove(client):
                for lock in locks.release_all(client.id):
                    hub.broadcast({"type": "lock_released", "lock": lock.public(), "reason": "disconnected"})
                hub.broadcast({"type": "presence", "users": hub.users()})

    return app

