"""
Codex agent configuration
"""

from acp_factory.types import AgentConfig

# Default configuration for Codex agent via codex-acp
codex_config = AgentConfig(
    command="npx",
    args=["@zed-industries/codex-acp"],
    env={},
)
