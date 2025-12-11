/**
 * Session - High-level interface for interacting with an agent session
 */

import type { PromptContent } from "./types.js";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

/**
 * Represents an active session with an agent
 */
export class Session {
  readonly id: string;
  readonly modes: string[];
  readonly models: string[];

  constructor(
    id: string,
    modes: string[] = [],
    models: string[] = []
  ) {
    this.id = id;
    this.modes = modes;
    this.models = models;
  }

  /**
   * Send a prompt and stream responses
   */
  async *prompt(content: PromptContent): AsyncIterable<SessionUpdate> {
    // TODO: Implement in i-90yy
    // 1. Convert content to ContentBlock[] if string
    // 2. Call connection.prompt()
    // 3. Yield session updates from async iterator
    throw new Error("Not implemented - see issue i-90yy");
  }

  /**
   * Cancel the current prompt
   */
  async cancel(): Promise<void> {
    // TODO: Implement in i-90yy
    throw new Error("Not implemented - see issue i-90yy");
  }

  /**
   * Set the session mode
   */
  async setMode(mode: string): Promise<void> {
    // TODO: Implement in i-90yy
    throw new Error("Not implemented - see issue i-90yy");
  }
}
