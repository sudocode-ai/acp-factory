"""
Session - High-level interface for interacting with an agent session.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, AsyncIterator

from acp_factory.types import (
    ExtendedSessionUpdate,
    FlushOptions,
    FlushResult,
    PromptContent,
)

if TYPE_CHECKING:
    from acp.client import ClientSideConnection

    from acp_factory.client_handler import ACPClientHandler


class Session:
    """
    Represents an active session with an agent.

    This class provides a high-level interface for interacting with an agent session,
    including sending prompts, managing permissions, and forking sessions.
    """

    def __init__(
        self,
        session_id: str,
        connection: ClientSideConnection,
        client_handler: ACPClientHandler,
        cwd: str,
        modes: list[str] | None = None,
        models: list[str] | None = None,
    ) -> None:
        self._id = session_id
        self._connection = connection
        self._client_handler = client_handler
        self._cwd = cwd
        self._modes = modes or []
        self._models = models or []
        self._is_processing = False

    @property
    def id(self) -> str:
        """The session ID."""
        return self._id

    @property
    def cwd(self) -> str:
        """The current working directory for this session."""
        return self._cwd

    @property
    def modes(self) -> list[str]:
        """Available modes for this session."""
        return self._modes

    @property
    def models(self) -> list[str]:
        """Available models for this session."""
        return self._models

    @property
    def is_processing(self) -> bool:
        """Whether the session is currently processing a prompt."""
        return self._is_processing

    async def prompt(self, content: PromptContent) -> AsyncIterator[ExtendedSessionUpdate]:
        """
        Send a prompt and stream responses.

        In interactive permission mode, this may yield PermissionRequestUpdate objects
        that require a response via respond_to_permission() before the prompt can continue.

        Args:
            content: The prompt content (string or list of content blocks)

        Yields:
            Session updates including agent messages, tool calls, and permission requests
        """
        self._is_processing = True

        try:
            # Convert string to ContentBlock list
            prompt_blocks: list[dict[str, Any]]
            if isinstance(content, str):
                prompt_blocks = [{"type": "text", "text": content}]
            else:
                prompt_blocks = content

            # Get the session stream for updates
            stream = self._client_handler.get_session_stream(self._id)

            # Start the prompt (non-blocking, returns when complete)
            prompt_task = asyncio.create_task(
                self._connection.prompt(
                    session_id=self._id,
                    prompt=prompt_blocks,
                )
            )

            # Yield updates as they arrive using Promise.race-like pattern
            # We race between prompt completion and getting updates
            prompt_done = False

            try:
                while not prompt_done:
                    # Race between prompt completion and getting an update
                    update_task = asyncio.create_task(stream.__anext__())

                    if prompt_task.done():
                        # Prompt already completed, just drain updates
                        prompt_done = True
                        # Give a small window for any final updates to arrive
                        await asyncio.sleep(0.05)
                        # Drain remaining updates without ending stream yet
                        try:
                            while True:
                                update = await asyncio.wait_for(
                                    stream.__anext__(),
                                    timeout=0.1,
                                )
                                yield update
                        except (StopAsyncIteration, asyncio.TimeoutError):
                            pass
                        break

                    # Race prompt completion against getting an update
                    done, pending = await asyncio.wait(
                        [prompt_task, update_task],
                        return_when=asyncio.FIRST_COMPLETED,
                    )

                    # Handle results
                    if prompt_task in done:
                        # Prompt completed
                        prompt_done = True
                        # Cancel update task if still pending
                        if update_task in pending:
                            update_task.cancel()
                            try:
                                await update_task
                            except (asyncio.CancelledError, StopAsyncIteration):
                                pass
                        # Give a small window for any final updates to arrive
                        await asyncio.sleep(0.05)
                        # Drain remaining updates
                        try:
                            while True:
                                update = await asyncio.wait_for(
                                    stream.__anext__(),
                                    timeout=0.1,
                                )
                                yield update
                        except (StopAsyncIteration, asyncio.TimeoutError):
                            pass
                        break
                    else:
                        # Got an update
                        try:
                            update = update_task.result()
                            yield update
                        except StopAsyncIteration:
                            break

            except StopAsyncIteration:
                pass

        finally:
            # Ensure stream is ended and mark session as idle
            self._client_handler.end_session_stream(self._id)
            self._is_processing = False

    async def cancel(self) -> None:
        """Cancel the current prompt."""
        await self._connection.cancel(session_id=self._id)

    async def interrupt_with(
        self, content: PromptContent
    ) -> AsyncIterator[ExtendedSessionUpdate]:
        """
        Interrupt the current prompt and start a new one with additional context.

        This cancels any in-progress prompt and immediately starts a new prompt.
        The agent will restart its work but retains the conversation history.

        Args:
            content: The new prompt content

        Yields:
            Session updates from the new prompt
        """
        # Cancel any in-progress prompt
        await self.cancel()

        # Small delay to allow cancellation to propagate
        await asyncio.sleep(0.05)

        # Start new prompt and yield its updates
        async for update in self.prompt(content):
            yield update

    async def set_mode(self, mode: str) -> None:
        """Set the session mode."""
        await self._connection.set_session_mode(
            session_id=self._id,
            mode_id=mode,
        )

    async def fork(self) -> Session:
        """
        Fork this session to create a new independent session.

        The forked session inherits the conversation history, allowing
        operations like generating summaries without affecting this session.
        """
        result = await self._connection.fork_session(
            session_id=self._id,
            cwd=self._cwd,
        )

        # Extract modes and models from result
        modes: list[str] = []
        models: list[str] = []

        if result.modes and result.modes.available_modes:
            modes = [m.id for m in result.modes.available_modes]

        if result.models and result.models.available_models:
            models = [m.model_id for m in result.models.available_models]

        return Session(
            session_id=result.session_id,
            connection=self._connection,
            client_handler=self._client_handler,
            cwd=self._cwd,
            modes=modes or self._modes,
            models=models or self._models,
        )

    async def fork_with_flush(
        self,
        idle_timeout: int = 5000,
        persist_timeout: int = 5000,
    ) -> Session:
        """
        Fork a running session by flushing it to disk first.

        This method handles forking a session that is currently active by:
        1. Waiting for the session to become idle (up to idle_timeout)
        2. If still processing after timeout, interrupting gracefully
        3. Calling the agent's flush extension to trigger disk persistence
        4. Restarting the original session so it can continue
        5. Creating the forked session using the persisted data

        Args:
            idle_timeout: Max time to wait for session to become idle (ms)
            persist_timeout: Max time to wait for disk persistence (ms)

        Returns:
            A new Session object representing the forked session
        """
        # Wait for idle or interrupt
        became_idle = await self._wait_for_idle(idle_timeout)
        if not became_idle and self._is_processing:
            await self.cancel()
            await asyncio.sleep(0.5)

        # Call the agent's flush extension method
        flush_result = await self._connection.ext_method(
            "_session/flush",
            {
                "sessionId": self._id,
                "idleTimeout": idle_timeout,
                "persistTimeout": persist_timeout,
            },
        )

        # Check if the agent reported success
        if not flush_result.get("success"):
            error = flush_result.get("error", f"Failed to persist session {self._id}")
            raise RuntimeError(error)

        # Restart original session
        await self._restart_session()

        # Create forked session
        result = await self._connection.fork_session(
            session_id=self._id,
            cwd=self._cwd,
        )

        # Extract modes and models from result
        modes: list[str] = []
        models: list[str] = []

        if result.modes and result.modes.available_modes:
            modes = [m.id for m in result.modes.available_modes]

        if result.models and result.models.available_models:
            models = [m.model_id for m in result.models.available_models]

        return Session(
            session_id=result.session_id,
            connection=self._connection,
            client_handler=self._client_handler,
            cwd=self._cwd,
            modes=modes or self._modes,
            models=models or self._models,
        )

    def respond_to_permission(self, request_id: str, option_id: str) -> None:
        """
        Respond to a permission request (for interactive permission mode).

        When using permission_mode="interactive", permission requests are emitted
        as session updates. Call this method to allow the prompt to continue.

        Args:
            request_id: The request_id from the PermissionRequestUpdate
            option_id: The option_id of the selected permission option
        """
        self._client_handler.respond_to_permission(request_id, option_id)

    def cancel_permission(self, request_id: str) -> None:
        """
        Cancel a permission request (for interactive permission mode).

        This will cancel the permission request, which typically aborts the tool call.

        Args:
            request_id: The request_id from the PermissionRequestUpdate
        """
        self._client_handler.cancel_permission(request_id)

    def has_pending_permissions(self) -> bool:
        """Check if there are any pending permission requests for this session."""
        return len(self._client_handler.get_pending_permission_ids(self._id)) > 0

    def get_pending_permission_ids(self) -> list[str]:
        """Get all pending permission request IDs for this session."""
        return self._client_handler.get_pending_permission_ids(self._id)

    async def flush(self, options: FlushOptions | None = None) -> FlushResult:
        """
        Flush session to disk, creating a checkpoint without forking.

        Use this for creating checkpoints that can later be forked or restored.

        Args:
            options: Optional timeout configuration

        Returns:
            FlushResult with success status, file path if successful, or error message
        """
        options = options or FlushOptions()

        try:
            # Wait for idle or timeout
            became_idle = await self._wait_for_idle(options.idle_timeout)
            if not became_idle and self._is_processing:
                await self.cancel()
                await asyncio.sleep(0.5)

            # Call the agent's flush extension method
            flush_result = await self._connection.ext_method(
                "_session/flush",
                {
                    "sessionId": self._id,
                    "idleTimeout": options.idle_timeout,
                    "persistTimeout": options.persist_timeout,
                },
            )

            if not flush_result.get("success"):
                return FlushResult(
                    success=False,
                    error=flush_result.get("error", "Flush failed"),
                )

            # Restart session
            await self._restart_session()

            return FlushResult(
                success=True,
                file_path=flush_result.get("filePath"),
            )

        except Exception as e:
            return FlushResult(success=False, error=str(e))

    async def _wait_for_idle(self, timeout: int = 5000) -> bool:
        """Wait for the session to become idle (not processing a prompt)."""
        start = asyncio.get_event_loop().time()
        timeout_sec = timeout / 1000

        while asyncio.get_event_loop().time() - start < timeout_sec:
            if not self._is_processing:
                return True
            await asyncio.sleep(0.1)

        return False

    async def _restart_session(self) -> None:
        """Restart this session after it has been flushed to disk."""
        await self._connection.load_session(
            session_id=self._id,
            cwd=self._cwd,
            mcp_servers=[],
        )
