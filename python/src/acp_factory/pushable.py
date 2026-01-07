"""
Pushable - A push-based async iterable for streaming session updates.
"""

from __future__ import annotations

import asyncio
from typing import Generic, TypeVar

T = TypeVar("T")


class Pushable(Generic[T]):
    """
    A pushable async iterable for bridging push-based and async-iterator-based code.

    Used to stream session updates to consumers. Items can be pushed at any time,
    and consumers can iterate over them asynchronously.

    Example:
        ```python
        pushable = Pushable[str]()

        # Push items (can be done from anywhere)
        pushable.push("hello")
        pushable.push("world")
        pushable.end()

        # Consume items
        async for item in pushable:
            print(item)
        ```
    """

    def __init__(self) -> None:
        self._queue: list[T] = []
        self._waiters: list[asyncio.Future[T]] = []
        self._done: bool = False

    def push(self, item: T) -> None:
        """
        Push an item to the queue.

        If there are waiters, the first waiter receives the item immediately.
        Otherwise, the item is added to the queue.

        Items pushed after `end()` is called are ignored.
        """
        if self._done:
            return

        if self._waiters:
            waiter = self._waiters.pop(0)
            if not waiter.done():
                waiter.set_result(item)
        else:
            self._queue.append(item)

    def end(self) -> None:
        """
        Signal that no more items will be pushed.

        All waiting consumers will receive StopAsyncIteration.
        """
        self._done = True
        # Cancel all waiters - they will raise StopAsyncIteration
        for waiter in self._waiters:
            if not waiter.done():
                waiter.cancel()
        self._waiters.clear()

    def is_done(self) -> bool:
        """Check if the pushable has ended."""
        return self._done

    def __aiter__(self) -> Pushable[T]:
        """Return self as the async iterator."""
        return self

    async def __anext__(self) -> T:
        """
        Get the next item from the queue.

        If the queue is empty and not done, waits for an item to be pushed.
        If the queue is empty and done, raises StopAsyncIteration.
        """
        # If there are items in the queue, return the first one
        if self._queue:
            return self._queue.pop(0)

        # If done and no items, stop iteration
        if self._done:
            raise StopAsyncIteration

        # Wait for an item to be pushed
        loop = asyncio.get_event_loop()
        waiter: asyncio.Future[T] = loop.create_future()
        self._waiters.append(waiter)

        try:
            return await waiter
        except asyncio.CancelledError:
            # Waiter was cancelled (likely due to end() being called)
            raise StopAsyncIteration
