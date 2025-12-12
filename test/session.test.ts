import { describe, it, expect, vi, beforeEach } from "vitest";
import { Session } from "../src/session.js";
import { Pushable } from "../src/client-handler.js";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

describe("Session", () => {
  let mockConnection: {
    prompt: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    setSessionMode: ReturnType<typeof vi.fn> | undefined;
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
    };

    mockClientHandler = {
      getSessionStream: vi.fn().mockReturnValue(mockStream),
      endSessionStream: vi.fn(),
    };
  });

  describe("constructor", () => {
    it("should store session id, modes, and models", () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        ["code", "ask"],
        ["claude-3", "claude-4"]
      );

      expect(session.id).toBe("test-id");
      expect(session.modes).toEqual(["code", "ask"]);
      expect(session.models).toEqual(["claude-3", "claude-4"]);
    });

    it("should default modes and models to empty arrays", () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any
      );

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
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
      );

      expect(session.hasPendingPermissions()).toBe(true);
      expect(session.getPendingPermissionIds()).toEqual(["perm-1", "perm-2"]);
    });

    it("should return false when no pending permissions", () => {
      mockClientHandler.getPendingPermissionIds = vi.fn().mockReturnValue([]);

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
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
        mockClientHandler as any
      );

      await expect(session.addContext("Additional context")).rejects.toThrow(
        "addContext() is not yet supported"
      );
    });

    it("should mention interruptWith as alternative in error", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any
      );

      await expect(session.addContext("test")).rejects.toThrow(
        /interruptWith\(\)/
      );
    });
  });
});
