import { describe, it, expect, vi } from "vitest";
import { ACPClientHandler, Pushable } from "../src/client-handler.js";
import type {
  RequestPermissionRequest,
  SessionNotification,
  SessionUpdate,
} from "@agentclientprotocol/sdk";

describe("Pushable", () => {
  it("should yield pushed items in order", async () => {
    const pushable = new Pushable<number>();
    pushable.push(1);
    pushable.push(2);
    pushable.push(3);
    pushable.end();

    const results: number[] = [];
    for await (const item of pushable) {
      results.push(item);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it("should wait for items when queue is empty", async () => {
    const pushable = new Pushable<string>();

    // Start consuming in background
    const resultsPromise = (async () => {
      const results: string[] = [];
      for await (const item of pushable) {
        results.push(item);
      }
      return results;
    })();

    // Push items with delay
    pushable.push("a");
    pushable.push("b");
    pushable.end();

    const results = await resultsPromise;
    expect(results).toEqual(["a", "b"]);
  });

  it("should return done when ended", async () => {
    const pushable = new Pushable<number>();
    pushable.end();

    const iterator = pushable[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.done).toBe(true);
  });

  it("should ignore pushes after end", async () => {
    const pushable = new Pushable<number>();
    pushable.push(1);
    pushable.end();
    pushable.push(2); // Should be ignored

    const results: number[] = [];
    for await (const item of pushable) {
      results.push(item);
    }

    expect(results).toEqual([1]);
  });

  it("should report isDone correctly", () => {
    const pushable = new Pushable<number>();
    expect(pushable.isDone()).toBe(false);
    pushable.end();
    expect(pushable.isDone()).toBe(true);
  });
});

describe("ACPClientHandler", () => {
  describe("requestPermission", () => {
    const createPermissionRequest = (
      options: Array<{ kind: string; optionId: string; name: string }>
    ): RequestPermissionRequest => ({
      sessionId: "test-session",
      toolCall: {
        toolCallId: "tool-1",
        title: "Test Tool",
        status: "pending",
      },
      options: options.map((opt) => ({
        kind: opt.kind as "allow_once" | "allow_always" | "reject_once" | "reject_always",
        optionId: opt.optionId,
        name: opt.name,
      })),
    });

    it("should auto-approve by selecting allow_once option", async () => {
      const handler = new ACPClientHandler({}, "auto-approve");

      const result = await handler.requestPermission(
        createPermissionRequest([
          { kind: "allow_once", optionId: "allow", name: "Allow" },
          { kind: "reject_once", optionId: "reject", name: "Reject" },
        ])
      );

      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "allow",
      });
    });

    it("should auto-approve by selecting allow_always option", async () => {
      const handler = new ACPClientHandler({}, "auto-approve");

      const result = await handler.requestPermission(
        createPermissionRequest([
          { kind: "reject_once", optionId: "reject", name: "Reject" },
          { kind: "allow_always", optionId: "allow-all", name: "Allow Always" },
        ])
      );

      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "allow-all",
      });
    });

    it("should auto-deny by selecting reject_once option", async () => {
      const handler = new ACPClientHandler({}, "auto-deny");

      const result = await handler.requestPermission(
        createPermissionRequest([
          { kind: "allow_once", optionId: "allow", name: "Allow" },
          { kind: "reject_once", optionId: "reject", name: "Reject" },
        ])
      );

      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "reject",
      });
    });

    it("should auto-deny by selecting reject_always option", async () => {
      const handler = new ACPClientHandler({}, "auto-deny");

      const result = await handler.requestPermission(
        createPermissionRequest([
          { kind: "allow_once", optionId: "allow", name: "Allow" },
          { kind: "reject_always", optionId: "reject-all", name: "Reject Always" },
        ])
      );

      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "reject-all",
      });
    });

    it("should use callback handler in callback mode", async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        outcome: { outcome: "selected", optionId: "custom" },
      });

      const handler = new ACPClientHandler(
        { onPermissionRequest: mockHandler },
        "callback"
      );

      const request = createPermissionRequest([
        { kind: "allow_once", optionId: "allow", name: "Allow" },
      ]);

      const result = await handler.requestPermission(request);

      expect(mockHandler).toHaveBeenCalledWith(request);
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "custom",
      });
    });

    it("should fallback to first option when no matching option found", async () => {
      const handler = new ACPClientHandler({}, "auto-approve");

      // Only reject options available
      const result = await handler.requestPermission(
        createPermissionRequest([
          { kind: "reject_once", optionId: "reject", name: "Reject" },
          { kind: "reject_always", optionId: "reject-all", name: "Reject Always" },
        ])
      );

      // Should fallback to first option
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "reject",
      });
    });
  });

  describe("interactive permission mode", () => {
    const createPermissionRequest = (
      sessionId: string,
      options: Array<{ kind: string; optionId: string; name: string }>
    ) => ({
      sessionId,
      toolCall: {
        toolCallId: "tool-1",
        title: "Test Tool",
        status: "pending",
      },
      options: options.map((opt) => ({
        kind: opt.kind as "allow_once" | "allow_always" | "reject_once" | "reject_always",
        optionId: opt.optionId,
        name: opt.name,
      })),
    });

    it("should emit permission request to session stream", async () => {
      const handler = new ACPClientHandler({}, "interactive");
      const stream = handler.getSessionStream("session-1");

      // Start permission request (will block until responded)
      const permissionPromise = handler.requestPermission(
        createPermissionRequest("session-1", [
          { kind: "allow_once", optionId: "allow", name: "Allow" },
          { kind: "reject_once", optionId: "reject", name: "Reject" },
        ])
      );

      // Get the emitted update from the stream
      const iterator = stream[Symbol.asyncIterator]();
      const { value: update } = await iterator.next();

      expect(update.sessionUpdate).toBe("permission_request");
      expect((update as any).requestId).toMatch(/^perm-\d+$/);
      expect((update as any).sessionId).toBe("session-1");
      expect((update as any).toolCall.toolCallId).toBe("tool-1");
      expect((update as any).options).toHaveLength(2);

      // Respond to unblock the promise
      handler.respondToPermission((update as any).requestId, "allow");
      const result = await permissionPromise;

      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "allow",
      });
    });

    it("should handle respondToPermission correctly", async () => {
      const handler = new ACPClientHandler({}, "interactive");
      handler.getSessionStream("session-1"); // Initialize stream

      const permissionPromise = handler.requestPermission(
        createPermissionRequest("session-1", [
          { kind: "allow_once", optionId: "allow", name: "Allow" },
          { kind: "reject_once", optionId: "reject", name: "Reject" },
        ])
      );

      // Wait a tick for the update to be pushed
      await new Promise((resolve) => setImmediate(resolve));

      // Get pending permission IDs
      const pendingIds = handler.getPendingPermissionIds("session-1");
      expect(pendingIds).toHaveLength(1);

      // Respond with reject
      handler.respondToPermission(pendingIds[0], "reject");
      const result = await permissionPromise;

      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "reject",
      });
    });

    it("should handle cancelPermission correctly", async () => {
      const handler = new ACPClientHandler({}, "interactive");
      handler.getSessionStream("session-1");

      const permissionPromise = handler.requestPermission(
        createPermissionRequest("session-1", [
          { kind: "allow_once", optionId: "allow", name: "Allow" },
        ])
      );

      await new Promise((resolve) => setImmediate(resolve));

      const pendingIds = handler.getPendingPermissionIds("session-1");
      handler.cancelPermission(pendingIds[0]);

      const result = await permissionPromise;
      expect(result.outcome).toEqual({
        outcome: "cancelled",
      });
    });

    it("should throw error when responding to non-existent permission", () => {
      const handler = new ACPClientHandler({}, "interactive");

      expect(() => handler.respondToPermission("non-existent", "allow")).toThrow(
        "No pending permission request with ID: non-existent"
      );
    });

    it("should throw error when cancelling non-existent permission", () => {
      const handler = new ACPClientHandler({}, "interactive");

      expect(() => handler.cancelPermission("non-existent")).toThrow(
        "No pending permission request with ID: non-existent"
      );
    });

    it("should track hasPendingPermissions correctly", async () => {
      const handler = new ACPClientHandler({}, "interactive");
      handler.getSessionStream("session-1");

      expect(handler.hasPendingPermissions()).toBe(false);

      const permissionPromise = handler.requestPermission(
        createPermissionRequest("session-1", [
          { kind: "allow_once", optionId: "allow", name: "Allow" },
        ])
      );

      await new Promise((resolve) => setImmediate(resolve));
      expect(handler.hasPendingPermissions()).toBe(true);

      const pendingIds = handler.getPendingPermissionIds("session-1");
      handler.respondToPermission(pendingIds[0], "allow");
      await permissionPromise;

      expect(handler.hasPendingPermissions()).toBe(false);
    });

    it("should handle multiple pending permissions for different sessions", async () => {
      const handler = new ACPClientHandler({}, "interactive");
      handler.getSessionStream("session-1");
      handler.getSessionStream("session-2");

      const promise1 = handler.requestPermission(
        createPermissionRequest("session-1", [
          { kind: "allow_once", optionId: "allow", name: "Allow" },
        ])
      );

      const promise2 = handler.requestPermission(
        createPermissionRequest("session-2", [
          { kind: "allow_once", optionId: "allow", name: "Allow" },
        ])
      );

      await new Promise((resolve) => setImmediate(resolve));

      expect(handler.getPendingPermissionIds("session-1")).toHaveLength(1);
      expect(handler.getPendingPermissionIds("session-2")).toHaveLength(1);

      // Respond to session-1
      const ids1 = handler.getPendingPermissionIds("session-1");
      handler.respondToPermission(ids1[0], "allow");
      await promise1;

      expect(handler.getPendingPermissionIds("session-1")).toHaveLength(0);
      expect(handler.getPendingPermissionIds("session-2")).toHaveLength(1);

      // Respond to session-2
      const ids2 = handler.getPendingPermissionIds("session-2");
      handler.respondToPermission(ids2[0], "allow");
      await promise2;
    });
  });

  describe("sessionUpdate", () => {
    it("should push updates to session stream", async () => {
      const handler = new ACPClientHandler();

      const update: SessionUpdate = {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      };

      const notification: SessionNotification = {
        sessionId: "session-1",
        update,
      };

      // Get stream before pushing
      const stream = handler.getSessionStream("session-1");

      // Push update
      await handler.sessionUpdate(notification);

      // End stream
      handler.endSessionStream("session-1");

      // Collect results
      const results: SessionUpdate[] = [];
      for await (const item of stream) {
        results.push(item);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(update);
    });

    it("should handle multiple sessions independently", async () => {
      const handler = new ACPClientHandler();

      const stream1 = handler.getSessionStream("session-1");
      const stream2 = handler.getSessionStream("session-2");

      await handler.sessionUpdate({
        sessionId: "session-1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "S1" } },
      });

      await handler.sessionUpdate({
        sessionId: "session-2",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "S2" } },
      });

      handler.endSessionStream("session-1");
      handler.endSessionStream("session-2");

      const results1: SessionUpdate[] = [];
      for await (const item of stream1) {
        results1.push(item);
      }

      const results2: SessionUpdate[] = [];
      for await (const item of stream2) {
        results2.push(item);
      }

      expect(results1).toHaveLength(1);
      expect(results2).toHaveLength(1);
      expect((results1[0] as any).content.text).toBe("S1");
      expect((results2[0] as any).content.text).toBe("S2");
    });
  });

  describe("readTextFile", () => {
    it("should use custom handler when provided", async () => {
      const mockRead = vi.fn().mockResolvedValue("custom content");
      const handler = new ACPClientHandler({ onFileRead: mockRead });

      const result = await handler.readTextFile({ path: "/test/file.txt", sessionId: "s1" });

      expect(mockRead).toHaveBeenCalledWith("/test/file.txt");
      expect(result.content).toBe("custom content");
    });

    it("should throw error when file read fails without handler", async () => {
      const handler = new ACPClientHandler();

      await expect(
        handler.readTextFile({ path: "/nonexistent/path/file.txt", sessionId: "s1" })
      ).rejects.toThrow("Failed to read file");
    });
  });

  describe("writeTextFile", () => {
    it("should use custom handler when provided", async () => {
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      const handler = new ACPClientHandler({ onFileWrite: mockWrite });

      const result = await handler.writeTextFile({
        path: "/test/file.txt",
        content: "test content",
        sessionId: "s1",
      });

      expect(mockWrite).toHaveBeenCalledWith("/test/file.txt", "test content");
      expect(result).toEqual({});
    });
  });

  describe("terminal operations", () => {
    it("should throw error when createTerminal handler not provided", async () => {
      const handler = new ACPClientHandler();

      await expect(
        handler.createTerminal({ command: "ls", cwd: "/tmp", sessionId: "s1" })
      ).rejects.toThrow("no onTerminalCreate handler provided");
    });

    it("should throw error when terminalOutput handler not provided", async () => {
      const handler = new ACPClientHandler();

      await expect(
        handler.terminalOutput({ terminalId: "term-1", sessionId: "s1" })
      ).rejects.toThrow("no onTerminalOutput handler provided");
    });

    it("should throw error when killTerminal handler not provided", async () => {
      const handler = new ACPClientHandler();

      await expect(
        handler.killTerminal({ terminalId: "term-1", sessionId: "s1" })
      ).rejects.toThrow("no onTerminalKill handler provided");
    });

    it("should throw error when releaseTerminal handler not provided", async () => {
      const handler = new ACPClientHandler();

      await expect(
        handler.releaseTerminal({ terminalId: "term-1", sessionId: "s1" })
      ).rejects.toThrow("no onTerminalRelease handler provided");
    });

    it("should throw error when waitForTerminalExit handler not provided", async () => {
      const handler = new ACPClientHandler();

      await expect(
        handler.waitForTerminalExit({ terminalId: "term-1", sessionId: "s1" })
      ).rejects.toThrow("no onTerminalWaitForExit handler provided");
    });

    it("should delegate to createTerminal handler", async () => {
      const mockCreate = vi.fn().mockResolvedValue({ terminalId: "term-123" });
      const handler = new ACPClientHandler({ onTerminalCreate: mockCreate });

      const result = await handler.createTerminal({ command: "ls", cwd: "/tmp", sessionId: "s1" });

      expect(mockCreate).toHaveBeenCalledWith({ command: "ls", cwd: "/tmp", sessionId: "s1" });
      expect(result).toEqual({ terminalId: "term-123" });
    });

    it("should delegate to terminalOutput handler", async () => {
      const mockOutput = vi.fn().mockResolvedValue("output text");
      const handler = new ACPClientHandler({ onTerminalOutput: mockOutput });

      const result = await handler.terminalOutput({ terminalId: "term-1", sessionId: "s1" });

      expect(mockOutput).toHaveBeenCalledWith("term-1");
      expect(result).toEqual({ output: "output text", truncated: false });
    });

    it("should delegate to waitForTerminalExit handler", async () => {
      const mockWait = vi.fn().mockResolvedValue(0);
      const handler = new ACPClientHandler({ onTerminalWaitForExit: mockWait });

      const result = await handler.waitForTerminalExit({ terminalId: "term-1", sessionId: "s1" });

      expect(mockWait).toHaveBeenCalledWith("term-1");
      expect(result).toEqual({ exitCode: 0 });
    });
  });
});
