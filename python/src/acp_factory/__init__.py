"""
acp-factory - A library for spawning and managing agents through ACP
"""

from acp_factory.factory import AgentFactory
from acp_factory.agent_handle import AgentHandle
from acp_factory.session import Session
from acp_factory.pushable import Pushable
from acp_factory.client_handler import ACPClientHandler
from acp_factory.types import (
    AgentConfig,
    SpawnOptions,
    SessionOptions,
    PermissionMode,
    ClientHandlers,
    PromptContent,
    FlushOptions,
    FlushResult,
    ForkSessionOptions,
    PermissionRequestUpdate,
    ExtendedSessionUpdate,
)

__version__ = "0.1.0"

__all__ = [
    # Core classes
    "AgentFactory",
    "AgentHandle",
    "Session",
    "Pushable",
    "ACPClientHandler",
    # Configuration types
    "AgentConfig",
    "SpawnOptions",
    "SessionOptions",
    "PermissionMode",
    "ClientHandlers",
    "PromptContent",
    # Session types
    "FlushOptions",
    "FlushResult",
    "ForkSessionOptions",
    # Permission types
    "PermissionRequestUpdate",
    "ExtendedSessionUpdate",
]
