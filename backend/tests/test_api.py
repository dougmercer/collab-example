from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app

from .test_locks import FakeClock

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}


def fields(**overrides: object) -> dict:
    return {"name": "Field", "color": "#1e6fd9", "geometry": SQUARE, **overrides}


def as_(client_id: str) -> dict:
    return {"X-Client-Id": client_id}


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def http(clock: FakeClock, tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(db_path=str(tmp_path / "shapes.db"), lock_ttl=30, idle_release=120, sweep_interval=3600, clock=clock)
    with TestClient(app) as client:
        yield client


@contextmanager
def connect(http: TestClient, client_id: str, name: str):
    with http.websocket_connect(f"/ws?client_id={client_id}&name={name}") as ws:
        assert ws.receive_json()["type"] == "snapshot"
        yield ws


def next_event(ws, type_: str) -> dict:
    """The next event of this type, skipping others (presence updates, mostly)."""
    while True:
        event = ws.receive_json()
        if event["type"] == type_:
            return event


def pin(http: TestClient, client_id: str = "a") -> dict:
    res = http.post("/api/shapes", json=fields(), headers=as_(client_id))
    assert res.status_code == 201, res.text
    return res.json()


def test_changes_need_a_live_connection(http: TestClient) -> None:
    res = http.post("/api/shapes", json=fields(), headers=as_("nobody"))
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "not_connected"


def test_snapshot_has_existing_shapes_locks_and_config(http: TestClient) -> None:
    with connect(http, "a", "Alice"):
        shape = pin(http)
        http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a"))
        with http.websocket_connect("/ws?client_id=b&name=Bob") as ws_b:
            snap = ws_b.receive_json()
    assert [s["id"] for s in snap["shapes"]] == [shape["id"]]
    assert snap["locks"][0]["user_name"] == "Alice"
    assert snap["config"] == {"lock_ttl_seconds": 30, "idle_release_seconds": 120}


def test_pinning_a_shape_reaches_everyone(http: TestClient) -> None:
    with connect(http, "a", "Alice"), connect(http, "b", "Bob") as ws_b:
        shape = pin(http)
        assert shape["version"] == 1 and shape["updated_by"] == "Alice"
        assert next_event(ws_b, "shape_created")["shape"]["id"] == shape["id"]


def test_invalid_polygon_is_rejected(http: TestClient) -> None:
    open_ring = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1]]]}
    with connect(http, "a", "Alice"):
        res = http.post("/api/shapes", json=fields(geometry=open_ring), headers=as_("a"))
    assert res.status_code == 422


def test_lock_is_exclusive(http: TestClient) -> None:
    with connect(http, "a", "Alice"), connect(http, "b", "Bob") as ws_b:
        shape = pin(http)
        assert http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a")).status_code == 200
        assert next_event(ws_b, "lock_acquired")["lock"]["user_name"] == "Alice"

        res = http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("b"))
        assert res.status_code == 409
        assert res.json()["detail"]["code"] == "locked"
        assert res.json()["detail"]["lock"]["user_name"] == "Alice"


def test_saving_needs_the_lock(http: TestClient) -> None:
    with connect(http, "a", "Alice"), connect(http, "b", "Bob"):
        shape = pin(http)
        http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a"))
        res = http.put(f"/api/shapes/{shape['id']}", json=fields(base_version=1), headers=as_("b"))
        assert res.status_code == 409
        assert res.json()["detail"]["code"] == "lock_required"


def test_save_bumps_the_version_and_reaches_everyone(http: TestClient) -> None:
    with connect(http, "a", "Alice"), connect(http, "b", "Bob") as ws_b:
        shape = pin(http)
        http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a"))
        res = http.put(f"/api/shapes/{shape['id']}", json=fields(name="Renamed", base_version=1), headers=as_("a"))
        assert res.status_code == 200
        assert res.json()["version"] == 2
        updated = next_event(ws_b, "shape_updated")["shape"]
        assert (updated["name"], updated["version"]) == ("Renamed", 2)


def test_save_from_a_stale_version_is_refused(http: TestClient) -> None:
    with connect(http, "a", "Alice"):
        shape = pin(http)
        http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a"))
        http.put(f"/api/shapes/{shape['id']}", json=fields(base_version=1), headers=as_("a"))
        res = http.put(f"/api/shapes/{shape['id']}", json=fields(base_version=1), headers=as_("a"))
        assert res.status_code == 409
        assert res.json()["detail"]["code"] == "version_conflict"
        assert res.json()["detail"]["shape"]["version"] == 2


def test_releasing_lets_someone_else_edit(http: TestClient) -> None:
    with connect(http, "a", "Alice"), connect(http, "b", "Bob") as ws_b:
        shape = pin(http)
        http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a"))
        assert http.delete(f"/api/shapes/{shape['id']}/lock", headers=as_("a")).status_code == 204
        assert next_event(ws_b, "lock_released")["reason"] == "released"
        assert http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("b")).status_code == 200


def test_disconnecting_releases_your_locks(http: TestClient) -> None:
    with connect(http, "b", "Bob") as ws_b:
        with connect(http, "a", "Alice"):
            shape = pin(http)
            http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a"))
        event = next_event(ws_b, "lock_released")
        assert event["reason"] == "disconnected" and event["lock"]["shape_id"] == shape["id"]
        assert [u["name"] for u in next_event(ws_b, "presence")["users"]] == ["Bob"]


def test_unrenewed_lock_expires(http: TestClient, clock: FakeClock) -> None:
    with connect(http, "a", "Alice"), connect(http, "b", "Bob") as ws_b:
        shape = pin(http)
        http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a"))
        clock.now += 31
        http.app.state.sweep()
        assert next_event(ws_b, "lock_released")["reason"] == "expired"

        renew = http.post(f"/api/shapes/{shape['id']}/lock/renew", headers=as_("a"))
        assert renew.json()["detail"]["code"] == "lock_lost"
        save = http.put(f"/api/shapes/{shape['id']}", json=fields(base_version=1), headers=as_("a"))
        assert save.json()["detail"]["code"] == "lock_required"


def test_renewing_keeps_the_lock(http: TestClient, clock: FakeClock) -> None:
    with connect(http, "a", "Alice"):
        shape = pin(http)
        http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a"))
        clock.now += 20
        assert http.post(f"/api/shapes/{shape['id']}/lock/renew", headers=as_("a")).status_code == 200
        clock.now += 20
        res = http.put(f"/api/shapes/{shape['id']}", json=fields(base_version=1), headers=as_("a"))
        assert res.status_code == 200


def test_deleting_needs_the_lock_and_reaches_everyone(http: TestClient) -> None:
    with connect(http, "a", "Alice"), connect(http, "b", "Bob") as ws_b:
        shape = pin(http)
        assert http.delete(f"/api/shapes/{shape['id']}", headers=as_("a")).status_code == 409
        http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a"))
        assert http.delete(f"/api/shapes/{shape['id']}", headers=as_("a")).status_code == 204
        assert next_event(ws_b, "shape_deleted")["shape_id"] == shape["id"]
        assert http.get("/api/shapes").json() == {"shapes": [], "locks": []}


def test_reconnecting_with_the_same_id_keeps_locks(http: TestClient) -> None:
    with connect(http, "a", "Alice") as old:
        shape = pin(http)
        http.post(f"/api/shapes/{shape['id']}/lock", headers=as_("a"))
        with connect(http, "a", "Alice"):
            with pytest.raises(WebSocketDisconnect) as closed:
                while True:
                    old.receive_json()
            assert closed.value.code == 4000
            res = http.put(f"/api/shapes/{shape['id']}", json=fields(base_version=1), headers=as_("a"))
            assert res.status_code == 200
