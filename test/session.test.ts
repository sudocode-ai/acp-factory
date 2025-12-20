import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Session } from "../src/session.js";
import { Pushable } from "../src/client-handler.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

describe("Session", () => {
  let mockConnection: {
    prompt: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    setSessionMode: ReturnType<typeof vi.fn> | undefined;
    unstable_forkSession: ReturnType<typeof vi.fn> | undefined;
  };
  let mockClientHandler: {
    getSessionStream: ReturnType<typeof vi.fn>;
    endSessionStream: ReturnType<typeof vi.fn>;
  };
  let mockStream: Pushable<SessionUpdate>;

  beforeEach(() => {
    mockStream = new Pushable<SessionUpdate>();

    mockConnection = {
      prompt: vi.fn(),
      cancel: vi.fn().mockResolvedValue({}),
      setSessionMode: vi.fn().mockResolvedValue({}),
      unstable_forkSession: vi.fn().mockResolvedValue({
        sessionId: "forked-session-id",
        modes: {
          availableModes: [{ id: "code" }, { id: "ask" }],
          currentModeId: "code",
        },
        models: {
          availableModels: [{ modelId: "claude-3" }],
          currentModelId: "claude-3",
        },
      }),
    };

    mockClientHandler = {
      getSessionStream: vi.fn().mockReturnValue(mockStream),
      endSessionStream: vi.fn(),
    };
  });

  describe("constructor", () => {
    it("should store session id, cwd, modes, and models", () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd",
        ["code", "ask"],
        ["claude-3", "claude-4"]
      );

      expect(session.id).toBe("test-id");
      expect(session.cwd).toBe("/test/cwd");
      expect(session.modes).toEqual(["code", "ask"]);
      expect(session.models).toEqual(["claude-3", "claude-4"]);
    });

    it("should default modes and models to empty arrays", () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      expect(session.cwd).toBe("/test/cwd");
      expect(session.modes).toEqual([]);
      expect(session.models).toEqual([]);
    });
  });

  describe("prompt", () => {
    it("should convert string content to ContentBlock array", async () => {
      mockConnection.prompt.mockImplementation(async () => {
        mockStream.end();
        return { stopReason: "end_turn" };
      });

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      // Consume the iterator
      const results: SessionUpdate[] = [];
      for await (const update of session.prompt("Hello")) {
        results.push(update);
      }

      expect(mockConnection.prompt).toHaveBeenCalledWith({
        sessionId: "test-id",
        prompt: [{ type: "text", text: "Hello" }],
      });
    });

    it("should pass ContentBlock array directly", async () => {
      mockConnection.prompt.mockImplementation(async () => {
        mockStream.end();
        return { stopReason: "end_turn" };
      });

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      const blocks = [
        { type: "text" as const, text: "Hello" },
        { type: "text" as const, text: "World" },
      ];

      for await (const _ of session.prompt(blocks)) {
        // consume
      }

      expect(mockConnection.prompt).toHaveBeenCalledWith({
        sessionId: "test-id",
        prompt: blocks,
      });
    });

    it("should yield session updates", async () => {
      const updates: SessionUpdate[] = [
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hi" },
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: " there" },
        },
      ];

      // The stream is created fresh each time getSessionStream is called
      let currentStream: Pushable<SessionUpdate>;
      mockClientHandler.getSessionStream.mockImplementation(() => {
        currentStream = new Pushable<SessionUpdate>();
        return currentStream;
      });

      // Push updates with delays between them, then resolve after all are pushed
      mockConnection.prompt.mockImplementation(() => {
        return new Promise((resolve) => {
          // Push first update
          setImmediate(() => {
            currentStream.push(updates[0]);
            // Push second update after first is processed
            setImmediate(() => {
              currentStream.push(updates[1]);
              // Resolve after both are pushed, with additional delay
              setImmediate(() => {
                resolve({ stopReason: "end_turn" });
              });
            });
          });
        });
      });

      mockClientHandler.endSessionStream.mockImplementation(() => {
        currentStream.end();
      });

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      const results: SessionUpdate[] = [];
      for await (const update of session.prompt("test")) {
        results.push(update);
      }

      expect(results).toEqual(updates);
    });

    it("should end session stream when done", async () => {
      mockConnection.prompt.mockImplementation(async () => {
        mockStream.end();
        return { stopReason: "end_turn" };
      });

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      for await (const _ of session.prompt("test")) {
        // consume
      }

      expect(mockClientHandler.endSessionStream).toHaveBeenCalledWith(
        "test-id"
      );
    });

    it("should handle tool_call updates", async () => {
      const toolCallUpdate: SessionUpdate = {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Read file",
        kind: "read",
        status: "pending",
      };

      let currentStream: Pushable<SessionUpdate>;
      mockClientHandler.getSessionStream.mockImplementation(() => {
        currentStream = new Pushable<SessionUpdate>();
        return currentStream;
      });

      mockConnection.prompt.mockImplementation(() => {
        return new Promise((resolve) => {
          setImmediate(() => {
            currentStream.push(toolCallUpdate);
            resolve({ stopReason: "end_turn" });
          });
        });
      });

      mockClientHandler.endSessionStream.mockImplementation(() => {
        currentStream.end();
      });

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      const results: SessionUpdate[] = [];
      for await (const update of session.prompt("test")) {
        results.push(update);
      }

      expect(results).toContainEqual(toolCallUpdate);
    });
  });

  describe("cancel", () => {
    it("should call connection.cancel with session id", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      await session.cancel();

      expect(mockConnection.cancel).toHaveBeenCalledWith({
        sessionId: "test-id",
      });
    });
  });

  describe("setMode", () => {
    it("should call connection.setSessionMode", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      await session.setMode("ask");

      expect(mockConnection.setSessionMode).toHaveBeenCalledWith({
        sessionId: "test-id",
        modeId: "ask",
      });
    });

    it("should throw if agent does not support setSessionMode", async () => {
      mockConnection.setSessionMode = undefined;

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      await expect(session.setMode("ask")).rejects.toThrow(
        "Agent does not support setting session mode"
      );
    });
  });

  describe("permission methods", () => {
    it("should delegate respondToPermission to clientHandler", () => {
      const mockRespondToPermission = vi.fn();
      mockClientHandler.respondToPermission = mockRespondToPermission;

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      session.respondToPermission("perm-1", "allow");

      expect(mockRespondToPermission).toHaveBeenCalledWith("perm-1", "allow");
    });

    it("should delegate cancelPermission to clientHandler", () => {
      const mockCancelPermission = vi.fn();
      mockClientHandler.cancelPermission = mockCancelPermission;

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      session.cancelPermission("perm-1");

      expect(mockCancelPermission).toHaveBeenCalledWith("perm-1");
    });

    it("should return pending permission status from clientHandler", () => {
      mockClientHandler.getPendingPermissionIds = vi
        .fn()
        .mockReturnValue(["perm-1", "perm-2"]);

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      expect(session.hasPendingPermissions()).toBe(true);
      expect(session.getPendingPermissionIds()).toEqual(["perm-1", "perm-2"]);
    });

    it("should return false when no pending permissions", () => {
      mockClientHandler.getPendingPermissionIds = vi.fn().mockReturnValue([]);

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      expect(session.hasPendingPermissions()).toBe(false);
    });
  });

  describe("interruptWith", () => {
    it("should cancel current prompt and start new one", async () => {
      const updates: SessionUpdate[] = [
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "New response" },
        },
      ];

      let currentStream: Pushable<SessionUpdate>;
      mockClientHandler.getSessionStream.mockImplementation(() => {
        currentStream = new Pushable<SessionUpdate>();
        return currentStream;
      });

      mockConnection.prompt.mockImplementation(() => {
        return new Promise((resolve) => {
          setImmediate(() => {
            for (const update of updates) {
              currentStream.push(update);
            }
            setImmediate(() => {
              resolve({ stopReason: "end_turn" });
            });
          });
        });
      });

      mockClientHandler.endSessionStream.mockImplementation(() => {
        currentStream.end();
      });

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      const results: SessionUpdate[] = [];
      for await (const update of session.interruptWith("New prompt")) {
        results.push(update);
      }

      // Should have called cancel first
      expect(mockConnection.cancel).toHaveBeenCalledWith({
        sessionId: "test-id",
      });

      // Should have called prompt with new content
      expect(mockConnection.prompt).toHaveBeenCalledWith({
        sessionId: "test-id",
        prompt: [{ type: "text", text: "New prompt" }],
      });

      expect(results).toEqual(updates);
    });

    it("should handle ContentBlock array input", async () => {
      let currentStream: Pushable<SessionUpdate>;
      mockClientHandler.getSessionStream.mockImplementation(() => {
        currentStream = new Pushable<SessionUpdate>();
        return currentStream;
      });

      mockConnection.prompt.mockImplementation(() => {
        return new Promise((resolve) => {
          setImmediate(() => {
            currentStream.end();
            resolve({ stopReason: "end_turn" });
          });
        });
      });

      mockClientHandler.endSessionStream.mockImplementation(() => {
        currentStream?.end();
      });

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      const blocks = [
        { type: "text" as const, text: "First part" },
        { type: "text" as const, text: "Second part" },
      ];

      for await (const _ of session.interruptWith(blocks)) {
        // consume
      }

      expect(mockConnection.prompt).toHaveBeenCalledWith({
        sessionId: "test-id",
        prompt: blocks,
      });
    });
  });

  describe("addContext", () => {
    it("should throw error indicating feature not yet supported", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      await expect(session.addContext("Additional context")).rejects.toThrow(
        "addContext() is not yet supported"
      );
    });

    it("should mention interruptWith as alternative in error", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      await expect(session.addContext("test")).rejects.toThrow(
        /interruptWith\(\)/
      );
    });
  });

  describe("fork", () => {
    it("should fork the session via connection", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd",
        ["code"],
        ["claude-3"]
      );

      const forkedSession = await session.fork();

      expect(mockConnection.unstable_forkSession).toHaveBeenCalledWith({
        sessionId: "test-id",
        cwd: "/test/cwd",
      });
      expect(forkedSession.id).toBe("forked-session-id");
      expect(forkedSession.cwd).toBe("/test/cwd");
      expect(forkedSession.modes).toEqual(["code", "ask"]);
      expect(forkedSession.models).toEqual(["claude-3"]);
    });

    it("should throw if connection does not support unstable_forkSession", async () => {
      mockConnection.unstable_forkSession = undefined;

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      await expect(session.fork()).rejects.toThrow(
        "Agent does not support forking sessions"
      );
    });

    it("should handle null modes and models in response", async () => {
      mockConnection.unstable_forkSession = vi.fn().mockResolvedValue({
        sessionId: "forked-session-id",
        modes: null,
        models: null,
      });

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      const forkedSession = await session.fork();

      expect(forkedSession.id).toBe("forked-session-id");
      expect(forkedSession.modes).toEqual([]);
      expect(forkedSession.models).toEqual([]);
    });

    it("should create independent session that shares connection", async () => {
      const session = new Session(
        "original-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      const forkedSession = await session.fork();

      // Original session unchanged
      expect(session.id).toBe("original-id");
      // Forked session has new ID
      expect(forkedSession.id).toBe("forked-session-id");
      // Forked session inherits cwd
      expect(forkedSession.cwd).toBe("/test/cwd");
      // Both share the same connection (verified by checking unstable_forkSession was called)
      expect(mockConnection.unstable_forkSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("getSessionFilePath", () => {
    let testTempDir: string;

    beforeEach(() => {
      // Create a temp directory for tests that need real paths
      testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-path-test-"));
    });

    afterEach(() => {
      // Cleanup temp directory
      if (testTempDir && fs.existsSync(testTempDir)) {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      }
    });

    it("should compute correct path with cwd hash", () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/private/tmp"
      );

      const filePath = session.getSessionFilePath("abc123");
      const homeDir = os.homedir();

      expect(filePath).toBe(`${homeDir}/.claude/projects/-private-tmp/abc123.jsonl`);
    });

    it("should handle deeply nested cwd paths", () => {
      // Create nested directories to test path hashing
      const nestedDir = path.join(testTempDir, "deeply", "nested", "path");
      fs.mkdirSync(nestedDir, { recursive: true });

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        nestedDir
      );

      const filePath = session.getSessionFilePath("session-xyz");
      const homeDir = os.homedir();
      // The real path should be hashed with / and _ replaced by -
      const realPath = fs.realpathSync(nestedDir);
      const expectedHash = realPath.replace(/[/_]/g, "-");

      expect(filePath).toBe(`${homeDir}/.claude/projects/${expectedHash}/session-xyz.jsonl`);
    });

    it("should handle root cwd", () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/"
      );

      const filePath = session.getSessionFilePath("root-session");
      const homeDir = os.homedir();

      expect(filePath).toBe(`${homeDir}/.claude/projects/-/root-session.jsonl`);
    });

    it("should use session id from parameter not session.id", () => {
      const session = new Session(
        "original-session-id",
        mockConnection as any,
        mockClientHandler as any,
        testTempDir
      );

      const filePath = session.getSessionFilePath("different-session-id");
      const homeDir = os.homedir();
      const realPath = fs.realpathSync(testTempDir);
      const expectedHash = realPath.replace(/[/_]/g, "-");

      expect(filePath).toBe(`${homeDir}/.claude/projects/${expectedHash}/different-session-id.jsonl`);
    });
  });
});
