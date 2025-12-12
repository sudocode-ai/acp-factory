/**
 * Session - High-level interface for interacting with an agent session
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { PromptContent, ExtendedSessionUpdate } from "./types.js";
import type { ACPClientHandler } from "./client-handler.js";

/**
 * Represents an active session with an agent
 */
export class Session {
  readonly id: string;
  readonly modes: string[];
  readonly models: string[];

  private readonly connection: acp.ClientSideConnection;
  private readonly clientHandler: ACPClientHandler;

  constructor(
    id: string,
    connection: acp.ClientSideConnection,
    clientHandler: ACPClientHandler,
    modes: string[] = [],
    models: string[] = []
  ) {
    this.id = id;
    this.connection = connection;
    this.clientHandler = clientHandler;
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
      // Ensure stream is ended
      this.clientHandler.endSessionStream(this.id);
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
    if (!this.connection.forkSession) {
      throw new Error("Agent does not support forking sessions");
    }

    const result = await this.connection.forkSession({
      sessionId: this.id,
    });

    return new Session(
      result.sessionId,
      this.connection,
      this.clientHandler,
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
}
