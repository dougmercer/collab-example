"""Connected clients and fan-out of events to them."""

import asyncio
import logging
from dataclasses import dataclass, field

from fastapi import WebSocket

log = logging.getLogger(__name__)

# Put on a client's queue to make its writer close the socket.
_CLOSE = object()


@dataclass(eq=False)
class Client:
    id: str
    name: str
    ws: WebSocket
    # Each client has its own outbox, so events reach it in order and a slow client never holds up the rest.
    outbox: asyncio.Queue = field(default_factory=asyncio.Queue)

    def send(self, event: dict) -> None:
        self.outbox.put_nowait(event)

    def close(self) -> None:
        self.outbox.put_nowait(_CLOSE)

    async def write_loop(self) -> None:
        try:
            while True:
                event = await self.outbox.get()
                if event is _CLOSE:
                    # 4000: this client id connected again elsewhere, so this socket is obsolete.
                    await self.ws.close(code=4000)
                    return
                await self.ws.send_json(event)
        except Exception:  # the socket is gone; the read loop cleans up
            log.debug("stopped writing to %s", self.id, exc_info=True)


class Hub:
    def __init__(self) -> None:
        self._clients: dict[str, Client] = {}

    def add(self, client: Client) -> Client | None:
        """Registers a client. Returns the connection it replaced, if the same client id was already connected."""
        previous = self._clients.get(client.id)
        self._clients[client.id] = client
        return previous

    def remove(self, client: Client) -> bool:
        """Unregisters a connection. False if a newer connection for the same client id replaced it."""
        if self._clients.get(client.id) is not client:
            return False
        del self._clients[client.id]
        return True

    def get(self, client_id: str) -> Client | None:
        return self._clients.get(client_id)

    def users(self) -> list[dict]:
        return [{"client_id": c.id, "name": c.name} for c in self._clients.values()]

    def broadcast(self, event: dict) -> None:
        for client in self._clients.values():
            client.send(event)
