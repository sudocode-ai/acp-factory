/**
 * Type definitions for acp-factory
 */

import type * as acp from "@agentclientprotocol/sdk";

// Re-export useful ACP types
export type {
  SessionUpdate,
  ContentBlock,
  AgentCapabilities,
  ToolCall,
  ToolCallUpdate,
  RequestPermissionRequest,
  RequestPermissionResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
} from "@agentclientprotocol/sdk";

/**
 * Configuration for spawning an agent
 */
export interface AgentConfig {
  /** Command to execute (e.g., "npx") */
  command: string;
  /** Arguments for the command (e.g., ["claude-code-acp"]) */
  args: string[];
  /** Environment variables to set */
  env?: Record<string, string>;
}

/**
 * Permission handling mode
 */
export type PermissionMode = "auto-approve" | "auto-deny" | "callback";

/**
 * Handlers for client-side operations
 */
export interface ClientHandlers {
  /** Handle permission requests from the agent */
  onPermissionRequest?: (
    request: acp.RequestPermissionRequest
  ) => Promise<acp.RequestPermissionResponse>;

  /** Handle file read requests */
  onFileRead?: (path: string) => Promise<string>;

  /** Handle file write requests */
  onFileWrite?: (path: string, content: string) => Promise<void>;

  /** Handle terminal creation requests */
  onTerminalCreate?: (
    params: acp.CreateTerminalRequest
  ) => Promise<acp.CreateTerminalResponse>;

  /** Handle terminal output requests */
  onTerminalOutput?: (terminalId: string) => Promise<string>;

  /** Handle terminal kill requests */
  onTerminalKill?: (terminalId: string) => Promise<void>;

  /** Handle terminal release requests */
  onTerminalRelease?: (terminalId: string) => Promise<void>;

  /** Handle terminal wait for exit requests */
  onTerminalWaitForExit?: (terminalId: string) => Promise<number>;
}

/**
 * Options for spawning an agent
 */
export interface SpawnOptions extends ClientHandlers {
  /** Environment variables to merge with agent config */
  env?: Record<string, string>;
  /** Permission handling mode (default: "auto-approve") */
  permissionMode?: PermissionMode;
}

/**
 * Options for creating a session
 */
export interface SessionOptions {
  /** MCP servers to connect */
  mcpServers?: acp.McpServer[];
  /** Initial mode for the session */
  mode?: string;
}

/**
 * Content that can be sent as a prompt
 */
export type PromptContent = string | acp.ContentBlock[];
