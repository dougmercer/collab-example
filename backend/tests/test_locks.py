import pytest

from app.locks import LockHeld, LockManager


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def locks(clock: FakeClock) -> LockManager:
    return LockManager(ttl=30, clock=clock)


def test_first_client_gets_the_lock_and_others_are_refused(locks: LockManager) -> None:
    lock, is_new = locks.acquire("s1", "a", "Alice")
    assert is_new and lock.client_id == "a"
    with pytest.raises(LockHeld) as e:
        locks.acquire("s1", "b", "Bob")
    assert e.value.lock.user_name == "Alice"


def test_reacquiring_your_own_lock_extends_it(locks: LockManager, clock: FakeClock) -> None:
    first, _ = locks.acquire("s1", "a", "Alice")
    clock.now += 20
    again, is_new = locks.acquire("s1", "a", "Alice")
    assert not is_new and again.id == first.id
    clock.now += 20
    assert locks.holds("s1", "a")


def test_lock_expires_after_ttl(locks: LockManager, clock: FakeClock) -> None:
    locks.acquire("s1", "a", "Alice")
    clock.now += 30
    assert locks.get("s1") is None
    assert locks.renew("s1", "a") is None
    assert [lock.shape_id for lock in locks.expire()] == ["s1"]
    assert locks.expire() == []


def test_renew_keeps_the_lock_alive(locks: LockManager, clock: FakeClock) -> None:
    locks.acquire("s1", "a", "Alice")
    clock.now += 25
    assert locks.renew("s1", "a") is not None
    clock.now += 25
    assert locks.holds("s1", "a")


def test_expired_lock_can_be_taken_by_someone_else(locks: LockManager, clock: FakeClock) -> None:
    old, _ = locks.acquire("s1", "a", "Alice")
    clock.now += 31
    new, is_new = locks.acquire("s1", "b", "Bob")
    assert is_new and new.client_id == "b" and new.id > old.id


def test_only_the_holder_can_release(locks: LockManager) -> None:
    locks.acquire("s1", "a", "Alice")
    assert locks.release("s1", "b") is None
    assert locks.release("s1", "a") is not None
    assert locks.get("s1") is None


def test_release_all_frees_only_that_clients_locks(locks: LockManager) -> None:
    locks.acquire("s1", "a", "Alice")
    locks.acquire("s2", "a", "Alice")
    locks.acquire("s3", "b", "Bob")
    released = locks.release_all("a")
    assert sorted(lock.shape_id for lock in released) == ["s1", "s2"]
    assert [lock.shape_id for lock in locks.all()] == ["s3"]
