"""Tests for Pushable async iterable."""

import asyncio

import pytest

from acp_factory.pushable import Pushable


class TestPushable:
    """Tests for the Pushable class."""

    @pytest.mark.asyncio
    async def test_should_yield_pushed_items_in_order(self) -> None:
        """Items pushed before iteration are yielded in order."""
        pushable: Pushable[int] = Pushable()
        pushable.push(1)
        pushable.push(2)
        pushable.push(3)
        pushable.end()

        results: list[int] = []
        async for item in pushable:
            results.append(item)

        assert results == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_should_wait_for_items_when_queue_is_empty(self) -> None:
        """Awaiting on empty queue blocks until item pushed."""
        pushable: Pushable[str] = Pushable()

        # Start consuming in background
        async def consume() -> list[str]:
            results: list[str] = []
            async for item in pushable:
                results.append(item)
            return results

        consume_task = asyncio.create_task(consume())

        # Give the consumer time to start waiting
        await asyncio.sleep(0.01)

        # Push items
        pushable.push("a")
        pushable.push("b")
        pushable.end()

        results = await consume_task
        assert results == ["a", "b"]

    @pytest.mark.asyncio
    async def test_should_return_done_when_ended(self) -> None:
        """Iterator returns done when ended."""
        pushable: Pushable[int] = Pushable()
        pushable.end()

        results: list[int] = []
        async for item in pushable:
            results.append(item)

        assert results == []

    @pytest.mark.asyncio
    async def test_should_ignore_pushes_after_end(self) -> None:
        """Pushes after end() are ignored."""
        pushable: Pushable[int] = Pushable()
        pushable.push(1)
        pushable.end()
        pushable.push(2)  # Should be ignored

        results: list[int] = []
        async for item in pushable:
            results.append(item)

        assert results == [1]

    def test_should_report_is_done_correctly(self) -> None:
        """is_done() reflects state correctly."""
        pushable: Pushable[int] = Pushable()
        assert pushable.is_done() is False
        pushable.end()
        assert pushable.is_done() is True

    @pytest.mark.asyncio
    async def test_should_handle_multiple_waiters(self) -> None:
        """Multiple waiters receive items in order."""
        pushable: Pushable[int] = Pushable()

        async def get_next() -> int | None:
            try:
                return await pushable.__anext__()
            except StopAsyncIteration:
                return None

        # Start multiple waiters
        task1 = asyncio.create_task(get_next())
        task2 = asyncio.create_task(get_next())

        await asyncio.sleep(0.01)

        # Push items
        pushable.push(1)
        pushable.push(2)
        pushable.end()

        result1 = await task1
        result2 = await task2

        assert result1 == 1
        assert result2 == 2

    @pytest.mark.asyncio
    async def test_should_handle_interleaved_push_and_consume(self) -> None:
        """Items can be pushed and consumed in interleaved fashion."""
        pushable: Pushable[str] = Pushable()
        results: list[str] = []

        async def consume() -> None:
            async for item in pushable:
                results.append(item)

        consume_task = asyncio.create_task(consume())

        await asyncio.sleep(0.01)
        pushable.push("first")

        await asyncio.sleep(0.01)
        pushable.push("second")

        await asyncio.sleep(0.01)
        pushable.push("third")
        pushable.end()

        await consume_task

        assert results == ["first", "second", "third"]

    @pytest.mark.asyncio
    async def test_should_cancel_waiters_on_end(self) -> None:
        """Waiters are properly cancelled when end() is called."""
        pushable: Pushable[int] = Pushable()

        async def wait_for_item() -> int | None:
            try:
                return await pushable.__anext__()
            except StopAsyncIteration:
                return None

        # Start waiting
        wait_task = asyncio.create_task(wait_for_item())

        await asyncio.sleep(0.01)

        # End without pushing anything
        pushable.end()

        result = await wait_task
        assert result is None

    @pytest.mark.asyncio
    async def test_should_work_with_different_types(self) -> None:
        """Pushable works with different types."""
        # Test with dict
        pushable: Pushable[dict[str, int]] = Pushable()
        pushable.push({"a": 1})
        pushable.push({"b": 2})
        pushable.end()

        results: list[dict[str, int]] = []
        async for item in pushable:
            results.append(item)

        assert results == [{"a": 1}, {"b": 2}]

    @pytest.mark.asyncio
    async def test_immediate_iteration_with_items(self) -> None:
        """Items already in queue are immediately available."""
        pushable: Pushable[int] = Pushable()
        pushable.push(1)
        pushable.push(2)

        # Get first item immediately
        item1 = await pushable.__anext__()
        assert item1 == 1

        # Get second item immediately
        item2 = await pushable.__anext__()
        assert item2 == 2

        # End and verify iteration stops
        pushable.end()

        results: list[int] = []
        async for item in pushable:
            results.append(item)

        assert results == []
