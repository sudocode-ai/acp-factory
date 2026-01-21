/**
 * Type definitions for acp-factory
 */

import type * as acp from "@agentclientprotocol/sdk";

// ============================================================================
// Re-exported ACP Types
// ============================================================================

// Core session types
export type {
  /** Updates streamed during prompt processing */
  SessionUpdate,
  /** Content blocks in prompts and responses */
  ContentBlock,
  /** Text content block */
  TextContent,
  /** Image content block */
  ImageContent,
  /** Resource link content block */
  ResourceLink,
  /** Agent capabilities advertised during initialization */
  AgentCapabilities,
  /** Reason why prompt processing stopped */
  StopReason,
} from "@agentclientprotocol/sdk";

// Tool-related types
export type {
  /** A tool call initiated by the agent */
  ToolCall,
  /** Update to a tool call's status or content */
  ToolCallUpdate,
  /** Status of a tool call */
  ToolCallStatus,
  /** Content returned by a tool */
  ToolCallContent,
  /** Location affected by a tool call */
  ToolCallLocation,
} from "@agentclientprotocol/sdk";

// Permission types
export type {
  /** Request for user permission */
  RequestPermissionRequest,
  /** Response to permission request */
  RequestPermissionResponse,
  /** A permission option presented to the user */
  PermissionOption,
} from "@agentclientprotocol/sdk";

// Terminal types
export type {
  /** Request to create a terminal */
  CreateTerminalRequest,
  /** Response with terminal ID */
  CreateTerminalResponse,
  /** Request for terminal output */
  TerminalOutputRequest,
  /** Response with terminal output */
  TerminalOutputResponse,
} from "@agentclientprotocol/sdk";

// MCP server configuration
export type {
  /** MCP server configuration (stdio, HTTP, or SSE) */
  McpServer,
  /** MCP server over stdio */
  McpServerStdio,
  /** MCP server over HTTP */
  McpServerHttp,
  /** MCP server over SSE */
  McpServerSse,
} from "@agentclientprotocol/sdk";

// Session response types
export type {
  /** Response when creating a new session */
  NewSessionResponse,
  /** Response after prompt processing completes */
  PromptResponse,
  /** Request to initialize the connection */
  InitializeRequest,
  /** Response to initialization */
  InitializeResponse,
  /** Request to fork an existing session (UNSTABLE) */
  ForkSessionRequest,
  /** Response from forking a session (UNSTABLE) */
  ForkSessionResponse,
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
 * - "auto-approve": Automatically approve all permission requests
 * - "auto-deny": Automatically deny all permission requests
 * - "callback": Use the onPermissionRequest callback handler
 * - "interactive": Emit permission requests as session updates for UI handling
 */
export type PermissionMode = "auto-approve" | "auto-deny" | "callback" | "interactive";

/**
 * A permission request emitted as a session update (for interactive mode)
 */
export interface PermissionRequestUpdate {
  sessionUpdate: "permission_request";
  /** Unique ID for this permission request (use to respond) */
  requestId: string;
  /** Session this request belongs to */
  sessionId: string;
  /** The tool call that triggered this permission request */
  toolCall: {
    toolCallId: string;
    title: string;
    status: string;
    rawInput?: unknown;
  };
  /** Available options for the user to choose from */
  options: acp.PermissionOption[];
}

/**
 * Emitted when context compaction starts.
 * This can be triggered automatically (when token threshold is exceeded) or manually.
 */
export interface CompactionStartedUpdate {
  sessionUpdate: "compaction_started";
  /** Session where compaction is occurring */
  sessionId: string;
  /** What triggered the compaction */
  trigger: "auto" | "manual";
  /** Token count before compaction */
  preTokens: number;
  /** Token threshold that triggered auto-compaction (only for auto trigger) */
  threshold?: number;
}

/**
 * Emitted when context compaction completes.
 */
export interface CompactionCompletedUpdate {
  sessionUpdate: "compaction_completed";
  /** Session where compaction occurred */
  sessionId: string;
  /** What triggered the compaction */
  trigger: "auto" | "manual";
  /** Token count before compaction */
  preTokens: number;
}

/**
 * Union type for all compaction-related updates
 */
export type CompactionUpdate = CompactionStartedUpdate | CompactionCompletedUpdate;

/**
 * Extended session update type that includes permission requests and compaction events
 */
export type ExtendedSessionUpdate = acp.SessionUpdate | PermissionRequestUpdate | CompactionUpdate;

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
 * Configuration for automatic context compaction.
 * When enabled, the session will automatically trigger compaction when token usage exceeds the threshold.
 */
export interface CompactionConfig {
  /**
   * Whether automatic compaction is enabled.
   * @default false
   */
  enabled: boolean;

  /**
   * Token threshold that triggers automatic compaction.
   * When the total token count exceeds this value, a /compact command is automatically sent.
   * @default 100000
   */
  contextTokenThreshold?: number;

  /**
   * Optional custom instructions for the compaction summary.
   * These instructions guide how the agent summarizes the conversation.
   */
  customInstructions?: string;
}

/**
 * Agent-specific metadata passed to the agent when creating a session.
 * This is passed through as `_meta` in the ACP NewSessionRequest.
 */
export interface AgentMeta {
  /**
   * Claude Code specific configuration
   */
  claudeCode?: {
    /**
     * Configuration for automatic context compaction
     */
    compaction?: CompactionConfig;

    /**
     * Additional options passed to Claude Code SDK.
     * See claude-code-acp documentation for available options.
     */
    options?: Record<string, unknown>;
  };

  /**
   * Allow additional agent-specific metadata
   */
  [key: string]: unknown;
}

/**
 * Options for creating a session
 */
export interface SessionOptions {
  /** MCP servers to connect */
  mcpServers?: acp.McpServer[];
  /** Initial mode for the session */
  mode?: string;
  /**
   * Agent-specific metadata passed through as `_meta` in the ACP protocol.
   * Use this for agent-specific configuration like compaction settings.
   */
  agentMeta?: AgentMeta;
}

/**
 * Content that can be sent as a prompt
 */
export type PromptContent = string | acp.ContentBlock[];

/**
 * Options for flushing a session to disk
 */
export interface FlushOptions {
  /** Maximum time to wait for session to become idle (default: 5000ms) */
  idleTimeout?: number;
  /** Maximum time to wait for disk persistence (default: 5000ms) */
  persistTimeout?: number;
}

/**
 * Result of a session flush operation
 */
export interface FlushResult {
  /** Whether the flush succeeded */
  success: boolean;
  /** Path to the session file (if successful) */
  filePath?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Options for forking a session
 */
export interface ForkSessionOptions {
  /**
   * Force using flush-based forking even if the session appears idle.
   * Use this when you want to ensure the session is definitely persisted
   * before forking, regardless of its current state.
   */
  forceFlush?: boolean;
  /**
   * Maximum time to wait for session to become idle (default: 5000ms).
   * Only applicable when flush is needed.
   */
  idleTimeout?: number;
  /**
   * Maximum time to wait for disk persistence (default: 5000ms).
   * Only applicable when flush is needed.
   */
  persistTimeout?: number;
}

/**
 * Result of a session inject operation
 */
export interface InjectResult {
  /** Whether the inject succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
}
