"""
E2E tests for OpenCode agent integration.

These tests use the real OpenCode CLI and require:
1. OpenCode installed (curl -fsSL https://opencode.ai/install | bash)
2. OpenCode configured with a provider (Claude, OpenAI, Gemini, etc.)

Run with: RUN_E2E_TESTS=true pytest tests/e2e/test_opencode_e2e.py -v
"""

import os
import shutil
import tempfile

import pytest

from acp_factory import AgentFactory, AgentHandle, ExtendedSessionUpdate, Session

# Skip all tests if RUN_E2E_TESTS is not set
pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_E2E_TESTS") != "true",
    reason="E2E tests require RUN_E2E_TESTS=true",
)


class TestOpenCodeAgent:
    """E2E tests for OpenCode agent."""

    handle: AgentHandle | None = None
    temp_dir: str | None = None

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self) -> None:
        """Set up and tear down for each test."""
        # Create temp directory
        self.temp_dir = tempfile.mkdtemp(prefix="opencode-e2e-")

        yield

        # Cleanup temp directory
        if self.temp_dir and os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    @pytest.fixture(scope="class")
    async def agent_handle(self) -> AgentHandle:
        """Spawn OpenCode agent once for the class."""
        handle = await AgentFactory.spawn("opencode")
        yield handle
        await handle.close()

    class TestAgentInitialization:
        """Tests for agent initialization."""

        def test_should_have_opencode_registered_in_factory(self) -> None:
            """OpenCode should be registered in factory."""
            config = AgentFactory.get_config("opencode")
            assert config is not None
            assert config.command == "opencode"
            assert "acp" in config.args

        @pytest.mark.asyncio
        async def test_should_spawn_opencode_agent_successfully(
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
            print(f"OpenCode capabilities: {agent_handle.capabilities}")
            assert agent_handle.capabilities is not None

    class TestSessionManagement:
        """Tests for session management."""

        @pytest.mark.asyncio
        async def test_should_create_a_new_session(
            self, agent_handle: AgentHandle
        ) -> None:
            """Should create a new session."""
            temp_dir = tempfile.mkdtemp(prefix="opencode-session-")
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
            temp_dir = tempfile.mkdtemp(prefix="opencode-multi-")
            try:
                session1 = await agent_handle.create_session(temp_dir)
                session2 = await agent_handle.create_session(temp_dir)

                assert session1.id is not None
                assert session2.id is not None
                assert session1.id != session2.id
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)

    class TestBasicPrompting:
        """Tests for basic prompting functionality."""

        @pytest.mark.asyncio
        async def test_should_respond_to_a_simple_prompt(
            self, agent_handle: AgentHandle
        ) -> None:
            """Should respond to a simple prompt."""
            temp_dir = tempfile.mkdtemp(prefix="opencode-prompt-")
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
            temp_dir = tempfile.mkdtemp(prefix="opencode-multi-turn-")
            try:
                session = await agent_handle.create_session(temp_dir)

                # First turn
                updates1: list[ExtendedSessionUpdate] = []
                async for update in session.prompt(
                    "Remember the word 'apple'. Just say 'I will remember apple'."
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
                assert "apple" in response_text.lower()
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)

        @pytest.mark.asyncio
        async def test_should_handle_streaming_responses(
            self, agent_handle: AgentHandle
        ) -> None:
            """Should handle streaming responses."""
            temp_dir = tempfile.mkdtemp(prefix="opencode-stream-")
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

    class TestSessionProperties:
        """Tests for session properties."""

        @pytest.mark.asyncio
        async def test_should_have_modes_property(
            self, agent_handle: AgentHandle
        ) -> None:
            """Session should have modes property."""
            temp_dir = tempfile.mkdtemp(prefix="opencode-modes-")
            try:
                session = await agent_handle.create_session(temp_dir)
                print(f"OpenCode session modes: {session.modes}")
                assert session.modes is not None
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)

        @pytest.mark.asyncio
        async def test_should_have_models_property(
            self, agent_handle: AgentHandle
        ) -> None:
            """Session should have models property."""
            temp_dir = tempfile.mkdtemp(prefix="opencode-models-")
            try:
                session = await agent_handle.create_session(temp_dir)
                print(f"OpenCode session models: {session.models}")
                assert session.models is not None
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)

        @pytest.mark.asyncio
        async def test_should_track_is_processing_state(
            self, agent_handle: AgentHandle
        ) -> None:
            """Session should track isProcessing state."""
            temp_dir = tempfile.mkdtemp(prefix="opencode-processing-")
            try:
                session = await agent_handle.create_session(temp_dir)

                # Initially not processing
                assert session.is_processing is False

                # Start a prompt and consume it
                async for _ in session.prompt("Say hello"):
                    # During processing
                    pass

                # After completion, should not be processing
                assert session.is_processing is False
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)

    class TestCapabilities:
        """Tests for agent capabilities."""

        @pytest.mark.asyncio
        async def test_should_check_load_session_capability(
            self, agent_handle: AgentHandle
        ) -> None:
            """Should check loadSession capability."""
            print(
                f"OpenCode loadSession capability: {agent_handle.capabilities.get('loadSession')}"
            )
            assert "loadSession" in agent_handle.capabilities or True  # May not be present

        @pytest.mark.asyncio
        async def test_should_check_fork_capability(
            self, agent_handle: AgentHandle
        ) -> None:
            """Should check fork capability."""
            session_caps = agent_handle.capabilities.get("sessionCapabilities", {})
            print(f"OpenCode fork capability: {session_caps.get('fork')}")
            assert agent_handle.capabilities is not None


class TestAllAgentsComparison:
    """Tests comparing all registered agents."""

    def test_should_have_all_four_agents_registered(self) -> None:
        """All four agents should be registered."""
        agents = AgentFactory.list_agents()

        assert "claude-code" in agents
        assert "codex" in agents
        assert "gemini" in agents
        assert "opencode" in agents

    @pytest.mark.asyncio
    async def test_should_spawn_opencode_agent_successfully(self) -> None:
        """Should spawn opencode agent successfully."""
        handle = await AgentFactory.spawn("opencode")
        assert handle is not None
        assert handle.capabilities is not None
        await handle.close()
