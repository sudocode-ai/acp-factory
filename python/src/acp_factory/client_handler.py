"""
ACPClientHandler - Implements ACP Client interface.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from acp_factory.pushable import Pushable
from acp_factory.types import (
    ClientHandlers,
    ExtendedSessionUpdate,
    PermissionMode,
    PermissionRequestUpdate,
)


class PendingPermission:
    """Deferred promise for pending permission requests."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.future: asyncio.Future[dict[str, Any]] = asyncio.get_event_loop().create_future()

    def resolve(self, response: dict[str, Any]) -> None:
        """Resolve the pending permission with a response."""
        if not self.future.done():
            self.future.set_result(response)

    def reject(self, error: Exception) -> None:
        """Reject the pending permission with an error."""
        if not self.future.done():
            self.future.set_exception(error)


class ACPClientHandler:
    """
    Implements the ACP Client interface, bridging agent requests to callbacks.

    This handler manages:
    - Per-session update streams for streaming responses to consumers
    - Permission handling with 4 modes: auto-approve, auto-deny, callback, interactive
    - File read/write operations with optional custom handlers
    - Terminal operations delegated to custom handlers
    """

    def __init__(
        self,
        handlers: ClientHandlers | None = None,
        permission_mode: PermissionMode = "auto-approve",
    ) -> None:
        self._handlers = handlers or ClientHandlers()
        self._permission_mode = permission_mode

        # Per-session update streams
        self._session_streams: dict[str, Pushable[ExtendedSessionUpdate]] = {}

        # Pending permission requests awaiting user response (interactive mode)
        self._pending_permissions: dict[str, PendingPermission] = {}

        # Counter for generating unique permission request IDs
        self._permission_request_counter = 0

    def get_session_stream(self, session_id: str) -> Pushable[ExtendedSessionUpdate]:
        """Get or create a pushable stream for a session."""
        if session_id not in self._session_streams:
            self._session_streams[session_id] = Pushable()
        return self._session_streams[session_id]

    def end_session_stream(self, session_id: str) -> None:
        """End a session's update stream."""
        stream = self._session_streams.get(session_id)
        if stream:
            stream.end()
            # Remove from cache so next get_session_stream() creates a fresh stream
            del self._session_streams[session_id]

    def respond_to_permission(self, request_id: str, option_id: str) -> None:
        """
        Respond to a pending permission request (for interactive mode).

        Args:
            request_id: The permission request ID from the PermissionRequestUpdate
            option_id: The optionId of the selected option
        """
        pending = self._pending_permissions.get(request_id)
        if not pending:
            raise ValueError(f"No pending permission request with ID: {request_id}")

        del self._pending_permissions[request_id]
        pending.resolve({
            "outcome": {
                "outcome": "selected",
                "optionId": option_id,
            },
        })

    def cancel_permission(self, request_id: str) -> None:
        """
        Cancel a pending permission request (for interactive mode).

        Args:
            request_id: The permission request ID from the PermissionRequestUpdate
        """
        pending = self._pending_permissions.get(request_id)
        if not pending:
            raise ValueError(f"No pending permission request with ID: {request_id}")

        del self._pending_permissions[request_id]
        pending.resolve({
            "outcome": {
                "outcome": "cancelled",
            },
        })

    def has_pending_permissions(self) -> bool:
        """Check if there are any pending permission requests."""
        return len(self._pending_permissions) > 0

    def get_pending_permission_ids(self, session_id: str) -> list[str]:
        """Get all pending permission request IDs for a session."""
        return [
            request_id
            for request_id, pending in self._pending_permissions.items()
            if pending.session_id == session_id
        ]

    # =========================================================================
    # ACP Client Protocol Methods
    # =========================================================================

    async def request_permission(
        self,
        session_id: str,
        tool_call: dict[str, Any],
        options: list[dict[str, Any]],
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Handle permission requests from the agent."""
        # If callback mode and handler provided, delegate to it
        if self._permission_mode == "callback" and self._handlers.on_permission_request:
            return await self._handlers.on_permission_request({
                "sessionId": session_id,
                "toolCall": tool_call,
                "options": options,
                **kwargs,
            })

        if self._permission_mode == "auto-approve":
            # Look for allow_once or allow_always option
            for opt in options:
                if opt.get("kind") in ("allow_once", "allow_always"):
                    return {
                        "outcome": {
                            "outcome": "selected",
                            "optionId": opt["optionId"],
                        },
                    }

        if self._permission_mode == "auto-deny":
            # Look for reject_once or reject_always option
            for opt in options:
                if opt.get("kind") in ("reject_once", "reject_always"):
                    return {
                        "outcome": {
                            "outcome": "selected",
                            "optionId": opt["optionId"],
                        },
                    }

        # Interactive mode: emit permission request as session update and wait for response
        if self._permission_mode == "interactive":
            self._permission_request_counter += 1
            request_id = f"perm-{self._permission_request_counter}"

            # Create the permission request update
            permission_update = PermissionRequestUpdate(
                session_update="permission_request",
                request_id=request_id,
                session_id=session_id,
                tool_call={
                    "toolCallId": tool_call.get("toolCallId", ""),
                    "title": tool_call.get("title", "Unknown"),
                    "status": tool_call.get("status", "pending"),
                    "rawInput": tool_call.get("rawInput"),
                },
                options=options,
            )

            # Emit to session stream
            stream = self.get_session_stream(session_id)
            stream.push(permission_update)

            # Create deferred promise and wait for response
            pending = PendingPermission(session_id)
            self._pending_permissions[request_id] = pending

            return await pending.future

        # Fallback: if we have a handler, use it; otherwise pick first option
        if self._handlers.on_permission_request:
            return await self._handlers.on_permission_request({
                "sessionId": session_id,
                "toolCall": tool_call,
                "options": options,
                **kwargs,
            })

        # Last resort: return first option
        return {
            "outcome": {
                "outcome": "selected",
                "optionId": options[0]["optionId"],
            },
        }

    async def session_update(
        self,
        session_id: str,
        update: dict[str, Any],
        **kwargs: Any,
    ) -> None:
        """Handle session updates from the agent."""
        stream = self.get_session_stream(session_id)
        stream.push(update)

    async def read_text_file(
        self,
        path: str,
        session_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Handle file read requests."""
        # Use custom handler if provided
        if self._handlers.on_file_read:
            content = await self._handlers.on_file_read(path)
            return {"content": content}

        # Default: read from filesystem
        try:
            content = Path(path).read_text(encoding="utf-8")
            return {"content": content}
        except Exception as e:
            raise RuntimeError(f"Failed to read file {path}: {e}") from e

    async def write_text_file(
        self,
        path: str,
        content: str,
        session_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Handle file write requests."""
        # Use custom handler if provided
        if self._handlers.on_file_write:
            await self._handlers.on_file_write(path, content)
            return {}

        # Default: write to filesystem
        try:
            Path(path).write_text(content, encoding="utf-8")
            return {}
        except Exception as e:
            raise RuntimeError(f"Failed to write file {path}: {e}") from e

    async def create_terminal(
        self,
        command: str,
        session_id: str,
        args: list[str] | None = None,
        cwd: str | None = None,
        env: list[dict[str, str]] | None = None,
        output_byte_limit: int | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Handle terminal creation requests."""
        if not self._handlers.on_terminal_create:
            raise RuntimeError(
                "Terminal operations not supported: no on_terminal_create handler provided"
            )
        return await self._handlers.on_terminal_create({
            "command": command,
            "sessionId": session_id,
            "args": args,
            "cwd": cwd,
            "env": env,
            "outputByteLimit": output_byte_limit,
            **kwargs,
        })

    async def terminal_output(
        self,
        session_id: str,
        terminal_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Handle terminal output requests."""
        if not self._handlers.on_terminal_output:
            raise RuntimeError(
                "Terminal operations not supported: no on_terminal_output handler provided"
            )
        output = await self._handlers.on_terminal_output(terminal_id)
        return {"output": output, "truncated": False}

    async def kill_terminal(
        self,
        session_id: str,
        terminal_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Handle terminal kill requests."""
        if not self._handlers.on_terminal_kill:
            raise RuntimeError(
                "Terminal operations not supported: no on_terminal_kill handler provided"
            )
        await self._handlers.on_terminal_kill(terminal_id)
        return {}

    async def release_terminal(
        self,
        session_id: str,
        terminal_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Handle terminal release requests."""
        if not self._handlers.on_terminal_release:
            raise RuntimeError(
                "Terminal operations not supported: no on_terminal_release handler provided"
            )
        await self._handlers.on_terminal_release(terminal_id)
        return {}

    async def wait_for_terminal_exit(
        self,
        session_id: str,
        terminal_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Handle terminal wait for exit requests."""
        if not self._handlers.on_terminal_wait_for_exit:
            raise RuntimeError(
                "Terminal operations not supported: no on_terminal_wait_for_exit handler provided"
            )
        exit_code = await self._handlers.on_terminal_wait_for_exit(terminal_id)
        return {"exitCode": exit_code}

    # =========================================================================
    # ACP Client Protocol - Extension methods
    # =========================================================================

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        """Handle extension method calls."""
        # Default implementation - can be overridden
        raise NotImplementedError(f"Extension method not implemented: {method}")

    async def ext_notification(self, method: str, params: dict[str, Any]) -> None:
        """Handle extension notifications."""
        # Default implementation - ignore unknown notifications
        pass

    def on_connect(self, conn: Any) -> None:
        """Called when connection is established."""
        pass
