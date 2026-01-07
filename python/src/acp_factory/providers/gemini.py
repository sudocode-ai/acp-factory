"""
Gemini CLI agent configuration
"""

from acp_factory.types import AgentConfig

# Default configuration for Gemini CLI agent via --experimental-acp flag
gemini_config = AgentConfig(
    command="npx",
    args=["@google/gemini-cli", "--experimental-acp"],
    env={},
)
