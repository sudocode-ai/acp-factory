"""
E2E tests for Codex agent integration.

These tests use the real Codex CLI and require:
1. @zed-industries/codex-acp installed
2. Codex authenticated (via browser auth, OPENAI_API_KEY, or CODEX_API_KEY)

Run with: RUN_E2E_TESTS=true pytest tests/e2e/test_codex_e2e.py -v
"""

import os
import shutil
import tempfile

import pytest

from acp_factory import AgentFactory, AgentHandle, ExtendedSessionUpdate

# Skip all tests if RUN_E2E_TESTS is not set
pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_E2E_TESTS") != "true",
    reason="E2E tests require RUN_E2E_TESTS=true",
)


@pytest.fixture(scope="module")
async def agent_handle() -> AgentHandle:
    """Spawn Codex agent once for the module."""
    handle = await AgentFactory.spawn("codex")
    yield handle
    await handle.close()


class TestCodexAgentInitialization:
    """Tests for agent initialization."""

    def test_should_have_codex_registered_in_factory(self) -> None:
        """Codex should be registered in factory."""
        config = AgentFactory.get_config("codex")
        assert config is not None
        assert config.command == "npx"
        assert "@zed-industries/codex-acp" in config.args

    @pytest.mark.asyncio
    async def test_should_spawn_codex_agent_successfully(
        self, agent_handle: AgentHandle
    ) -> None:
        """Agent should spawn successfully."""
        assert agent_handle is not None
        assert agent_handle.capabilities is not None

    @pytest.mark.asyncio
    async def test_should_advertise_capabilities(
        self, agent_handle: AgentHandle
    ) -> None:
        """Agent should advertise capabilities."""
        print(f"Codex capabilities: {agent_handle.capabilities}")
        assert agent_handle.capabilities is not None


class TestCodexSessionManagement:
    """Tests for session management."""

    @pytest.mark.asyncio
    async def test_should_create_a_new_session(
        self, agent_handle: AgentHandle
    ) -> None:
        """Should create a new session."""
        temp_dir = tempfile.mkdtemp(prefix="codex-session-")
        try:
            session = await agent_handle.create_session(temp_dir)
            assert session is not None
            assert session.id is not None
            assert session.cwd == temp_dir
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.mark.asyncio
    async def test_should_create_multiple_sessions(
        self, agent_handle: AgentHandle
    ) -> None:
        """Should create multiple independent sessions."""
        temp_dir = tempfile.mkdtemp(prefix="codex-multi-")
        try:
            session1 = await agent_handle.create_session(temp_dir)
            session2 = await agent_handle.create_session(temp_dir)

            assert session1.id is not None
            assert session2.id is not None
            assert session1.id != session2.id
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


class TestCodexBasicPrompting:
    """Tests for basic prompting functionality."""

    @pytest.mark.asyncio
    async def test_should_respond_to_a_simple_prompt(
        self, agent_handle: AgentHandle
    ) -> None:
        """Should respond to a simple prompt."""
        temp_dir = tempfile.mkdtemp(prefix="codex-prompt-")
        try:
            session = await agent_handle.create_session(temp_dir)
            updates: list[ExtendedSessionUpdate] = []

            async for update in session.prompt(
                "What is 2 + 2? Reply with just the number."
            ):
                updates.append(update)

            # Should have received some updates
            assert len(updates) > 0

            # Check for agent message chunks
            message_chunks = [
                u for u in updates if u.get("sessionUpdate") == "agent_message_chunk"
            ]
            assert len(message_chunks) > 0
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.mark.asyncio
    async def test_should_handle_multi_turn_conversation(
        self, agent_handle: AgentHandle
    ) -> None:
        """Should handle multi-turn conversation with context."""
        temp_dir = tempfile.mkdtemp(prefix="codex-multi-turn-")
        try:
            session = await agent_handle.create_session(temp_dir)

            # First turn
            updates1: list[ExtendedSessionUpdate] = []
            async for update in session.prompt(
                "Remember the word 'banana'. Just say 'I will remember banana'."
            ):
                updates1.append(update)
            assert len(updates1) > 0

            # Second turn - recall
            updates2: list[ExtendedSessionUpdate] = []
            response_text = ""
            async for update in session.prompt(
                "What word did I ask you to remember? Just say the word."
            ):
                updates2.append(update)
                if update.get("sessionUpdate") == "agent_message_chunk":
                    content = update.get("content", {})
                    if isinstance(content, dict) and content.get("type") == "text":
                        response_text += content.get("text", "")

            assert len(updates2) > 0
            assert "banana" in response_text.lower()
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.mark.asyncio
    async def test_should_handle_streaming_responses(
        self, agent_handle: AgentHandle
    ) -> None:
        """Should handle streaming responses."""
        temp_dir = tempfile.mkdtemp(prefix="codex-stream-")
        try:
            session = await agent_handle.create_session(temp_dir)
            updates: list[ExtendedSessionUpdate] = []
            text_content = ""

            async for update in session.prompt(
                "Count from 1 to 5, each number on a new line."
            ):
                updates.append(update)
                if update.get("sessionUpdate") == "agent_message_chunk":
                    content = update.get("content", {})
                    if isinstance(content, dict) and content.get("type") == "text":
                        text_content += content.get("text", "")

            # Should have multiple streaming chunks
            message_chunks = [
                u for u in updates if u.get("sessionUpdate") == "agent_message_chunk"
            ]
            assert len(message_chunks) > 0

            # Content should include numbers
            assert any(str(n) in text_content for n in range(1, 6))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


class TestCodexSessionProperties:
    """Tests for session properties."""

    @pytest.mark.asyncio
    async def test_should_have_modes_property(
        self, agent_handle: AgentHandle
    ) -> None:
        """Session should have modes property."""
        temp_dir = tempfile.mkdtemp(prefix="codex-modes-")
        try:
            session = await agent_handle.create_session(temp_dir)
            print(f"Codex session modes: {session.modes}")
            assert session.modes is not None
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.mark.asyncio
    async def test_should_have_models_property(
        self, agent_handle: AgentHandle
    ) -> None:
        """Session should have models property."""
        temp_dir = tempfile.mkdtemp(prefix="codex-models-")
        try:
            session = await agent_handle.create_session(temp_dir)
            print(f"Codex session models: {session.models}")
            assert session.models is not None
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.mark.asyncio
    async def test_should_track_is_processing_state(
        self, agent_handle: AgentHandle
    ) -> None:
        """Session should track isProcessing state."""
        temp_dir = tempfile.mkdtemp(prefix="codex-processing-")
        try:
            session = await agent_handle.create_session(temp_dir)

            # Initially not processing
            assert session.is_processing is False

            # Start a prompt and consume it
            async for _ in session.prompt("Say hello"):
                pass

            # After completion, should not be processing
            assert session.is_processing is False
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


class TestCodexCapabilities:
    """Tests for agent capabilities."""

    @pytest.mark.asyncio
    async def test_should_check_load_session_capability(
        self, agent_handle: AgentHandle
    ) -> None:
        """Should check loadSession capability."""
        load_session = agent_handle.capabilities.get("loadSession")
        print(f"Codex loadSession capability: {load_session}")
        assert isinstance(load_session, bool)

    @pytest.mark.asyncio
    async def test_should_check_fork_capability(
        self, agent_handle: AgentHandle
    ) -> None:
        """Should check fork capability."""
        session_caps = agent_handle.capabilities.get("sessionCapabilities", {})
        print(f"Codex fork capability: {session_caps.get('fork')}")
        assert agent_handle.capabilities is not None

    @pytest.mark.asyncio
    async def test_should_load_session_if_capability_is_supported(
        self, agent_handle: AgentHandle
    ) -> None:
        """Should load session if capability is supported."""
        if not agent_handle.capabilities.get("loadSession"):
            pytest.skip("Codex does not support loadSession")

        temp_dir = tempfile.mkdtemp(prefix="codex-load-")
        try:
            # Create a session first
            original_session = await agent_handle.create_session(temp_dir)
            session_id = original_session.id

            # Try to load/resume the session
            loaded_session = await agent_handle.load_session(session_id, temp_dir)

            assert loaded_session.id == session_id
            assert loaded_session.cwd == temp_dir
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.mark.asyncio
    async def test_should_fork_session_if_capability_is_supported(
        self, agent_handle: AgentHandle
    ) -> None:
        """Should fork session if capability is supported."""
        session_caps = agent_handle.capabilities.get("sessionCapabilities", {})
        if not session_caps.get("fork"):
            pytest.skip("Codex does not support forking")

        temp_dir = tempfile.mkdtemp(prefix="codex-fork-")
        try:
            session = await agent_handle.create_session(temp_dir)

            # Send a prompt to establish history
            async for _ in session.prompt("Say 'Hello from original'."):
                pass

            # Fork the session
            forked_session = await session.fork()

            assert forked_session.id is not None
            assert forked_session.id != session.id
            assert forked_session.cwd == temp_dir
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


class TestCodexErrorHandling:
    """Tests for error handling."""

    @pytest.mark.asyncio
    async def test_should_handle_empty_prompts_gracefully(
        self, agent_handle: AgentHandle
    ) -> None:
        """Should handle empty prompts gracefully."""
        temp_dir = tempfile.mkdtemp(prefix="codex-empty-")
        try:
            session = await agent_handle.create_session(temp_dir)

            updates: list[ExtendedSessionUpdate] = []
            async for update in session.prompt(""):
                updates.append(update)

            # Should complete without throwing
            assert isinstance(updates, list)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


class TestCodexVsClaudeCodeComparison:
    """Tests comparing Codex vs Claude Code."""

    def test_should_have_both_agents_registered(self) -> None:
        """Both agents should be registered."""
        agents = AgentFactory.list_agents()

        assert "claude-code" in agents
        assert "codex" in agents

    @pytest.mark.asyncio
    async def test_should_spawn_codex_agent_successfully(self) -> None:
        """Should spawn codex agent successfully."""
        handle = await AgentFactory.spawn("codex")
        assert handle is not None
        assert handle.capabilities is not None
        await handle.close()
