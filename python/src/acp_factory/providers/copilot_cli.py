"""
GitHub Copilot CLI agent configuration
"""

from acp_factory.types import AgentConfig

# Default configuration for GitHub Copilot CLI agent via --acp flag
copilot_cli_config = AgentConfig(
    command="npx",
    args=["@github/copilot", "--acp"],
    env={},
)
