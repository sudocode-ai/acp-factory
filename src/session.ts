/**
 * Session - High-level interface for interacting with an agent session
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { PromptContent } from "./types.js";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
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
   */
  async *prompt(content: PromptContent): AsyncIterable<SessionUpdate> {
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
}
