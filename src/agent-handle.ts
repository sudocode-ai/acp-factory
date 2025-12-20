/**
 * AgentHandle - Represents a running agent with an ACP connection
 */

import { spawn, type ChildProcess } from "node:child_process";
import { Writable, Readable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentConfig, SpawnOptions, SessionOptions, ForkSessionOptions } from "./types.js";
import type { AgentCapabilities } from "@agentclientprotocol/sdk";
import { Session } from "./session.js";
import { ACPClientHandler } from "./client-handler.js";

/**
 * Handle to a running agent process with ACP connection
 */
export class AgentHandle {
  readonly capabilities: AgentCapabilities;

  /**
   * Map of session IDs to Session objects for tracking active sessions.
   * Used for smart fork detection to determine if a session is processing.
   */
  private readonly sessions: Map<string, Session> = new Map();

  private constructor(
    private readonly process: ChildProcess,
    private readonly connection: acp.ClientSideConnection,
    private readonly clientHandler: ACPClientHandler,
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
    // 1. Spawn subprocess
    const env = {
      ...process.env,
      ...config.env,
      ...options.env,
    };

    const agentProcess = spawn(config.command, config.args, {
      stdio: ["pipe", "pipe", "inherit"],
      env,
    });

    // Handle process errors
    agentProcess.on("error", (err) => {
      console.error(`Agent process error: ${err.message}`);
    });

    // 2. Set up NDJSON streams
    if (!agentProcess.stdin || !agentProcess.stdout) {
      agentProcess.kill();
      throw new Error("Failed to get agent process stdio streams");
    }

    const input = Writable.toWeb(agentProcess.stdin);
    const output = Readable.toWeb(agentProcess.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);

    // 3. Create client handler and connection
    const clientHandler = new ACPClientHandler(
      {
        onPermissionRequest: options.onPermissionRequest,
        onFileRead: options.onFileRead,
        onFileWrite: options.onFileWrite,
        onTerminalCreate: options.onTerminalCreate,
        onTerminalOutput: options.onTerminalOutput,
        onTerminalKill: options.onTerminalKill,
        onTerminalRelease: options.onTerminalRelease,
        onTerminalWaitForExit: options.onTerminalWaitForExit,
      },
      options.permissionMode ?? "auto-approve"
    );

    const connection = new acp.ClientSideConnection(
      () => clientHandler,
      stream
    );

    // 4. Initialize connection
    try {
      const initResult = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: !!(
            options.onTerminalCreate &&
            options.onTerminalOutput &&
            options.onTerminalKill &&
            options.onTerminalRelease &&
            options.onTerminalWaitForExit
          ),
        },
      });

      return new AgentHandle(
        agentProcess,
        connection,
        clientHandler,
        initResult.agentCapabilities ?? {}
      );
    } catch (error) {
      agentProcess.kill();
      throw error;
    }
  }

  /**
   * Create a new session with the agent
   */
  async createSession(
    cwd: string,
    options: SessionOptions = {}
  ): Promise<Session> {
    const result = await this.connection.newSession({
      cwd,
      mcpServers: options.mcpServers ?? [],
    });

    // Set mode if specified
    if (options.mode && this.connection.setSessionMode) {
      await this.connection.setSessionMode({
        sessionId: result.sessionId,
        modeId: options.mode,
      });
    }

    const session = new Session(
      result.sessionId,
      this.connection,
      this.clientHandler,
      cwd,
      result.modes?.availableModes?.map((m: { id: string }) => m.id) ?? [],
      result.models?.availableModels?.map((m: { modelId: string }) => m.modelId) ?? []
    );

    // Track session for smart fork detection
    this.sessions.set(result.sessionId, session);

    return session;
  }

  /**
   * Load an existing session by ID
   */
  async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers: Array<{ name: string; uri: string }> = []
  ): Promise<Session> {
    if (!this.capabilities.loadSession) {
      throw new Error("Agent does not support loading sessions");
    }

    const result = await this.connection.loadSession({
      sessionId,
      cwd,
      mcpServers,
    });

    const session = new Session(
      sessionId,
      this.connection,
      this.clientHandler,
      cwd,
      result.modes?.availableModes?.map((m: { id: string }) => m.id) ?? [],
      result.models?.availableModels?.map((m: { modelId: string }) => m.modelId) ?? []
    );

    // Track session for smart fork detection
    this.sessions.set(sessionId, session);

    return session;
  }

  /**
   * Fork an existing session to create a new independent session
   *
   * The forked session inherits the conversation history from the original,
   * allowing operations without affecting the original session's state.
   *
   * This method uses smart detection to determine the best forking approach:
   * - If the source session is actively processing or not persisted, uses forkWithFlush
   * - If the source session is idle and persisted, uses direct fork
   * - Use `forceFlush: true` to always use the flush approach
   *
   * @param sessionId - The ID of the session to fork
   * @param cwd - The current working directory for the forked session
   * @param options - Optional fork configuration
   * @experimental This relies on the unstable session/fork ACP capability
   */
  async forkSession(
    sessionId: string,
    cwd: string,
    options: ForkSessionOptions = {}
  ): Promise<Session> {
    if (!this.capabilities.sessionCapabilities?.fork) {
      throw new Error("Agent does not support forking sessions");
    }

    const sourceSession = this.sessions.get(sessionId);

    // Determine if flush is needed:
    // 1. forceFlush option is set
    // 2. Source session is currently processing
    // 3. Source session is not tracked (might be from previous process, needs flush to ensure persistence)
    const needsFlush = options.forceFlush ||
      (sourceSession && sourceSession.isProcessing) ||
      !sourceSession;

    if (needsFlush && sourceSession) {
      // Use forkWithFlush for active or processing sessions
      const forkedSession = await sourceSession.forkWithFlush({
        idleTimeout: options.idleTimeout,
        persistTimeout: options.persistTimeout,
      });

      // Track the forked session
      this.sessions.set(forkedSession.id, forkedSession);

      return forkedSession;
    }

    // Direct fork for persisted idle sessions (or when source session is unknown)
    const result = await this.connection.unstable_forkSession({
      sessionId,
      cwd,
    });

    const forkedSession = new Session(
      result.sessionId,
      this.connection,
      this.clientHandler,
      cwd,
      result.modes?.availableModes?.map((m: { id: string }) => m.id) ?? [],
      result.models?.availableModels?.map((m: { modelId: string }) => m.modelId) ?? []
    );

    // Track the forked session
    this.sessions.set(result.sessionId, forkedSession);

    return forkedSession;
  }

  /**
   * Close the agent connection and terminate the process
   */
  async close(): Promise<void> {
    this.process.kill();
    // Wait for the connection to close
    await this.connection.closed;
  }

  /**
   * Get the underlying connection (for advanced use)
   */
  getConnection(): acp.ClientSideConnection {
    return this.connection;
  }

  /**
   * Check if the agent process is still running
   */
  isRunning(): boolean {
    return !this.process.killed && this.process.exitCode === null;
  }
}
