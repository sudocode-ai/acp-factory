"""
Type definitions for acp-factory
"""

from dataclasses import dataclass, field
from typing import (
    Any,
    Awaitable,
    Callable,
    Literal,
    TypeAlias,
    Union,
)

# Permission handling mode
PermissionMode = Literal["auto-approve", "auto-deny", "callback", "interactive"]


@dataclass
class AgentConfig:
    """Configuration for spawning an agent"""

    command: str
    """Command to execute (e.g., 'npx', 'python')"""

    args: list[str]
    """Arguments for the command"""

    env: dict[str, str] = field(default_factory=dict)
    """Environment variables to set"""


@dataclass
class PermissionRequestUpdate:
    """A permission request emitted as a session update (for interactive mode)"""

    session_update: Literal["permission_request"]
    """Update type identifier"""

    request_id: str
    """Unique ID for this permission request (use to respond)"""

    session_id: str
    """Session this request belongs to"""

    tool_call: dict[str, Any]
    """The tool call that triggered this permission request"""

    options: list[dict[str, Any]]
    """Available options for the user to choose from"""


# Extended session update type that includes permission requests
ExtendedSessionUpdate: TypeAlias = Union[dict[str, Any], PermissionRequestUpdate]


@dataclass
class ClientHandlers:
    """Handlers for client-side operations"""

    on_permission_request: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = None
    """Handle permission requests from the agent"""

    on_file_read: Callable[[str], Awaitable[str]] | None = None
    """Handle file read requests"""

    on_file_write: Callable[[str, str], Awaitable[None]] | None = None
    """Handle file write requests"""

    on_terminal_create: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = None
    """Handle terminal creation requests"""

    on_terminal_output: Callable[[str], Awaitable[str]] | None = None
    """Handle terminal output requests"""

    on_terminal_kill: Callable[[str], Awaitable[None]] | None = None
    """Handle terminal kill requests"""

    on_terminal_release: Callable[[str], Awaitable[None]] | None = None
    """Handle terminal release requests"""

    on_terminal_wait_for_exit: Callable[[str], Awaitable[int]] | None = None
    """Handle terminal wait for exit requests"""


@dataclass
class SpawnOptions(ClientHandlers):
    """Options for spawning an agent"""

    env: dict[str, str] = field(default_factory=dict)
    """Environment variables to merge with agent config"""

    permission_mode: PermissionMode = "auto-approve"
    """Permission handling mode"""


@dataclass
class SessionOptions:
    """Options for creating a session"""

    mcp_servers: list[dict[str, Any]] = field(default_factory=list)
    """MCP servers to connect"""

    mode: str | None = None
    """Initial mode for the session"""


# Content that can be sent as a prompt
PromptContent: TypeAlias = Union[str, list[dict[str, Any]]]


@dataclass
class FlushOptions:
    """Options for flushing a session to disk"""

    idle_timeout: int = 5000
    """Maximum time to wait for session to become idle (default: 5000ms)"""

    persist_timeout: int = 5000
    """Maximum time to wait for disk persistence (default: 5000ms)"""


@dataclass
class FlushResult:
    """Result of a session flush operation"""

    success: bool
    """Whether the flush succeeded"""

    file_path: str | None = None
    """Path to the session file (if successful)"""

    error: str | None = None
    """Error message (if failed)"""


@dataclass
class ForkSessionOptions:
    """Options for forking a session"""

    force_flush: bool = False
    """Force using flush-based forking even if the session appears idle"""

    idle_timeout: int = 5000
    """Maximum time to wait for session to become idle (default: 5000ms)"""

    persist_timeout: int = 5000
    """Maximum time to wait for disk persistence (default: 5000ms)"""
