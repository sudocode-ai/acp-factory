"""
E2E tests for Gemini CLI agent integration.

Run with: RUN_E2E_TESTS=true pytest tests/e2e/test_gemini_e2e.py -v
"""

import os
import shutil
import tempfile

import pytest

from acp_factory import AgentFactory, ExtendedSessionUpdate

# Skip all tests if RUN_E2E_TESTS is not set
pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_E2E_TESTS") != "true",
    reason="E2E tests require RUN_E2E_TESTS=true",
)


class TestGeminiAgent:
    """E2E tests for Gemini agent."""

    def test_should_have_gemini_registered_in_factory(self) -> None:
        """Gemini should be registered in factory."""
        config = AgentFactory.get_config("gemini")
        assert config is not None
        assert config.command == "npx"
        assert "@google/gemini-cli" in config.args
        assert "--experimental-acp" in config.args

    @pytest.mark.asyncio
    async def test_should_spawn_and_create_session(self) -> None:
        """Should spawn agent and create session."""
        handle = await AgentFactory.spawn("gemini")
        try:
            assert handle is not None
            assert handle.capabilities is not None
            print(f"Gemini capabilities: {handle.capabilities}")

            temp_dir = tempfile.mkdtemp(prefix="gemini-e2e-")
            try:
                session = await handle.create_session(temp_dir)
                assert session is not None
                assert session.id is not None
                assert session.cwd == temp_dir
                print(f"Session ID: {session.id}")
                print(f"Modes: {session.modes}")
                print(f"Models: {session.models}")
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)
        finally:
            await handle.close()

    @pytest.mark.asyncio
    async def test_should_respond_to_simple_prompt(self) -> None:
        """Should respond to a simple prompt."""
        handle = await AgentFactory.spawn("gemini")
        try:
            temp_dir = tempfile.mkdtemp(prefix="gemini-prompt-")
            try:
                session = await handle.create_session(temp_dir)
                updates: list[ExtendedSessionUpdate] = []

                async for update in session.prompt(
                    "What is 2 + 2? Reply with just the number."
                ):
                    updates.append(update)

                # Should have received some updates
                assert len(updates) > 0
                print(f"Received {len(updates)} updates")

                # Check for agent message chunks (handle both dict and pydantic model)
                message_chunks = [
                    u for u in updates
                    if (hasattr(u, "session_update") and u.session_update == "agent_message_chunk")
                    or (isinstance(u, dict) and u.get("sessionUpdate") == "agent_message_chunk")
                ]
                assert len(message_chunks) > 0
                print(f"Got {len(message_chunks)} message chunks")
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)
        finally:
            await handle.close()

    @pytest.mark.asyncio
    async def test_should_handle_streaming_responses(self) -> None:
        """Should handle streaming responses."""
        handle = await AgentFactory.spawn("gemini")
        try:
            temp_dir = tempfile.mkdtemp(prefix="gemini-stream-")
            try:
                session = await handle.create_session(temp_dir)
                updates: list[ExtendedSessionUpdate] = []
                text_content = ""

                async for update in session.prompt(
                    "Count from 1 to 5, each number on a new line."
                ):
                    updates.append(update)
                    # Handle pydantic model
                    if hasattr(update, "session_update"):
                        if update.session_update == "agent_message_chunk":
                            content = getattr(update, "content", None)
                            if content and hasattr(content, "type") and content.type == "text":
                                text_content += getattr(content, "text", "")
                    # Handle dict
                    elif isinstance(update, dict) and update.get("sessionUpdate") == "agent_message_chunk":
                        content = update.get("content", {})
                        if isinstance(content, dict) and content.get("type") == "text":
                            text_content += content.get("text", "")

                # Should have streaming chunks
                message_chunks = [
                    u for u in updates
                    if (hasattr(u, "session_update") and u.session_update == "agent_message_chunk")
                    or (isinstance(u, dict) and u.get("sessionUpdate") == "agent_message_chunk")
                ]
                assert len(message_chunks) > 0

                # Content should include numbers
                assert any(str(n) in text_content for n in range(1, 6))
                print(f"Response text: {text_content[:200]}")
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)
        finally:
            await handle.close()

    @pytest.mark.asyncio
    async def test_should_track_is_processing_state(self) -> None:
        """Session should track isProcessing state."""
        handle = await AgentFactory.spawn("gemini")
        try:
            temp_dir = tempfile.mkdtemp(prefix="gemini-processing-")
            try:
                session = await handle.create_session(temp_dir)

                # Initially not processing
                assert session.is_processing is False

                # Start a prompt and consume it
                async for _ in session.prompt("Say hello"):
                    pass

                # After completion, should not be processing
                assert session.is_processing is False
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)
        finally:
            await handle.close()


class TestAllAgentsRegistration:
    """Tests for agent registration."""

    def test_should_have_all_agents_registered(self) -> None:
        """All agents should be registered."""
        agents = AgentFactory.list_agents()

        assert "claude-code" in agents
        assert "codex" in agents
        assert "gemini" in agents
        assert "opencode" in agents
