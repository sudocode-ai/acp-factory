"""
Claude Code agent configuration
"""

from acp_factory.types import AgentConfig

# Default configuration for Claude Code agent via claude-code-acp
claude_code_config = AgentConfig(
    command="npx",
    args=["@agentclientprotocol/claude-agent-acp"],
    env={},
)
