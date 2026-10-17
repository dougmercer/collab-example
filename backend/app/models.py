from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator


class Polygon(BaseModel):
    """A GeoJSON Polygon. Rings must be closed: first position == last position."""

    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[Annotated[list[float], Field(min_length=2, max_length=3)]]]

    @field_validator("coordinates")
    @classmethod
    def _closed_rings(cls, rings: list[list[list[float]]]) -> list[list[list[float]]]:
        if not rings:
            raise ValueError("a polygon needs at least one ring")
        for ring in rings:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("each ring needs at least 4 positions and must be closed")
        return rings


class ShapeFields(BaseModel):
    """The parts of a shape a user edits."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
    geometry: Polygon


class ShapeUpdate(ShapeFields):
    # The version the edit started from. A save is refused if the shape has moved on since.
    base_version: int


class Shape(ShapeFields):
    id: str
    version: int
    updated_by: str
    updated_at: datetime
