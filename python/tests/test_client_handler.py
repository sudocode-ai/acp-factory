"""Tests for ACPClientHandler."""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from acp_factory.client_handler import ACPClientHandler
from acp_factory.types import ClientHandlers


def create_permission_request(
    options: list[dict[str, str]],
    session_id: str = "test-session",
) -> tuple[str, dict, list[dict]]:
    """Helper to create permission request parameters."""
    tool_call = {
        "toolCallId": "tool-1",
        "title": "Test Tool",
        "status": "pending",
    }
    formatted_options = [
        {"kind": opt["kind"], "optionId": opt["optionId"], "name": opt["name"]}
        for opt in options
    ]
    return session_id, tool_call, formatted_options


class TestACPClientHandlerRequestPermission:
    """Tests for permission request handling."""

    @pytest.mark.asyncio
    async def test_should_auto_approve_by_selecting_allow_once_option(self) -> None:
        """Auto-approve mode selects allow_once option."""
        handler = ACPClientHandler(permission_mode="auto-approve")

        session_id, tool_call, options = create_permission_request([
            {"kind": "allow_once", "optionId": "allow", "name": "Allow"},
            {"kind": "reject_once", "optionId": "reject", "name": "Reject"},
        ])

        result = await handler.request_permission(session_id, tool_call, options)

        assert result["outcome"] == {"outcome": "selected", "optionId": "allow"}

    @pytest.mark.asyncio
    async def test_should_auto_approve_by_selecting_allow_always_option(self) -> None:
        """Auto-approve mode selects allow_always option."""
        handler = ACPClientHandler(permission_mode="auto-approve")

        session_id, tool_call, options = create_permission_request([
            {"kind": "reject_once", "optionId": "reject", "name": "Reject"},
            {"kind": "allow_always", "optionId": "allow-all", "name": "Allow Always"},
        ])

        result = await handler.request_permission(session_id, tool_call, options)

        assert result["outcome"] == {"outcome": "selected", "optionId": "allow-all"}

    @pytest.mark.asyncio
    async def test_should_auto_deny_by_selecting_reject_once_option(self) -> None:
        """Auto-deny mode selects reject_once option."""
        handler = ACPClientHandler(permission_mode="auto-deny")

        session_id, tool_call, options = create_permission_request([
            {"kind": "allow_once", "optionId": "allow", "name": "Allow"},
            {"kind": "reject_once", "optionId": "reject", "name": "Reject"},
        ])

        result = await handler.request_permission(session_id, tool_call, options)

        assert result["outcome"] == {"outcome": "selected", "optionId": "reject"}

    @pytest.mark.asyncio
    async def test_should_auto_deny_by_selecting_reject_always_option(self) -> None:
        """Auto-deny mode selects reject_always option."""
        handler = ACPClientHandler(permission_mode="auto-deny")

        session_id, tool_call, options = create_permission_request([
            {"kind": "allow_once", "optionId": "allow", "name": "Allow"},
            {"kind": "reject_always", "optionId": "reject-all", "name": "Reject Always"},
        ])

        result = await handler.request_permission(session_id, tool_call, options)

        assert result["outcome"] == {"outcome": "selected", "optionId": "reject-all"}

    @pytest.mark.asyncio
    async def test_should_use_callback_handler_in_callback_mode(self) -> None:
        """Callback mode delegates to handler."""
        mock_handler = AsyncMock(return_value={
            "outcome": {"outcome": "selected", "optionId": "custom"},
        })

        handlers = ClientHandlers(on_permission_request=mock_handler)
        handler = ACPClientHandler(handlers=handlers, permission_mode="callback")

        session_id, tool_call, options = create_permission_request([
            {"kind": "allow_once", "optionId": "allow", "name": "Allow"},
        ])

        result = await handler.request_permission(session_id, tool_call, options)

        mock_handler.assert_called_once()
        assert result["outcome"] == {"outcome": "selected", "optionId": "custom"}

    @pytest.mark.asyncio
    async def test_should_fallback_to_first_option_when_no_matching_option(self) -> None:
        """Falls back to first option when no matching option found."""
        handler = ACPClientHandler(permission_mode="auto-approve")

        # Only reject options available
        session_id, tool_call, options = create_permission_request([
            {"kind": "reject_once", "optionId": "reject", "name": "Reject"},
            {"kind": "reject_always", "optionId": "reject-all", "name": "Reject Always"},
        ])

        result = await handler.request_permission(session_id, tool_call, options)

        # Should fallback to first option
        assert result["outcome"] == {"outcome": "selected", "optionId": "reject"}


class TestACPClientHandlerInteractivePermission:
    """Tests for interactive permission mode."""

    @pytest.mark.asyncio
    async def test_should_emit_permission_request_to_session_stream(self) -> None:
        """Interactive mode emits permission request to stream."""
        handler = ACPClientHandler(permission_mode="interactive")
        stream = handler.get_session_stream("session-1")

        session_id, tool_call, options = create_permission_request(
            [
                {"kind": "allow_once", "optionId": "allow", "name": "Allow"},
                {"kind": "reject_once", "optionId": "reject", "name": "Reject"},
            ],
            session_id="session-1",
        )

        # Start permission request (will block until responded)
        permission_task = asyncio.create_task(
            handler.request_permission(session_id, tool_call, options)
        )

        # Get the emitted update from the stream
        update = await stream.__anext__()

        assert update.session_update == "permission_request"
        assert update.request_id.startswith("perm-")
        assert update.session_id == "session-1"
        assert update.tool_call["toolCallId"] == "tool-1"
        assert len(update.options) == 2

        # Respond to unblock the promise
        handler.respond_to_permission(update.request_id, "allow")
        result = await permission_task

        assert result["outcome"] == {"outcome": "selected", "optionId": "allow"}

    @pytest.mark.asyncio
    async def test_should_handle_respond_to_permission_correctly(self) -> None:
        """respond_to_permission resolves pending request."""
        handler = ACPClientHandler(permission_mode="interactive")
        handler.get_session_stream("session-1")  # Initialize stream

        session_id, tool_call, options = create_permission_request(
            [
                {"kind": "allow_once", "optionId": "allow", "name": "Allow"},
                {"kind": "reject_once", "optionId": "reject", "name": "Reject"},
            ],
            session_id="session-1",
        )

        permission_task = asyncio.create_task(
            handler.request_permission(session_id, tool_call, options)
        )

        # Wait a tick for the update to be pushed
        await asyncio.sleep(0.01)

        # Get pending permission IDs
        pending_ids = handler.get_pending_permission_ids("session-1")
        assert len(pending_ids) == 1

        # Respond with reject
        handler.respond_to_permission(pending_ids[0], "reject")
        result = await permission_task

        assert result["outcome"] == {"outcome": "selected", "optionId": "reject"}

    @pytest.mark.asyncio
    async def test_should_handle_cancel_permission_correctly(self) -> None:
        """cancel_permission cancels the pending request."""
        handler = ACPClientHandler(permission_mode="interactive")
        handler.get_session_stream("session-1")

        session_id, tool_call, options = create_permission_request(
            [{"kind": "allow_once", "optionId": "allow", "name": "Allow"}],
            session_id="session-1",
        )

        permission_task = asyncio.create_task(
            handler.request_permission(session_id, tool_call, options)
        )

        await asyncio.sleep(0.01)

        pending_ids = handler.get_pending_permission_ids("session-1")
        handler.cancel_permission(pending_ids[0])

        result = await permission_task
        assert result["outcome"] == {"outcome": "cancelled"}

    def test_should_throw_error_when_responding_to_nonexistent_permission(self) -> None:
        """Throws error when responding to non-existent permission."""
        handler = ACPClientHandler(permission_mode="interactive")

        with pytest.raises(ValueError, match="No pending permission request with ID"):
            handler.respond_to_permission("non-existent", "allow")

    def test_should_throw_error_when_cancelling_nonexistent_permission(self) -> None:
        """Throws error when cancelling non-existent permission."""
        handler = ACPClientHandler(permission_mode="interactive")

        with pytest.raises(ValueError, match="No pending permission request with ID"):
            handler.cancel_permission("non-existent")

    @pytest.mark.asyncio
    async def test_should_track_has_pending_permissions_correctly(self) -> None:
        """has_pending_permissions reflects state correctly."""
        handler = ACPClientHandler(permission_mode="interactive")
        handler.get_session_stream("session-1")

        assert handler.has_pending_permissions() is False

        session_id, tool_call, options = create_permission_request(
            [{"kind": "allow_once", "optionId": "allow", "name": "Allow"}],
            session_id="session-1",
        )

        permission_task = asyncio.create_task(
            handler.request_permission(session_id, tool_call, options)
        )

        await asyncio.sleep(0.01)
        assert handler.has_pending_permissions() is True

        pending_ids = handler.get_pending_permission_ids("session-1")
        handler.respond_to_permission(pending_ids[0], "allow")
        await permission_task

        assert handler.has_pending_permissions() is False

    @pytest.mark.asyncio
    async def test_should_handle_multiple_pending_permissions_for_different_sessions(
        self,
    ) -> None:
        """Multiple pending permissions for different sessions work correctly."""
        handler = ACPClientHandler(permission_mode="interactive")
        handler.get_session_stream("session-1")
        handler.get_session_stream("session-2")

        _, tool_call1, options1 = create_permission_request(
            [{"kind": "allow_once", "optionId": "allow", "name": "Allow"}],
            session_id="session-1",
        )
        _, tool_call2, options2 = create_permission_request(
            [{"kind": "allow_once", "optionId": "allow", "name": "Allow"}],
            session_id="session-2",
        )

        task1 = asyncio.create_task(
            handler.request_permission("session-1", tool_call1, options1)
        )
        task2 = asyncio.create_task(
            handler.request_permission("session-2", tool_call2, options2)
        )

        await asyncio.sleep(0.01)

        assert len(handler.get_pending_permission_ids("session-1")) == 1
        assert len(handler.get_pending_permission_ids("session-2")) == 1

        # Respond to session-1
        ids1 = handler.get_pending_permission_ids("session-1")
        handler.respond_to_permission(ids1[0], "allow")
        await task1

        assert len(handler.get_pending_permission_ids("session-1")) == 0
        assert len(handler.get_pending_permission_ids("session-2")) == 1

        # Respond to session-2
        ids2 = handler.get_pending_permission_ids("session-2")
        handler.respond_to_permission(ids2[0], "allow")
        await task2


class TestACPClientHandlerSessionUpdate:
    """Tests for session update handling."""

    @pytest.mark.asyncio
    async def test_should_push_updates_to_session_stream(self) -> None:
        """Session updates are pushed to stream."""
        handler = ACPClientHandler()

        update = {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "Hello"},
        }

        # Get stream before pushing
        stream = handler.get_session_stream("session-1")

        # Push update
        await handler.session_update("session-1", update)

        # End stream
        handler.end_session_stream("session-1")

        # Collect results
        results = []
        async for item in stream:
            results.append(item)

        assert len(results) == 1
        assert results[0] == update

    @pytest.mark.asyncio
    async def test_should_handle_multiple_sessions_independently(self) -> None:
        """Multiple sessions have independent streams."""
        handler = ACPClientHandler()

        stream1 = handler.get_session_stream("session-1")
        stream2 = handler.get_session_stream("session-2")

        await handler.session_update(
            "session-1",
            {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "S1"}},
        )
        await handler.session_update(
            "session-2",
            {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "S2"}},
        )

        handler.end_session_stream("session-1")
        handler.end_session_stream("session-2")

        results1 = []
        async for item in stream1:
            results1.append(item)

        results2 = []
        async for item in stream2:
            results2.append(item)

        assert len(results1) == 1
        assert len(results2) == 1
        assert results1[0]["content"]["text"] == "S1"
        assert results2[0]["content"]["text"] == "S2"


class TestACPClientHandlerFileOperations:
    """Tests for file operations."""

    @pytest.mark.asyncio
    async def test_should_use_custom_handler_for_read(self) -> None:
        """Custom handler is used for file read."""
        mock_read = AsyncMock(return_value="custom content")
        handlers = ClientHandlers(on_file_read=mock_read)
        handler = ACPClientHandler(handlers=handlers)

        result = await handler.read_text_file("/test/file.txt", "s1")

        mock_read.assert_called_once_with("/test/file.txt")
        assert result["content"] == "custom content"

    @pytest.mark.asyncio
    async def test_should_read_from_filesystem_by_default(self) -> None:
        """Default file read uses filesystem."""
        handler = ACPClientHandler()

        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("test content")
            temp_path = f.name

        try:
            result = await handler.read_text_file(temp_path, "s1")
            assert result["content"] == "test content"
        finally:
            Path(temp_path).unlink()

    @pytest.mark.asyncio
    async def test_should_throw_error_when_file_read_fails(self) -> None:
        """Throws error when file read fails."""
        handler = ACPClientHandler()

        with pytest.raises(RuntimeError, match="Failed to read file"):
            await handler.read_text_file("/nonexistent/path/file.txt", "s1")

    @pytest.mark.asyncio
    async def test_should_use_custom_handler_for_write(self) -> None:
        """Custom handler is used for file write."""
        mock_write = AsyncMock()
        handlers = ClientHandlers(on_file_write=mock_write)
        handler = ACPClientHandler(handlers=handlers)

        result = await handler.write_text_file("/test/file.txt", "test content", "s1")

        mock_write.assert_called_once_with("/test/file.txt", "test content")
        assert result == {}

    @pytest.mark.asyncio
    async def test_should_write_to_filesystem_by_default(self) -> None:
        """Default file write uses filesystem."""
        handler = ACPClientHandler()

        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            temp_path = f.name

        try:
            await handler.write_text_file(temp_path, "written content", "s1")
            assert Path(temp_path).read_text() == "written content"
        finally:
            Path(temp_path).unlink()


class TestACPClientHandlerTerminalOperations:
    """Tests for terminal operations."""

    @pytest.mark.asyncio
    async def test_should_throw_error_when_create_terminal_handler_not_provided(
        self,
    ) -> None:
        """Throws error when create_terminal handler not provided."""
        handler = ACPClientHandler()

        with pytest.raises(RuntimeError, match="no on_terminal_create handler provided"):
            await handler.create_terminal("ls", "s1", cwd="/tmp")

    @pytest.mark.asyncio
    async def test_should_throw_error_when_terminal_output_handler_not_provided(
        self,
    ) -> None:
        """Throws error when terminal_output handler not provided."""
        handler = ACPClientHandler()

        with pytest.raises(RuntimeError, match="no on_terminal_output handler provided"):
            await handler.terminal_output("s1", "term-1")

    @pytest.mark.asyncio
    async def test_should_throw_error_when_kill_terminal_handler_not_provided(
        self,
    ) -> None:
        """Throws error when kill_terminal handler not provided."""
        handler = ACPClientHandler()

        with pytest.raises(RuntimeError, match="no on_terminal_kill handler provided"):
            await handler.kill_terminal("s1", "term-1")

    @pytest.mark.asyncio
    async def test_should_throw_error_when_release_terminal_handler_not_provided(
        self,
    ) -> None:
        """Throws error when release_terminal handler not provided."""
        handler = ACPClientHandler()

        with pytest.raises(RuntimeError, match="no on_terminal_release handler provided"):
            await handler.release_terminal("s1", "term-1")

    @pytest.mark.asyncio
    async def test_should_throw_error_when_wait_for_terminal_exit_handler_not_provided(
        self,
    ) -> None:
        """Throws error when wait_for_terminal_exit handler not provided."""
        handler = ACPClientHandler()

        with pytest.raises(
            RuntimeError, match="no on_terminal_wait_for_exit handler provided"
        ):
            await handler.wait_for_terminal_exit("s1", "term-1")

    @pytest.mark.asyncio
    async def test_should_delegate_to_create_terminal_handler(self) -> None:
        """Delegates to create_terminal handler."""
        mock_create = AsyncMock(return_value={"terminalId": "term-123"})
        handlers = ClientHandlers(on_terminal_create=mock_create)
        handler = ACPClientHandler(handlers=handlers)

        result = await handler.create_terminal("ls", "s1", cwd="/tmp")

        mock_create.assert_called_once()
        assert result == {"terminalId": "term-123"}

    @pytest.mark.asyncio
    async def test_should_delegate_to_terminal_output_handler(self) -> None:
        """Delegates to terminal_output handler."""
        mock_output = AsyncMock(return_value="output text")
        handlers = ClientHandlers(on_terminal_output=mock_output)
        handler = ACPClientHandler(handlers=handlers)

        result = await handler.terminal_output("s1", "term-1")

        mock_output.assert_called_once_with("term-1")
        assert result == {"output": "output text", "truncated": False}

    @pytest.mark.asyncio
    async def test_should_delegate_to_wait_for_terminal_exit_handler(self) -> None:
        """Delegates to wait_for_terminal_exit handler."""
        mock_wait = AsyncMock(return_value=0)
        handlers = ClientHandlers(on_terminal_wait_for_exit=mock_wait)
        handler = ACPClientHandler(handlers=handlers)

        result = await handler.wait_for_terminal_exit("s1", "term-1")

        mock_wait.assert_called_once_with("term-1")
        assert result == {"exitCode": 0}

    @pytest.mark.asyncio
    async def test_should_delegate_to_kill_terminal_handler(self) -> None:
        """Delegates to kill_terminal handler."""
        mock_kill = AsyncMock()
        handlers = ClientHandlers(on_terminal_kill=mock_kill)
        handler = ACPClientHandler(handlers=handlers)

        result = await handler.kill_terminal("s1", "term-1")

        mock_kill.assert_called_once_with("term-1")
        assert result == {}

    @pytest.mark.asyncio
    async def test_should_delegate_to_release_terminal_handler(self) -> None:
        """Delegates to release_terminal handler."""
        mock_release = AsyncMock()
        handlers = ClientHandlers(on_terminal_release=mock_release)
        handler = ACPClientHandler(handlers=handlers)

        result = await handler.release_terminal("s1", "term-1")

        mock_release.assert_called_once_with("term-1")
        assert result == {}
