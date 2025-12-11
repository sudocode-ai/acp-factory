/**
 * AgentHandle - Represents a running agent with an ACP connection
 */

import type { AgentConfig, SpawnOptions, SessionOptions } from "./types.js";
import type { AgentCapabilities } from "@agentclientprotocol/sdk";
import { Session } from "./session.js";

/**
 * Handle to a running agent process with ACP connection
 */
export class AgentHandle {
  readonly capabilities: AgentCapabilities;

  private constructor(
    private readonly config: AgentConfig,
    private readonly options: SpawnOptions,
    capabilities: AgentCapabilities
  ) {
    this.capabilities = capabilities;
  }

  /**
   * Create and initialize an agent handle
   * @internal
   */
  static async create(
    config: AgentConfig,
    options: SpawnOptions
  ): Promise<AgentHandle> {
    // TODO: Implement in i-2laf
    // 1. Spawn subprocess with child_process.spawn()
    // 2. Set up NDJSON streams via acp.ndJsonStream()
    // 3. Create ClientSideConnection with ACPClientHandler
    // 4. Call initialize() and store capabilities
    throw new Error("Not implemented - see issue i-2laf");
  }

  /**
   * Create a new session with the agent
   */
  async createSession(
    cwd: string,
    options: SessionOptions = {}
  ): Promise<Session> {
    // TODO: Implement in i-2laf
    throw new Error("Not implemented - see issue i-2laf");
  }

  /**
   * Load an existing session by ID
   */
  async loadSession(sessionId: string): Promise<Session> {
    // TODO: Implement in i-2laf
    throw new Error("Not implemented - see issue i-2laf");
  }

  /**
   * Close the agent connection and terminate the process
   */
  async close(): Promise<void> {
    // TODO: Implement in i-2laf
    throw new Error("Not implemented - see issue i-2laf");
  }
}
