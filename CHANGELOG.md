# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2024-XX-XX

### Added

- Initial release
- `AgentFactory` for registering and spawning agents
- `AgentHandle` for managing agent processes
- `Session` for interacting with agent sessions
- Pre-registered `claude-code` agent
- Streaming responses via async iterators
- Permission handling modes: `auto-approve`, `auto-deny`, `callback`, `interactive`
- Interactive permission requests as session updates
- `session.interruptWith()` for interrupting and redirecting agents
- `session.fork()` for creating independent session copies (experimental)
- `agentHandle.forkSession()` for forking by session ID (experimental)
- `session.addContext()` stub for future mid-execution messaging
- Custom file read/write handlers
- Terminal operation handlers
- MCP server support
- Full TypeScript type exports

### Dependencies

- `@agentclientprotocol/sdk` ^0.10.0
