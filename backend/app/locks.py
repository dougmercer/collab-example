"""Short-lived edit locks (leases) on shapes.

Locks live in memory, so the app must run as a single process: a second worker
would keep its own, separate set of locks.
"""

import itertools
import time
from collections.abc import Callable
from dataclasses import dataclass


@dataclass
class Lock:
    # Every new lock gets a higher id, so clients can tell a stale lock event from a current one.
    id: int
    shape_id: str
    client_id: str
    user_name: str
    expires_at: float

    def public(self) -> dict:
        return {"id": self.id, "shape_id": self.shape_id, "client_id": self.client_id, "user_name": self.user_name}


class LockHeld(Exception):
    """Another client holds the lock."""

    def __init__(self, lock: Lock):
        super().__init__(f"{lock.user_name} is editing this shape")
        self.lock = lock


class LockManager:
    def __init__(self, ttl: float, clock: Callable[[], float] = time.monotonic):
        self.ttl = ttl
        self._clock = clock
        self._locks: dict[str, Lock] = {}
        # Seeded from the wall clock so ids keep increasing across server restarts.
        self._ids = itertools.count(time.time_ns() // 1_000_000)

    def get(self, shape_id: str) -> Lock | None:
        """The live lock on a shape. Expired locks count as free even before expire() removes them."""
        lock = self._locks.get(shape_id)
        return lock if lock and lock.expires_at > self._clock() else None

    def holds(self, shape_id: str, client_id: str) -> bool:
        lock = self.get(shape_id)
        return lock is not None and lock.client_id == client_id

    def all(self) -> list[Lock]:
        return [lock for lock in self._locks.values() if lock.expires_at > self._clock()]

    def acquire(self, shape_id: str, client_id: str, user_name: str) -> tuple[Lock, bool]:
        """Takes the lock, or extends it if this client already holds it.

        Returns the lock and whether it is new. Raises LockHeld if someone else has it.
        """
        lock = self.get(shape_id)
        if lock and lock.client_id != client_id:
            raise LockHeld(lock)
        if lock:
            lock.expires_at = self._clock() + self.ttl
            return lock, False
        lock = Lock(next(self._ids), shape_id, client_id, user_name, self._clock() + self.ttl)
        self._locks[shape_id] = lock
        return lock, True

    def renew(self, shape_id: str, client_id: str) -> Lock | None:
        """Extends a lock the client still holds. None if it has expired or was never theirs."""
        if not self.holds(shape_id, client_id):
            return None
        lock = self._locks[shape_id]
        lock.expires_at = self._clock() + self.ttl
        return lock

    def release(self, shape_id: str, client_id: str) -> Lock | None:
        """Releases the client's lock. None if they didn't hold it."""
        if not self.holds(shape_id, client_id):
            return None
        return self._locks.pop(shape_id)

    def release_all(self, client_id: str) -> list[Lock]:
        """Releases every live lock the client holds (on disconnect)."""
        mine = [lock for lock in self.all() if lock.client_id == client_id]
        for lock in mine:
            del self._locks[lock.shape_id]
        return mine

    def discard(self, shape_id: str) -> None:
        """Forgets the lock on a shape that no longer exists."""
        self._locks.pop(shape_id, None)

    def expire(self) -> list[Lock]:
        """Removes expired locks and returns them."""
        now = self._clock()
        expired = [lock for lock in self._locks.values() if lock.expires_at <= now]
        for lock in expired:
            del self._locks[lock.shape_id]
        return expired
