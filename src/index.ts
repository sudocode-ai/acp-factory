/**
 * acp-factory - A library for spawning and managing agents through ACP
 */

// Core exports
export { AgentFactory } from "./factory.js";
export { AgentHandle } from "./agent-handle.js";
export { Session } from "./session.js";
export { Pushable } from "./client-handler.js";

// Library type exports
export type {
  AgentConfig,
  SpawnOptions,
  SessionOptions,
  PermissionMode,
  ClientHandlers,
  PromptContent,
} from "./types.js";

// Re-export ACP types - Core
export type {
  SessionUpdate,
  ContentBlock,
  TextContent,
  ImageContent,
  ResourceLink,
  AgentCapabilities,
  StopReason,
} from "./types.js";

// Re-export ACP types - Tools
export type {
  ToolCall,
  ToolCallUpdate,
  ToolCallStatus,
  ToolCallContent,
  ToolCallLocation,
} from "./types.js";

// Re-export ACP types - Permissions
export type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  PermissionOption,
} from "./types.js";

// Interactive permission types
export type {
  PermissionRequestUpdate,
  ExtendedSessionUpdate,
} from "./types.js";

// Session flush and fork types
export type {
  FlushOptions,
  FlushResult,
  ForkSessionOptions,
} from "./types.js";

// Re-export ACP types - Terminals
export type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
} from "./types.js";

// Re-export ACP types - MCP
export type {
  McpServer,
  McpServerStdio,
  McpServerHttp,
  McpServerSse,
} from "./types.js";

// Re-export ACP types - Session responses
export type {
  NewSessionResponse,
  PromptResponse,
  InitializeRequest,
  InitializeResponse,
  ForkSessionRequest,
  ForkSessionResponse,
} from "./types.js";
