/**
 * acp-factory - A library for spawning and managing agents through ACP
 */

// Core exports
export { AgentFactory } from "./factory.js";
export { AgentHandle } from "./agent-handle.js";
export { Session } from "./session.js";

// Type exports
export type {
  AgentConfig,
  SpawnOptions,
  SessionOptions,
  PermissionMode,
  ClientHandlers,
} from "./types.js";

// Re-export useful ACP types
export type {
  SessionUpdate,
  ContentBlock,
  AgentCapabilities,
  ToolCall,
  ToolCallUpdate,
} from "./types.js";
