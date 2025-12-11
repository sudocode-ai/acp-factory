/**
 * ACPClientHandler - Implements acp.Client interface
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { ClientHandlers, PermissionMode } from "./types.js";

/**
 * Implements the ACP Client interface, bridging agent requests to callbacks
 */
export class ACPClientHandler implements acp.Client {
  private handlers: ClientHandlers;
  private permissionMode: PermissionMode;

  constructor(handlers: ClientHandlers = {}, permissionMode: PermissionMode = "auto-approve") {
    this.handlers = handlers;
    this.permissionMode = permissionMode;
  }

  /**
   * Handle permission requests from the agent
   */
  async requestPermission(
    params: acp.RequestPermissionRequest
  ): Promise<acp.RequestPermissionResponse> {
    // TODO: Implement in i-63n6
    // 1. Check permission mode
    // 2. If auto-approve, return first "allow" option
    // 3. If auto-deny, return first "deny" option
    // 4. If callback, delegate to handler
    throw new Error("Not implemented - see issue i-63n6");
  }

  /**
   * Handle session updates from the agent
   */
  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    // TODO: Implement in i-63n6
    // Push to per-session async iterator
    throw new Error("Not implemented - see issue i-63n6");
  }

  /**
   * Handle file read requests
   */
  async readTextFile(
    params: acp.ReadTextFileRequest
  ): Promise<acp.ReadTextFileResponse> {
    // TODO: Implement in i-63n6
    throw new Error("Not implemented - see issue i-63n6");
  }

  /**
   * Handle file write requests
   */
  async writeTextFile(
    params: acp.WriteTextFileRequest
  ): Promise<acp.WriteTextFileResponse> {
    // TODO: Implement in i-63n6
    throw new Error("Not implemented - see issue i-63n6");
  }

  /**
   * Handle terminal creation requests
   */
  async createTerminal(
    params: acp.CreateTerminalRequest
  ): Promise<acp.CreateTerminalResponse> {
    // TODO: Implement in i-63n6
    throw new Error("Not implemented - see issue i-63n6");
  }

  /**
   * Handle terminal output requests
   */
  async terminalOutput(
    params: acp.TerminalOutputRequest
  ): Promise<acp.TerminalOutputResponse> {
    // TODO: Implement in i-63n6
    throw new Error("Not implemented - see issue i-63n6");
  }

  /**
   * Handle terminal kill requests
   */
  async killTerminal(
    params: acp.KillTerminalCommandRequest
  ): Promise<acp.KillTerminalCommandResponse> {
    // TODO: Implement in i-63n6
    throw new Error("Not implemented - see issue i-63n6");
  }

  /**
   * Handle terminal release requests
   */
  async releaseTerminal(
    params: acp.ReleaseTerminalRequest
  ): Promise<acp.ReleaseTerminalResponse> {
    // TODO: Implement in i-63n6
    throw new Error("Not implemented - see issue i-63n6");
  }

  /**
   * Handle terminal wait for exit requests
   */
  async waitForTerminalExit(
    params: acp.WaitForTerminalExitRequest
  ): Promise<acp.WaitForTerminalExitResponse> {
    // TODO: Implement in i-63n6
    throw new Error("Not implemented - see issue i-63n6");
  }
}
