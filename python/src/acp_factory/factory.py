"""
AgentFactory - Registry and spawner for agent types
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from acp_factory.types import AgentConfig, SpawnOptions

if TYPE_CHECKING:
    from acp_factory.agent_handle import AgentHandle


class AgentFactory:
    """Factory for spawning and managing agents"""

    _registry: dict[str, AgentConfig] = {}

    @classmethod
    def register(cls, name: str, config: AgentConfig) -> None:
        """Register an agent configuration"""
        cls._registry[name] = config

    @classmethod
    def get_config(cls, name: str) -> AgentConfig | None:
        """Get a registered agent configuration"""
        return cls._registry.get(name)

    @classmethod
    def list_agents(cls) -> list[str]:
        """List all registered agent names"""
        return list(cls._registry.keys())

    @classmethod
    async def spawn(
        cls,
        name: str,
        options: SpawnOptions | None = None,
    ) -> AgentHandle:
        """Spawn an agent by name"""
        from acp_factory.agent_handle import AgentHandle

        config = cls._registry.get(name)
        if config is None:
            available = ", ".join(cls.list_agents())
            raise ValueError(f"Unknown agent type: {name}. Available: {available}")

        options = options or SpawnOptions()

        # Merge environment variables
        merged_env = {**config.env, **options.env}
        merged_config = AgentConfig(
            command=config.command,
            args=config.args,
            env=merged_env,
        )

        return await AgentHandle.create(merged_config, options)


# Register default providers on import
def _register_defaults() -> None:
    from acp_factory.providers.claude_code import claude_code_config
    from acp_factory.providers.codex import codex_config
    from acp_factory.providers.gemini import gemini_config
    from acp_factory.providers.opencode import opencode_config

    AgentFactory.register("claude-code", claude_code_config)
    AgentFactory.register("codex", codex_config)
    AgentFactory.register("gemini", gemini_config)
    AgentFactory.register("opencode", opencode_config)


_register_defaults()
