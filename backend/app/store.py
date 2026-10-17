"""Saved shapes, in SQLite."""

import json
import sqlite3
import uuid
from datetime import UTC, datetime

from .models import Shape, ShapeFields


class VersionConflict(Exception):
    """The shape changed since the edit started."""

    def __init__(self, current: Shape):
        super().__init__(f"shape is at version {current.version}")
        self.current = current


class ShapeStore:
    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS shapes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                geometry TEXT NOT NULL,
                version INTEGER NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    @staticmethod
    def _shape(row: sqlite3.Row) -> Shape:
        return Shape(
            id=row["id"],
            name=row["name"],
            color=row["color"],
            geometry=json.loads(row["geometry"]),
            version=row["version"],
            updated_by=row["updated_by"],
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    def list(self) -> list[Shape]:
        return [self._shape(r) for r in self._db.execute("SELECT * FROM shapes ORDER BY updated_at")]

    def get(self, shape_id: str) -> Shape | None:
        row = self._db.execute("SELECT * FROM shapes WHERE id = ?", (shape_id,)).fetchone()
        return self._shape(row) if row else None

    def create(self, fields: ShapeFields, user_name: str) -> Shape:
        shape = Shape(
            **fields.model_dump(),
            id=str(uuid.uuid4()),
            version=1,
            updated_by=user_name,
            updated_at=datetime.now(UTC),
        )
        self._db.execute(
            "INSERT INTO shapes VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                shape.id,
                shape.name,
                shape.color,
                shape.geometry.model_dump_json(),
                shape.version,
                shape.updated_by,
                shape.updated_at.isoformat(),
            ),
        )
        self._db.commit()
        return shape

    def update(self, shape_id: str, fields: ShapeFields, base_version: int, user_name: str) -> Shape:
        """Writes the edit only if the shape is still at base_version. Raises KeyError or VersionConflict."""
        now = datetime.now(UTC)
        cursor = self._db.execute(
            """UPDATE shapes SET name = ?, color = ?, geometry = ?, version = version + 1, updated_by = ?, updated_at = ?
               WHERE id = ? AND version = ?""",
            (
                fields.name,
                fields.color,
                fields.geometry.model_dump_json(),
                user_name,
                now.isoformat(),
                shape_id,
                base_version,
            ),
        )
        self._db.commit()
        current = self.get(shape_id)
        if current is None:
            raise KeyError(shape_id)
        if cursor.rowcount == 0:
            raise VersionConflict(current)
        return current

    def delete(self, shape_id: str) -> bool:
        cursor = self._db.execute("DELETE FROM shapes WHERE id = ?", (shape_id,))
        self._db.commit()
        return cursor.rowcount > 0
