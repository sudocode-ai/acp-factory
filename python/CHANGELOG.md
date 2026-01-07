# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-01-06

### Added

- Initial release - 1:1 port from TypeScript implementation
- `AgentFactory` for registering and spawning agents
- `AgentHandle` for managing agent processes
- `Session` for interacting with agent sessions
- Pre-registered agents: `claude-code`, `codex`, `gemini`, `opencode`
- Streaming responses via async iterators
- Permission handling modes: `auto-approve`, `auto-deny`, `callback`, `interactive`
- Interactive permission requests as session updates
- `session.interrupt_with()` for interrupting and redirecting agents
- `session.fork()` for creating independent session copies (experimental)
- `agent_handle.fork_session()` for forking by session ID (experimental)
- `session.flush()` for checkpointing sessions to disk
- Custom file read/write handlers
- Terminal operation handlers
- MCP server support
- Full type annotations (PEP 561 compliant)

### Dependencies

- `agent-client-protocol` >=0.7.0
