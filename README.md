# acp-factory

A TypeScript library for spawning and managing AI agents through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/).

## Installation

```bash
npm install acp-factory
```

## Prerequisites

- Node.js 18+
- [Claude Code](https://claude.ai/claude-code) installed and authenticated (run `claude` once to set up)
- Or set `ANTHROPIC_API_KEY` environment variable

## Quick Start

```typescript
import { AgentFactory } from "acp-factory";

// Spawn a Claude Code agent
const agent = await AgentFactory.spawn("claude-code", {
  permissionMode: "auto-approve",
});

// Create a session
const session = await agent.createSession(process.cwd());

// Send a prompt and stream responses
for await (const update of session.prompt("What files are in this directory?")) {
  if (update.sessionUpdate === "agent_message_chunk") {
    if (update.content.type === "text") {
      process.stdout.write(update.content.text);
    }
  }
}

// Clean up
await agent.close();
```

## API Reference

### AgentFactory

Static class for managing agent types and spawning agents.

```typescript
// List available agents
AgentFactory.listAgents(); // ["claude-code"]

// Register a custom agent
AgentFactory.register("my-agent", {
  command: "npx",
  args: ["my-agent-acp"],
  env: { MY_VAR: "value" },
});

// Spawn an agent
const agent = await AgentFactory.spawn("claude-code", options);
```

### AgentHandle

Represents a running agent process.

```typescript
// Agent capabilities
agent.capabilities; // { loadSession: true, ... }

// Create a new session
const session = await agent.createSession("/path/to/cwd", {
  mode: "code",           // Optional: initial mode
  mcpServers: [],         // Optional: MCP servers to connect
});

// Load an existing session
const session = await agent.loadSession(sessionId, "/path/to/cwd");

// Fork an existing session (experimental)
const forkedSession = await agent.forkSession(sessionId);

// Close the agent
await agent.close();

// Check if running
agent.isRunning(); // true/false
```

### Session

High-level interface for interacting with an agent session.

```typescript
// Session properties
session.id;      // Session ID
session.modes;   // Available modes ["code", "ask", ...]
session.models;  // Available models ["claude-sonnet-4-...", ...]

// Send a prompt (returns async iterable)
for await (const update of session.prompt("Hello!")) {
  // Handle updates
}

// Cancel the current prompt
await session.cancel();

// Set the session mode
await session.setMode("ask");

// Interrupt and redirect with new context
for await (const update of session.interruptWith("Focus on tests only")) {
  // Handle updates from new prompt
}

// Fork the session (experimental)
const forkedSession = await session.fork();
```

## Session Updates

The `prompt()` method yields `SessionUpdate` objects:

```typescript
for await (const update of session.prompt("Hello")) {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      // Text or image content from the agent
      if (update.content.type === "text") {
        process.stdout.write(update.content.text);
      }
      break;

    case "tool_call":
      // Agent is calling a tool
      console.log(`Tool: ${update.title}`);
      break;

    case "tool_call_update":
      // Tool call status changed
      if (update.status === "completed") {
        console.log("Tool completed");
      }
      break;

    case "agent_thought_chunk":
      // Agent's thinking (if enabled)
      break;
  }
}
```

## Permission Modes

Control how permission requests are handled:

```typescript
// Auto-approve all requests (default)
await AgentFactory.spawn("claude-code", {
  permissionMode: "auto-approve",
});

// Auto-deny all requests
await AgentFactory.spawn("claude-code", {
  permissionMode: "auto-deny",
});

// Use a callback handler
await AgentFactory.spawn("claude-code", {
  permissionMode: "callback",
  onPermissionRequest: async (request) => {
    // Return permission response
    return {
      outcome: { outcome: "selected", optionId: "allow" },
    };
  },
});

// Interactive mode - permissions emitted as session updates
await AgentFactory.spawn("claude-code", {
  permissionMode: "interactive",
});
```

### Interactive Permissions

With `permissionMode: "interactive"`, permission requests appear as session updates:

```typescript
import { type ExtendedSessionUpdate } from "acp-factory";

for await (const update of session.prompt("Write a file")) {
  if (update.sessionUpdate === "permission_request") {
    // Show options to user
    console.log(`Permission needed: ${update.toolCall.title}`);
    update.options.forEach((opt, i) => {
      console.log(`${i + 1}. ${opt.name}`);
    });

    // Respond to the request
    session.respondToPermission(update.requestId, update.options[0].optionId);
    // Or cancel it
    // session.cancelPermission(update.requestId);
  }
}
```

## Interrupting and Redirecting

Interrupt an agent mid-execution and redirect with new context:

```typescript
const promptIterator = session.prompt("Analyze this codebase")[Symbol.asyncIterator]();

while (true) {
  const { done, value } = await promptIterator.next();
  if (done) break;

  handleUpdate(value);

  if (userWantsToRedirect) {
    // Interrupt and provide new direction
    for await (const update of session.interruptWith("Focus only on the tests")) {
      handleUpdate(update);
    }
    break;
  }
}
```

## Forking Sessions

Fork a session to create an independent copy with shared history:

```typescript
// Original session continues normally
const session = await agent.createSession(process.cwd());
await consumePrompt(session.prompt("Analyze the codebase"));

// Fork to generate summary without affecting original
const summarySession = await session.fork();
for await (const update of summarySession.prompt("Summarize our conversation")) {
  // This doesn't affect the original session
}

// Original session can continue independently
for await (const update of session.prompt("Now implement the feature")) {
  // Continues from original context
}
```

## Custom File and Terminal Handlers

Override default file operations or provide terminal support:

```typescript
const agent = await AgentFactory.spawn("claude-code", {
  // Custom file handling
  onFileRead: async (path) => {
    return await myCustomRead(path);
  },
  onFileWrite: async (path, content) => {
    await myCustomWrite(path, content);
  },

  // Terminal support (all handlers required)
  onTerminalCreate: async (params) => {
    const id = createTerminal(params.command, params.args);
    return { terminalId: id };
  },
  onTerminalOutput: async (terminalId) => {
    return getTerminalOutput(terminalId);
  },
  onTerminalKill: async (terminalId) => {
    killTerminal(terminalId);
  },
  onTerminalRelease: async (terminalId) => {
    releaseTerminal(terminalId);
  },
  onTerminalWaitForExit: async (terminalId) => {
    return await waitForExit(terminalId);
  },
});
```

## Examples

See the [examples](./examples) directory:

- [`basic-usage.ts`](./examples/basic-usage.ts) - Simple prompt and response
- [`interactive-permissions.ts`](./examples/interactive-permissions.ts) - Handle permissions in UI
- [`interrupt-context.ts`](./examples/interrupt-context.ts) - Interrupt and redirect agent

Run examples with:

```bash
npx tsx examples/basic-usage.ts
```

## Type Exports

The library exports all necessary types:

```typescript
import {
  // Core classes
  AgentFactory,
  AgentHandle,
  Session,

  // Configuration types
  type AgentConfig,
  type SpawnOptions,
  type SessionOptions,
  type PermissionMode,

  // Session update types
  type SessionUpdate,
  type ExtendedSessionUpdate,
  type PermissionRequestUpdate,

  // Content types
  type ContentBlock,
  type TextContent,
  type ImageContent,

  // Tool types
  type ToolCall,
  type ToolCallUpdate,

  // Permission types
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from "acp-factory";
```

## License

MIT
