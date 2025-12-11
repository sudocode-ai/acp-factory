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
   * Set the session mode
   */
  async setMode(mode: string): Promise<void> {
    if (!this.connection.setSessionMode) {
      throw new Error("Agent does not support setting session mode");
    }
    await this.connection.setSessionMode({
      sessionId: this.id,
      mode,
    });
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
