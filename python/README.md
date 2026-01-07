# acp-factory

A Python library for spawning and managing AI agents through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/).

## Installation

```bash
pip install acp-factory
```

## Prerequisites

- Python 3.10+
- [Claude Code](https://claude.ai/claude-code) installed and authenticated (run `claude` once to set up)
- Or set `ANTHROPIC_API_KEY` environment variable

## Quick Start

```python
import asyncio
from acp_factory import AgentFactory

async def main():
    # Spawn a Claude Code agent
    agent = await AgentFactory.spawn("claude-code", {
        "permission_mode": "auto-approve",
    })

    # Create a session
    session = await agent.create_session(".")

    # Send a prompt and stream responses
    async for update in session.prompt("What files are in this directory?"):
        if update.get("session_update") == "agent_message_chunk":
            content = update.get("content", {})
            if content.get("type") == "text":
                print(content.get("text", ""), end="")

    # Clean up
    await agent.close()

asyncio.run(main())
```

## API Reference

### AgentFactory

Static class for managing agent types and spawning agents.

```python
# List available agents
AgentFactory.list_agents()  # ["claude-code", "codex", "gemini", "opencode"]

# Register a custom agent
AgentFactory.register("my-agent", AgentConfig(
    command="my-agent",
    args=["--acp"],
    env={"MY_VAR": "value"},
))

# Spawn an agent
agent = await AgentFactory.spawn("claude-code", options)
```

### AgentHandle

Represents a running agent process.

```python
# Agent capabilities
agent.capabilities  # {"loadSession": True, ...}

# Create a new session
session = await agent.create_session("/path/to/cwd", SessionOptions(
    mode="code",
    mcp_servers=[],
))

# Load an existing session
session = await agent.load_session(session_id, "/path/to/cwd")

# Close the agent
await agent.close()

# Check if running
agent.is_running()  # True/False
```

### Session

High-level interface for interacting with an agent session.

```python
# Session properties
session.id       # Session ID
session.modes    # Available modes ["code", "ask", ...]
session.models   # Available models ["claude-sonnet-4-...", ...]

# Send a prompt (returns async iterator)
async for update in session.prompt("Hello!"):
    # Handle updates
    pass

# Cancel the current prompt
await session.cancel()

# Set the session mode
await session.set_mode("ask")

# Interrupt and redirect with new context
async for update in session.interrupt_with("Focus on tests only"):
    # Handle updates from new prompt
    pass
```

## Permission Modes

Control how permission requests are handled:

```python
from acp_factory import SpawnOptions

# Auto-approve all requests (default)
await AgentFactory.spawn("claude-code", SpawnOptions(
    permission_mode="auto-approve",
))

# Auto-deny all requests
await AgentFactory.spawn("claude-code", SpawnOptions(
    permission_mode="auto-deny",
))

# Use a callback handler
async def handle_permission(request):
    return {"outcome": {"outcome": "selected", "option_id": "allow"}}

await AgentFactory.spawn("claude-code", SpawnOptions(
    permission_mode="callback",
    on_permission_request=handle_permission,
))

# Interactive mode - permissions emitted as session updates
await AgentFactory.spawn("claude-code", SpawnOptions(
    permission_mode="interactive",
))
```

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/sudocode-ai/acp-factory.git
cd acp-factory/python

# Install with dev dependencies
make dev
# or
pip install -e ".[dev]"
```

### Commands

```bash
# Run tests
make test

# Run linter
make lint

# Format code
make format

# Type check
make typecheck

# Clean build artifacts
make clean
```

## Publishing to PyPI

### Prerequisites

1. Create accounts on [PyPI](https://pypi.org/) and [TestPyPI](https://test.pypi.org/)
2. Create API tokens for both
3. Configure `~/.pypirc`:

```ini
[distutils]
index-servers =
    pypi
    testpypi

[pypi]
username = __token__
password = pypi-YOUR_PYPI_TOKEN

[testpypi]
username = __token__
password = pypi-YOUR_TESTPYPI_TOKEN
```

### Release Process

1. **Update version** in both files:
   - `pyproject.toml` → `version = "X.Y.Z"`
   - `src/acp_factory/__init__.py` → `__version__ = "X.Y.Z"`

2. **Update CHANGELOG.md** with release notes

3. **Test on TestPyPI first:**
   ```bash
   make publish-test

   # Test installation from TestPyPI
   pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ acp-factory
   ```

4. **Publish to PyPI:**
   ```bash
   make publish
   ```

5. **Create git tag:**
   ```bash
   git tag v0.0.1
   git push --tags
   ```

### Manual Publishing

If you prefer not to use Make:

```bash
# Install build tools
pip install build twine

# Build package
python -m build

# Upload to TestPyPI
python -m twine upload --repository testpypi dist/*

# Upload to PyPI
python -m twine upload dist/*
```

## License

MIT
