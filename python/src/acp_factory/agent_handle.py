"""
AgentHandle - Represents a running agent with an ACP connection.
"""

from __future__ import annotations

import os
from asyncio.subprocess import Process
from contextlib import AsyncExitStack
from typing import TYPE_CHECKING, Any

import acp
from acp.client import ClientSideConnection
from acp.schema import ClientCapabilities, FileSystemCapability

from acp_factory.client_handler import ACPClientHandler
from acp_factory.types import (
    AgentConfig,
    ForkSessionOptions,
    SessionOptions,
    SpawnOptions,
)

if TYPE_CHECKING:
    from acp_factory.session import Session


class AgentHandle:
    """
    Handle to a running agent process with ACP connection.

    This class manages the lifecycle of an agent subprocess and provides
    methods to create and manage sessions with the agent.
    """

    def __init__(
        self,
        process: Process,
        connection: ClientSideConnection,
        client_handler: ACPClientHandler,
        capabilities: dict[str, Any],
        exit_stack: AsyncExitStack,
    ) -> None:
        self._process = process
        self._connection = connection
        self._client_handler = client_handler
        self.capabilities = capabilities
        self._sessions: dict[str, Session] = {}
        self._exit_stack = exit_stack

    @classmethod
    async def create(
        cls,
        config: AgentConfig,
        options: SpawnOptions,
    ) -> AgentHandle:
        """Create and initialize an agent handle."""
        from acp_factory.session import Session  # noqa: F401

        # Merge environment variables
        env = {**os.environ, **config.env, **options.env}

        # Create client handler
        client_handler = ACPClientHandler(
            handlers=options,
            permission_mode=options.permission_mode,
        )

        # Determine terminal capability based on handlers
        has_terminal = all([
            options.on_terminal_create,
            options.on_terminal_output,
            options.on_terminal_kill,
            options.on_terminal_release,
            options.on_terminal_wait_for_exit,
        ])

        # Use ACP's spawn_agent_process for proper stream handling
        exit_stack = AsyncExitStack()
        try:
            connection, process = await exit_stack.enter_async_context(
                acp.spawn_agent_process(
                    client_handler,
                    config.command,
                    *config.args,
                    env=env,
                    use_unstable_protocol=True,
                )
            )

            # Initialize connection
            init_result = await connection.initialize(
                protocol_version=acp.PROTOCOL_VERSION,
                client_capabilities=ClientCapabilities(
                    fs=FileSystemCapability(
                        read_text_file=True,
                        write_text_file=True,
                    ),
                    terminal=has_terminal,
                ),
            )

            capabilities = init_result.agent_capabilities or {}
            # Convert to dict if it's a pydantic model
            if hasattr(capabilities, "model_dump"):
                capabilities = capabilities.model_dump()
            elif hasattr(capabilities, "dict"):
                capabilities = capabilities.dict()
            elif not isinstance(capabilities, dict):
                capabilities = dict(capabilities) if capabilities else {}

            return cls(process, connection, client_handler, capabilities, exit_stack)

        except Exception as e:
            await exit_stack.aclose()
            raise e

    async def create_session(
        self,
        cwd: str,
        options: SessionOptions | None = None,
    ) -> Session:
        """Create a new session with the agent."""
        from acp_factory.session import Session

        options = options or SessionOptions()

        result = await self._connection.new_session(
            cwd=cwd,
            mcp_servers=options.mcp_servers or [],
        )

        # Set mode if specified
        if options.mode:
            await self._connection.set_session_mode(
                session_id=result.session_id,
                mode_id=options.mode,
            )

        # Extract modes and models from result
        modes: list[str] = []
        models: list[str] = []

        if result.modes and result.modes.available_modes:
            modes = [m.id for m in result.modes.available_modes]

        if result.models and result.models.available_models:
            models = [m.model_id for m in result.models.available_models]

        session = Session(
            session_id=result.session_id,
            connection=self._connection,
            client_handler=self._client_handler,
            cwd=cwd,
            modes=modes,
            models=models,
        )

        # Track session for smart fork detection
        self._sessions[result.session_id] = session

        return session

    async def load_session(
        self,
        session_id: str,
        cwd: str,
        mcp_servers: list[dict[str, str]] | None = None,
    ) -> Session:
        """Load an existing session by ID."""
        from acp_factory.session import Session

        mcp_servers = mcp_servers or []

        # Check capability
        load_session_cap = self.capabilities.get("loadSession", False)
        if not load_session_cap:
            raise RuntimeError("Agent does not support loading sessions")

        result = await self._connection.load_session(
            session_id=session_id,
            cwd=cwd,
            mcp_servers=mcp_servers,
        )

        # Extract modes and models from result
        modes: list[str] = []
        models: list[str] = []

        if result.modes and result.modes.available_modes:
            modes = [m.id for m in result.modes.available_modes]

        if result.models and result.models.available_models:
            models = [m.model_id for m in result.models.available_models]

        session = Session(
            session_id=session_id,
            connection=self._connection,
            client_handler=self._client_handler,
            cwd=cwd,
            modes=modes,
            models=models,
        )

        # Track session for smart fork detection
        self._sessions[session_id] = session

        return session

    async def fork_session(
        self,
        session_id: str,
        cwd: str,
        options: ForkSessionOptions | None = None,
    ) -> Session:
        """
        Fork an existing session to create a new independent session.

        The forked session inherits the conversation history from the original,
        allowing operations without affecting the original session's state.
        """
        from acp_factory.session import Session

        options = options or ForkSessionOptions()

        # Check capability
        session_caps = self.capabilities.get("sessionCapabilities", {})
        if not session_caps.get("fork"):
            raise RuntimeError("Agent does not support forking sessions")

        source_session = self._sessions.get(session_id)

        # Determine if flush is needed
        needs_flush = (
            options.force_flush
            or (source_session is not None and source_session.is_processing)
            or source_session is None
        )

        if needs_flush and source_session is not None:
            # Use fork_with_flush for active or processing sessions
            forked_session = await source_session.fork_with_flush(
                idle_timeout=options.idle_timeout,
                persist_timeout=options.persist_timeout,
            )
            self._sessions[forked_session.id] = forked_session
            return forked_session

        # Direct fork for persisted idle sessions
        result = await self._connection.fork_session(
            session_id=session_id,
            cwd=cwd,
        )

        # Extract modes and models from result
        modes: list[str] = []
        models: list[str] = []

        if result.modes and result.modes.available_modes:
            modes = [m.id for m in result.modes.available_modes]

        if result.models and result.models.available_models:
            models = [m.model_id for m in result.models.available_models]

        forked_session = Session(
            session_id=result.session_id,
            connection=self._connection,
            client_handler=self._client_handler,
            cwd=cwd,
            modes=modes,
            models=models,
        )

        # Track the forked session
        self._sessions[result.session_id] = forked_session

        return forked_session

    async def close(self) -> None:
        """Close the agent connection and terminate the process."""
        await self._exit_stack.aclose()

    def get_connection(self) -> ClientSideConnection:
        """Get the underlying connection (for advanced use)."""
        return self._connection

    def is_running(self) -> bool:
        """Check if the agent process is still running."""
        return self._process.returncode is None
