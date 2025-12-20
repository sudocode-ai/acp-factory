/**
 * ACPClientHandler - Implements acp.Client interface
 */

import * as fs from "node:fs/promises";
import type * as acp from "@agentclientprotocol/sdk";
import type {
  ClientHandlers,
  PermissionMode,
  PermissionRequestUpdate,
  ExtendedSessionUpdate,
} from "./types.js";

/**
 * A pushable async iterable for bridging push-based and async-iterator-based code.
 * Used to stream session updates to consumers.
 */
export class Pushable<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;

  /** Push an item to the queue */
  push(item: T): void {
    if (this.done) return;

    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  /** Signal that no more items will be pushed */
  end(): void {
    this.done = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: undefined as T, done: true });
    }
  }

  /** Check if the pushable has ended */
  isDone(): boolean {
    return this.done;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.queue.length > 0) {
          const value = this.queue.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}

/**
 * Deferred promise for pending permission requests
 */
interface PendingPermission {
  resolve: (response: acp.RequestPermissionResponse) => void;
  reject: (error: Error) => void;
  sessionId: string;
}

/**
 * Implements the ACP Client interface, bridging agent requests to callbacks
 */
export class ACPClientHandler implements acp.Client {
  private handlers: ClientHandlers;
  private permissionMode: PermissionMode;

  /** Per-session update streams */
  private sessionStreams: Map<string, Pushable<ExtendedSessionUpdate>> = new Map();

  /** Pending permission requests awaiting user response (interactive mode) */
  private pendingPermissions: Map<string, PendingPermission> = new Map();

  /** Counter for generating unique permission request IDs */
  private permissionRequestCounter = 0;

  constructor(
    handlers: ClientHandlers = {},
    permissionMode: PermissionMode = "auto-approve"
  ) {
    this.handlers = handlers;
    this.permissionMode = permissionMode;
  }

  /**
   * Get or create a pushable stream for a session
   */
  getSessionStream(sessionId: string): Pushable<ExtendedSessionUpdate> {
    let stream = this.sessionStreams.get(sessionId);
    if (!stream) {
      stream = new Pushable<ExtendedSessionUpdate>();
      this.sessionStreams.set(sessionId, stream);
    }
    return stream;
  }

  /**
   * End a session's update stream
   */
  endSessionStream(sessionId: string): void {
    const stream = this.sessionStreams.get(sessionId);
    if (stream) {
      stream.end();
      // Remove from cache so next getSessionStream() creates a fresh stream
      this.sessionStreams.delete(sessionId);
    }
  }

  /**
   * Respond to a pending permission request (for interactive mode)
   * @param requestId - The permission request ID from the PermissionRequestUpdate
   * @param optionId - The optionId of the selected option
   */
  respondToPermission(requestId: string, optionId: string): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      throw new Error(`No pending permission request with ID: ${requestId}`);
    }

    this.pendingPermissions.delete(requestId);
    pending.resolve({
      outcome: {
        outcome: "selected",
        optionId,
      },
    });
  }

  /**
   * Cancel a pending permission request (for interactive mode)
   * @param requestId - The permission request ID from the PermissionRequestUpdate
   */
  cancelPermission(requestId: string): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      throw new Error(`No pending permission request with ID: ${requestId}`);
    }

    this.pendingPermissions.delete(requestId);
    pending.resolve({
      outcome: {
        outcome: "cancelled",
      },
    });
  }

  /**
   * Check if there are any pending permission requests
   */
  hasPendingPermissions(): boolean {
    return this.pendingPermissions.size > 0;
  }

  /**
   * Get all pending permission request IDs for a session
   */
  getPendingPermissionIds(sessionId: string): string[] {
    const ids: string[] = [];
    for (const [id, pending] of this.pendingPermissions) {
      if (pending.sessionId === sessionId) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Handle permission requests from the agent
   */
  async requestPermission(
    params: acp.RequestPermissionRequest
  ): Promise<acp.RequestPermissionResponse> {
    // If callback mode and handler provided, delegate to it
    if (this.permissionMode === "callback" && this.handlers.onPermissionRequest) {
      return this.handlers.onPermissionRequest(params);
    }

    // Find appropriate option based on mode
    const options = params.options;

    if (this.permissionMode === "auto-approve") {
      // Look for allow_once or allow_always option
      const allowOption = options.find(
        (opt) => opt.kind === "allow_once" || opt.kind === "allow_always"
      );
      if (allowOption) {
        return {
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        };
      }
    }

    if (this.permissionMode === "auto-deny") {
      // Look for reject_once or reject_always option
      const denyOption = options.find(
        (opt) => opt.kind === "reject_once" || opt.kind === "reject_always"
      );
      if (denyOption) {
        return {
          outcome: {
            outcome: "selected",
            optionId: denyOption.optionId,
          },
        };
      }
    }

    // Interactive mode: emit permission request as session update and wait for response
    if (this.permissionMode === "interactive") {
      const requestId = `perm-${++this.permissionRequestCounter}`;

      // Create the permission request update
      const permissionUpdate: PermissionRequestUpdate = {
        sessionUpdate: "permission_request",
        requestId,
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: params.toolCall.toolCallId,
          title: params.toolCall.title ?? "Unknown",
          status: params.toolCall.status ?? "pending",
          rawInput: params.toolCall.rawInput,
        },
        options: params.options,
      };

      // Emit to session stream
      const stream = this.getSessionStream(params.sessionId);
      stream.push(permissionUpdate);

      // Create deferred promise and wait for response
      return new Promise((resolve, reject) => {
        this.pendingPermissions.set(requestId, {
          resolve,
          reject,
          sessionId: params.sessionId,
        });
      });
    }

    // Fallback: if we have a handler, use it; otherwise pick first option
    if (this.handlers.onPermissionRequest) {
      return this.handlers.onPermissionRequest(params);
    }

    // Last resort: return first option
    return {
      outcome: {
        outcome: "selected",
        optionId: options[0].optionId,
      },
    };
  }

  /**
   * Handle session updates from the agent
   */
  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const stream = this.getSessionStream(params.sessionId);
    stream.push(params.update);
  }

  /**
   * Handle file read requests
   */
  async readTextFile(
    params: acp.ReadTextFileRequest
  ): Promise<acp.ReadTextFileResponse> {
    // Use custom handler if provided
    if (this.handlers.onFileRead) {
      const content = await this.handlers.onFileRead(params.path);
      return { content };
    }

    // Default: read from filesystem
    try {
      const content = await fs.readFile(params.path, "utf-8");
      return { content };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read file ${params.path}: ${message}`);
    }
  }

  /**
   * Handle file write requests
   */
  async writeTextFile(
    params: acp.WriteTextFileRequest
  ): Promise<acp.WriteTextFileResponse> {
    // Use custom handler if provided
    if (this.handlers.onFileWrite) {
      await this.handlers.onFileWrite(params.path, params.content);
      return {};
    }

    // Default: write to filesystem
    try {
      await fs.writeFile(params.path, params.content, "utf-8");
      return {};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write file ${params.path}: ${message}`);
    }
  }

  /**
   * Handle terminal creation requests
   */
  async createTerminal(
    params: acp.CreateTerminalRequest
  ): Promise<acp.CreateTerminalResponse> {
    if (!this.handlers.onTerminalCreate) {
      throw new Error(
        "Terminal operations not supported: no onTerminalCreate handler provided"
      );
    }
    return this.handlers.onTerminalCreate(params);
  }

  /**
   * Handle terminal output requests
   */
  async terminalOutput(
    params: acp.TerminalOutputRequest
  ): Promise<acp.TerminalOutputResponse> {
    if (!this.handlers.onTerminalOutput) {
      throw new Error(
        "Terminal operations not supported: no onTerminalOutput handler provided"
      );
    }
    const output = await this.handlers.onTerminalOutput(params.terminalId);
    return { output, truncated: false };
  }

  /**
   * Handle terminal kill requests
   */
  async killTerminal(
    params: acp.KillTerminalCommandRequest
  ): Promise<acp.KillTerminalCommandResponse> {
    if (!this.handlers.onTerminalKill) {
      throw new Error(
        "Terminal operations not supported: no onTerminalKill handler provided"
      );
    }
    await this.handlers.onTerminalKill(params.terminalId);
    return {};
  }

  /**
   * Handle terminal release requests
   */
  async releaseTerminal(
    params: acp.ReleaseTerminalRequest
  ): Promise<acp.ReleaseTerminalResponse> {
    if (!this.handlers.onTerminalRelease) {
      throw new Error(
        "Terminal operations not supported: no onTerminalRelease handler provided"
      );
    }
    await this.handlers.onTerminalRelease(params.terminalId);
    return {};
  }

  /**
   * Handle terminal wait for exit requests
   */
  async waitForTerminalExit(
    params: acp.WaitForTerminalExitRequest
  ): Promise<acp.WaitForTerminalExitResponse> {
    if (!this.handlers.onTerminalWaitForExit) {
      throw new Error(
        "Terminal operations not supported: no onTerminalWaitForExit handler provided"
      );
    }
    const exitCode = await this.handlers.onTerminalWaitForExit(params.terminalId);
    return { exitCode };
  }
}
