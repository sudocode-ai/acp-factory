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
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: " there" } },
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

      expect(mockClientHandler.endSessionStream).toHaveBeenCalledWith("test-id");
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
        mode: "ask",
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
});
