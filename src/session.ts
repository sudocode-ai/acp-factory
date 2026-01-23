/**
 * Session - High-level interface for interacting with an agent session
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type * as acp from "@agentclientprotocol/sdk";
import type { PromptContent, ExtendedSessionUpdate, FlushOptions, FlushResult, InjectResult, CompactionConfig } from "./types.js";
import type { ACPClientHandler } from "./client-handler.js";

/**
 * Represents an active session with an agent
 */
export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly modes: string[];
  readonly models: string[];

  private readonly connection: acp.ClientSideConnection;
  private readonly clientHandler: ACPClientHandler;

  /**
   * Whether the session is currently processing a prompt
   * @internal
   */
  isProcessing: boolean = false;

  /**
   * Cached result of inject support check.
   * - undefined: not yet checked
   * - true: inject is supported
   * - false: inject is not supported
   * @internal
   */
  private _injectSupported: boolean | undefined = undefined;

  constructor(
    id: string,
    connection: acp.ClientSideConnection,
    clientHandler: ACPClientHandler,
    cwd: string,
    modes: string[] = [],
    models: string[] = []
  ) {
    this.id = id;
    this.connection = connection;
    this.clientHandler = clientHandler;
    this.cwd = cwd;
    this.modes = modes;
    this.models = models;
  }

  /**
   * Send a prompt and stream responses
   *
   * In interactive permission mode, this may yield PermissionRequestUpdate objects
   * that require a response via respondToPermission() before the prompt can continue.
   */
  async *prompt(content: PromptContent): AsyncIterable<ExtendedSessionUpdate> {
    // Mark session as processing
    this.isProcessing = true;

    // Convert string to ContentBlock array
    const promptBlocks: acp.ContentBlock[] =
      typeof content === "string"
        ? [{ type: "text", text: content }]
        : content;

    // Get the session stream for updates
    const stream = this.clientHandler.getSessionStream(this.id);

    // Start the prompt (non-blocking, returns when complete)
    const promptPromise = this.connection.prompt({
      sessionId: this.id,
      prompt: promptBlocks,
    });

    // Yield updates as they arrive
    // We need to race between getting updates and the prompt completing
    const updateIterator = stream[Symbol.asyncIterator]();

    try {
      while (true) {
        // Check if prompt has completed
        const raceResult = await Promise.race([
          promptPromise.then((result) => ({ type: "done" as const, result })),
          updateIterator.next().then((update) => ({ type: "update" as const, update })),
        ]);

        if (raceResult.type === "done") {
          // Prompt completed, drain remaining updates
          this.clientHandler.endSessionStream(this.id);

          // Yield any remaining queued updates
          let remaining = await updateIterator.next();
          while (!remaining.done) {
            yield remaining.value;
            remaining = await updateIterator.next();
          }
          break;
        } else {
          // Got an update
          if (raceResult.update.done) {
            break;
          }
          yield raceResult.update.value;
        }
      }
    } finally {
      // Ensure stream is ended and mark session as idle
      this.clientHandler.endSessionStream(this.id);
      this.isProcessing = false;
    }
  }

  /**
   * Cancel the current prompt
   */
  async cancel(): Promise<void> {
    await this.connection.cancel({
      sessionId: this.id,
    });
  }

  /**
   * Interrupt the current prompt and start a new one with additional context.
   *
   * This cancels any in-progress prompt and immediately starts a new prompt.
   * The agent will restart its work but retains the conversation history.
   *
   * Use this when you need to redirect or add context to the agent's work.
   *
   * @param content - The new prompt content (can reference or build upon previous context)
   * @returns AsyncIterable of session updates for the new prompt
   *
   * @example
   * ```typescript
   * // Original prompt running
   * for await (const update of session.prompt("Analyze the codebase")) {
   *   handleUpdate(update);
   *   if (userWantsToRedirect) {
   *     // Interrupt and redirect
   *     for await (const update of session.interruptWith("Focus only on the /src directory")) {
   *       handleUpdate(update);
   *     }
   *     break;
   *   }
   * }
   * ```
   */
  async *interruptWith(content: PromptContent): AsyncIterable<ExtendedSessionUpdate> {
    // Cancel any in-progress prompt
    await this.cancel();

    // Small delay to allow cancellation to propagate
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Start new prompt and yield its updates
    yield* this.prompt(content);
  }

  /**
   * Add context to the agent while it's working (without interrupting).
   *
   * NOTE: This feature requires agent support for mid-execution messaging.
   * Currently, claude-code-acp does not support this. When called, this method
   * will throw an error. Use `interruptWith()` as an alternative.
   *
   * In the future, when agent adapters support the `_session/addContext` extension,
   * this method will push context to the agent without cancelling current work.
   *
   * @param content - Additional context to send to the agent
   * @throws Error - Always throws until agent support is available
   *
   * @example
   * ```typescript
   * // Future usage (not yet supported):
   * for await (const update of session.prompt("Analyze the codebase")) {
   *   handleUpdate(update);
   *   if (userHasAdditionalContext) {
   *     // Add context without interrupting (future)
   *     await session.addContext("Also check the test coverage");
   *   }
   * }
   * ```
   */
  async addContext(_content: PromptContent): Promise<void> {
    // TODO: When claude-code-acp supports _session/addContext extension,
    // implement this using:
    // await this.connection.extMethod("session/addContext", {
    //   sessionId: this.id,
    //   content: typeof _content === "string"
    //     ? [{ type: "text", text: _content }]
    //     : _content,
    // });

    throw new Error(
      "addContext() is not yet supported. The agent adapter must implement the " +
      "'_session/addContext' extension method. Use interruptWith() as an alternative, " +
      "which cancels the current prompt and starts a new one."
    );
  }

  /**
   * Inject a message into the session for processing in the next turn.
   *
   * This method queues a message that will be processed when the next prompt()
   * call is made. Unlike addContext(), the injected message is not processed
   * immediately during the current turn - it becomes part of the next turn's input.
   *
   * Use cases:
   * - Queuing clarifications or corrections while the agent is working
   * - Adding context that should influence the next interaction
   * - Providing additional instructions between prompt calls
   *
   * NOTE: This feature requires agent support for the `_session/inject` extension method.
   * Check `supportsInject()` or handle the error result to detect unsupported agents.
   *
   * @param content - The message to inject (string or ContentBlock array)
   * @param options - Optional configuration
   * @param options.throwOnUnsupported - If true, throws an error when agent doesn't support inject (default: false)
   * @returns Object with success status and optional error message
   *
   * @example
   * ```typescript
   * // While agent is processing a prompt
   * for await (const update of session.prompt("Analyze the codebase")) {
   *   handleUpdate(update);
   *   if (userHasClarification) {
   *     // Queue a message for the next turn
   *     await session.inject("Focus on TypeScript files only");
   *   }
   * }
   *
   * // The injected message will be processed in the next prompt
   * for await (const update of session.prompt("Continue analysis")) {
   *   // Agent will see the injected message here
   *   handleUpdate(update);
   * }
   * ```
   */
  async inject(
    content: PromptContent,
    options: { throwOnUnsupported?: boolean } = {}
  ): Promise<InjectResult> {
    const { throwOnUnsupported = false } = options;

    // Check if the connection has extMethod capability
    const connection = this.connection as unknown as {
      extMethod?: (method: string, params: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
    };

    if (!connection.extMethod) {
      this._injectSupported = false;
      const error = "Agent does not support extension methods required for inject.";
      if (throwOnUnsupported) {
        throw new Error(error);
      }
      return { success: false, error };
    }

    try {
      // Convert string to ContentBlock array if needed
      const message: acp.ContentBlock[] =
        typeof content === "string"
          ? [{ type: "text", text: content }]
          : content;

      // Call the agent's _session/inject extension method
      // Note: extMethod adds the `_` prefix, so we pass "session/inject"
      const result = await connection.extMethod("session/inject", {
        sessionId: this.id,
        message,
      });

      // Cache the result - inject is supported if we got a successful result
      if (result.success) {
        this._injectSupported = true;
      }

      return result;
    } catch (error) {
      const errorMessage = String(error);

      // Check for "method not found" errors and provide a clearer message
      if (errorMessage.includes("not found") || errorMessage.includes("not supported") || errorMessage.includes("Method not found")) {
        this._injectSupported = false;
        const friendlyError = "Agent does not support the inject feature.";
        if (throwOnUnsupported) {
          throw new Error(friendlyError);
        }
        return { success: false, error: friendlyError };
      }

      return {
        success: false,
        error: `Failed to inject message: ${errorMessage}`,
      };
    }
  }

  /**
   * Check if this session's agent supports the inject feature.
   *
   * This method returns:
   * - `false` if the agent definitely doesn't support inject (no extMethod or previously failed)
   * - `true` if inject has been verified to work, or if extMethod exists but hasn't been tested yet
   *
   * For a definitive check, use `checkInjectSupport()` which actually probes the agent.
   *
   * @returns true if the agent may support inject, false if definitely not supported
   */
  supportsInject(): boolean {
    // If we've already verified, return the cached result
    if (this._injectSupported !== undefined) {
      return this._injectSupported;
    }

    // Otherwise, check if extMethod exists (necessary but not sufficient)
    const connection = this.connection as unknown as { extMethod?: unknown };
    return typeof connection.extMethod === "function";
  }

  /**
   * Check if this session's agent supports the inject feature by probing the agent.
   *
   * This method sends a no-op inject request to verify the agent actually implements
   * the `_session/inject` extension method. The result is cached for subsequent calls.
   *
   * Use this for a definitive check before relying on inject functionality.
   *
   * @returns true if the agent supports inject, false otherwise
   *
   * @example
   * ```typescript
   * const hasInject = await session.checkInjectSupport();
   * if (hasInject) {
   *   await session.inject("Additional context");
   * } else {
   *   // Fall back to interruptWith or handle differently
   *   await session.interruptWith("New prompt with context");
   * }
   * ```
   */
  async checkInjectSupport(): Promise<boolean> {
    // Return cached result if available
    if (this._injectSupported !== undefined) {
      return this._injectSupported;
    }

    // Check if extMethod exists first
    const connection = this.connection as unknown as {
      extMethod?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>
    };

    if (!connection.extMethod) {
      this._injectSupported = false;
      return false;
    }

    // Probe the agent with an empty message to check if the method exists
    // This is a lightweight check that shouldn't have side effects
    // Note: extMethod adds the `_` prefix, so we pass "session/inject"
    try {
      const result = await connection.extMethod("session/inject", {
        sessionId: this.id,
        message: [], // Empty message array - no-op
      });

      // If we get a result (success or not), the method exists
      this._injectSupported = result.success === true || !String(result.error || "").includes("not found");
      return this._injectSupported;
    } catch (error) {
      const errorMessage = String(error);
      // Method not found errors indicate inject is not supported
      if (errorMessage.includes("not found") || errorMessage.includes("not supported") || errorMessage.includes("Method not found")) {
        this._injectSupported = false;
        return false;
      }
      // Other errors (network, etc.) - don't cache, let caller retry
      return false;
    }
  }

  /**
   * Set the session mode
   */
  async setMode(mode: string): Promise<void> {
    if (!this.connection.setSessionMode) {
      throw new Error("Agent does not support setting session mode");
    }
    await this.connection.setSessionMode({
      sessionId: this.id,
      modeId: mode,
    });
  }

  /**
   * Configure automatic context compaction for this session.
   *
   * When enabled, the session will automatically trigger compaction when token usage
   * exceeds the configured threshold. This helps manage context window limits during
   * long-running conversations.
   *
   * @param config - Compaction configuration
   * @param config.enabled - Whether automatic compaction is enabled
   * @param config.contextTokenThreshold - Token count that triggers compaction (default: 100000)
   * @param config.customInstructions - Optional instructions for the compaction summary
   *
   * @throws Error if the agent does not support compaction configuration
   *
   * @example
   * ```typescript
   * // Enable auto-compaction with custom threshold
   * await session.setCompaction({
   *   enabled: true,
   *   contextTokenThreshold: 50000,
   *   customInstructions: "Focus on code changes and key decisions"
   * });
   *
   * // Disable auto-compaction
   * await session.setCompaction({ enabled: false });
   * ```
   */
  async setCompaction(config: CompactionConfig): Promise<void> {
    // Check if the connection has extMethod capability
    const connection = this.connection as unknown as {
      extMethod?: (
        method: string,
        params: Record<string, unknown>
      ) => Promise<{ success: boolean; error?: string }>;
    };

    if (!connection.extMethod) {
      throw new Error(
        "Agent does not support extension methods required for compaction configuration."
      );
    }

    let result: { success: boolean; error?: string };
    // Note: extMethod adds the `_` prefix, so we pass "session/setCompaction"
    try {
      result = await connection.extMethod("session/setCompaction", {
        sessionId: this.id,
        enabled: config.enabled,
        contextTokenThreshold: config.contextTokenThreshold,
        customInstructions: config.customInstructions,
      });
    } catch (error) {
      const errorMessage = String(error);

      // Check for "method not found" errors and provide a clearer message
      if (
        errorMessage.includes("Method not found") ||
        errorMessage.includes("not supported")
      ) {
        throw new Error("Agent does not support compaction configuration.");
      }

      throw error;
    }

    // Handle error response from the agent (outside try-catch to avoid false positives)
    if (!result.success) {
      throw new Error(result.error ?? "Failed to set compaction configuration");
    }
  }

  /**
   * Fork this session to create a new independent session
   *
   * The forked session inherits the conversation history, allowing
   * operations like generating summaries without affecting this session.
   *
   * Note: This creates a new Session object - the original session
   * remains active and can continue independently.
   *
   * @experimental This relies on the unstable session/fork ACP capability
   */
  async fork(): Promise<Session> {
    if (!this.connection.unstable_forkSession) {
      throw new Error("Agent does not support forking sessions");
    }

    const result = await this.connection.unstable_forkSession({
      sessionId: this.id,
      cwd: this.cwd,
    });

    return new Session(
      result.sessionId,
      this.connection,
      this.clientHandler,
      this.cwd,
      result.modes?.availableModes?.map((m: { id: string }) => m.id) ?? [],
      result.models?.availableModels?.map((m: { modelId: string }) => m.modelId) ?? []
    );
  }

  /**
   * Fork a running session by flushing it to disk first
   *
   * This method handles forking a session that is currently active by:
   * 1. Waiting for the session to become idle (up to idleTimeout)
   * 2. If still processing after timeout, interrupting gracefully
   * 3. Calling the agent's flush extension to trigger disk persistence
   * 4. Waiting for the session file to appear on disk
   * 5. Restarting the original session so it can continue
   * 6. Creating the forked session using the persisted data
   *
   * Use this when you need to fork a session that may be actively processing.
   * For idle sessions where you know the data is already persisted, use fork() directly.
   *
   * @param options - Optional timeout configuration
   * @param options.idleTimeout - Max time to wait for session to become idle (default: 5000ms)
   * @param options.persistTimeout - Max time to wait for disk persistence (default: 5000ms)
   * @returns A new Session object representing the forked session
   * @throws Error if the session cannot be persisted or forked
   *
   * @example
   * ```typescript
   * // Fork a potentially active session
   * const forkedSession = await session.forkWithFlush();
   * // Original session continues working, forked session has full context
   * ```
   *
   * @experimental This relies on the unstable session/fork ACP capability
   */
  async forkWithFlush(options: FlushOptions = {}): Promise<Session> {
    const { idleTimeout = 5000, persistTimeout = 5000 } = options;

    if (!this.connection.unstable_forkSession) {
      throw new Error("Agent does not support forking sessions");
    }

    // Step 1: Wait for idle or interrupt
    const becameIdle = await this.waitForIdle(idleTimeout);
    if (!becameIdle && this.isProcessing) {
      // Interrupt current operation gracefully
      await this.cancel();
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Step 2: Call the agent's flush extension method to trigger persistence
    // The agent handles waiting for persistence internally
    // Note: extMethod adds the `_` prefix, so we pass "session/flush"
    const flushResult = await (this.connection as unknown as { extMethod: (method: string, params: Record<string, unknown>) => Promise<{ success: boolean; filePath?: string; error?: string }> })
      .extMethod("session/flush", {
        sessionId: this.id,
        idleTimeout,
        persistTimeout,
      });

    // Check if the agent reported success
    if (!flushResult.success) {
      throw new Error(flushResult.error ?? `Failed to persist session ${this.id} to disk`);
    }

    // Step 3: Restart original session so it can continue working
    await this.restartSession();

    // Step 4: Create forked session using existing fork logic
    const result = await this.connection.unstable_forkSession({
      sessionId: this.id,
      cwd: this.cwd,
    });

    return new Session(
      result.sessionId,
      this.connection,
      this.clientHandler,
      this.cwd,
      result.modes?.availableModes?.map((m: { id: string }) => m.id) ?? [],
      result.models?.availableModels?.map((m: { modelId: string }) => m.modelId) ?? []
    );
  }

  /**
   * Respond to a permission request (for interactive permission mode)
   *
   * When using permissionMode: "interactive", permission requests are emitted
   * as session updates with sessionUpdate: "permission_request". Call this method
   * with the requestId and your chosen optionId to allow the prompt to continue.
   *
   * @param requestId - The requestId from the PermissionRequestUpdate
   * @param optionId - The optionId of the selected permission option
   */
  respondToPermission(requestId: string, optionId: string): void {
    this.clientHandler.respondToPermission(requestId, optionId);
  }

  /**
   * Cancel a permission request (for interactive permission mode)
   *
   * This will cancel the permission request, which typically aborts the tool call.
   *
   * @param requestId - The requestId from the PermissionRequestUpdate
   */
  cancelPermission(requestId: string): void {
    this.clientHandler.cancelPermission(requestId);
  }

  /**
   * Check if there are any pending permission requests for this session
   */
  hasPendingPermissions(): boolean {
    return this.clientHandler.getPendingPermissionIds(this.id).length > 0;
  }

  /**
   * Get all pending permission request IDs for this session
   */
  getPendingPermissionIds(): string[] {
    return this.clientHandler.getPendingPermissionIds(this.id);
  }

  /**
   * Get the file path where Claude Code stores session data
   *
   * Claude Code stores sessions at:
   * ~/.claude/projects/<cwd-hash>/<sessionId>.jsonl
   *
   * Where <cwd-hash> is the cwd with `/` replaced by `-`
   * (e.g., `/private/tmp` → `-private-tmp`)
   *
   * @param sessionId - The session ID to get the file path for
   * @returns The absolute path to the session file
   * @internal
   * @deprecated This method is Claude Code specific. The agent now returns
   * the file path in the flush response. This method may be removed in a future version.
   */
  getSessionFilePath(sessionId: string): string {
    // Resolve the real path to handle macOS symlinks like /var -> /private/var
    // Claude Code uses the resolved path internally
    const realCwd = fs.realpathSync(this.cwd);
    // Claude Code replaces both / and _ with - in the cwd hash
    const cwdHash = realCwd.replace(/[/_]/g, "-");
    return path.join(os.homedir(), ".claude", "projects", cwdHash, `${sessionId}.jsonl`);
  }

  /**
   * Wait for session data to be persisted to disk
   *
   * Polls for the session file existence every 100ms until the file appears
   * or the timeout expires.
   *
   * @param sessionId - The session ID to wait for
   * @param timeout - Maximum time to wait in milliseconds (default: 5000ms)
   * @returns true if file appears within timeout, false if timeout expires
   * @internal
   * @deprecated This method is Claude Code specific and relies on getSessionFilePath().
   * The agent now handles persistence verification internally. This method may be
   * removed in a future version.
   */
  async waitForPersistence(sessionId: string, timeout: number = 5000): Promise<boolean> {
    const filePath = this.getSessionFilePath(sessionId);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (fs.existsSync(filePath)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  /**
   * Wait for the session to become idle (not processing a prompt)
   *
   * Polls the session's isProcessing state every 100ms until the session
   * becomes idle or the timeout expires.
   *
   * @param timeout - Maximum time to wait in milliseconds (default: 5000ms)
   * @returns true if session becomes idle within timeout, false if timeout expires
   * @internal
   */
  async waitForIdle(timeout: number = 5000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!this.isProcessing) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  /**
   * Flush session to disk, creating a checkpoint without forking
   *
   * This method triggers persistence of the session data by:
   * 1. Waiting for the session to become idle (or timing out)
   * 2. Cancelling any in-progress work if still busy
   * 3. Calling the agent's _session/flush extension method
   * 4. Waiting for the session file to appear on disk
   * 5. Restarting the session so it can continue working
   *
   * Use this for creating checkpoints that can later be forked or restored.
   *
   * @param options - Optional timeout configuration
   * @param options.idleTimeout - Max time to wait for session to become idle (default: 5000ms)
   * @param options.persistTimeout - Max time to wait for disk persistence (default: 5000ms)
   * @returns Object with success status, file path if successful, or error message
   *
   * @example
   * ```typescript
   * const result = await session.flush();
   * if (result.success) {
   *   console.log(`Session saved to ${result.filePath}`);
   * } else {
   *   console.error(`Flush failed: ${result.error}`);
   * }
   * ```
   */
  async flush(options: FlushOptions = {}): Promise<FlushResult> {
    const { idleTimeout = 5000, persistTimeout = 5000 } = options;

    try {
      // Wait for idle or timeout
      const becameIdle = await this.waitForIdle(idleTimeout);
      if (!becameIdle && this.isProcessing) {
        // Interrupt if still busy
        await this.cancel();
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Call the agent's flush extension method to trigger persistence
      // The agent handles waiting for persistence and returns the result
      // Note: extMethod adds the `_` prefix, so we pass "session/flush"
      const flushResult = await (this.connection as unknown as { extMethod: (method: string, params: Record<string, unknown>) => Promise<{ success: boolean; filePath?: string; error?: string }> })
        .extMethod("session/flush", {
          sessionId: this.id,
          idleTimeout,
          persistTimeout,
        });

      // Check if the agent reported success
      if (!flushResult.success) {
        return { success: false, error: flushResult.error ?? "Flush failed" };
      }

      // Restart session so it can continue working
      await this.restartSession();

      return {
        success: true,
        filePath: flushResult.filePath,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Restart this session after it has been flushed to disk
   *
   * This method is used as part of the fork-with-flush mechanism. After a session
   * has been aborted to trigger disk persistence, this method restarts the session
   * by loading it from the persisted state.
   *
   * The restarted session will have the same sessionId and conversation history,
   * but with fresh internal state (new input stream, reset flags).
   *
   * @returns A new Session object representing the restarted session
   * @throws Error if the agent does not support loading sessions
   * @internal
   */
  async restartSession(): Promise<Session> {
    if (!this.connection.loadSession) {
      throw new Error("Agent does not support restarting sessions");
    }

    const result = await this.connection.loadSession({
      sessionId: this.id,
      cwd: this.cwd,
      mcpServers: [],
    });

    return new Session(
      this.id,
      this.connection,
      this.clientHandler,
      this.cwd,
      result.modes?.availableModes?.map((m: { id: string }) => m.id) ?? this.modes,
      result.models?.availableModels?.map((m: { modelId: string }) => m.modelId) ?? this.models
    );
  }
}
