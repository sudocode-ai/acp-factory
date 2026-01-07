"""
OpenCode agent configuration

OpenCode is an open source AI coding agent built in Go.
Install via: curl -fsSL https://opencode.ai/install | bash
Or: go install github.com/opencode-ai/opencode@latest

See: https://opencode.ai/docs/acp/
"""

from acp_factory.types import AgentConfig

# Default configuration for OpenCode agent via ACP mode
opencode_config = AgentConfig(
    command="opencode",
    args=["acp"],
    env={},
)
