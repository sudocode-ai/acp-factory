import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Mock ACP SDK
vi.mock("@agentclientprotocol/sdk", () => ({
  ndJsonStream: vi.fn(),
  ClientSideConnection: vi.fn(),
  PROTOCOL_VERSION: 1,
}));

import { spawn } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";
import { AgentHandle } from "../src/agent-handle.js";
import type { AgentConfig, SpawnOptions } from "../src/types.js";

describe("AgentHandle", () => {
  let mockProcess: EventEmitter & {
    stdin: Writable;
    stdout: Readable;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
    exitCode: number | null;
  };
  let mockConnection: {
    initialize: ReturnType<typeof vi.fn>;
    newSession: ReturnType<typeof vi.fn>;
    loadSession: ReturnType<typeof vi.fn>;
    forkSession: ReturnType<typeof vi.fn>;
    setSessionMode: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
    closed: Promise<void>;
  };

  const testConfig: AgentConfig = {
    command: "test-command",
    args: ["--test"],
    env: { TEST_VAR: "test-value" },
  };

  beforeEach(() => {
    // Create mock process
    mockProcess = Object.assign(new EventEmitter(), {
      stdin: new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      stdout: new Readable({
        read() {},
      }),
      kill: vi.fn(),
      killed: false,
      exitCode: null,
    });

    // Create mock connection
    mockConnection = {
      initialize: vi.fn().mockResolvedValue({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
      }),
      newSession: vi.fn().mockResolvedValue({
        sessionId: "test-session-id",
        modes: {
          availableModes: [{ id: "code" }, { id: "ask" }],
          currentModeId: "code",
        },
        models: {
          availableModels: [{ modelId: "claude-3" }],
          currentModelId: "claude-3",
        },
      }),
      loadSession: vi.fn().mockResolvedValue({
        modes: null,
        models: null,
      }),
      forkSession: vi.fn().mockResolvedValue({
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
      setSessionMode: vi.fn().mockResolvedValue({}),
      cancel: vi.fn().mockResolvedValue({}),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      closed: Promise.resolve(),
    };

    // Setup mocks
    vi.mocked(spawn).mockReturnValue(mockProcess as any);
    vi.mocked(acp.ndJsonStream).mockReturnValue({} as any);
    vi.mocked(acp.ClientSideConnection).mockImplementation(() => mockConnection as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should spawn subprocess with correct arguments", async () => {
      await AgentHandle.create(testConfig, {});

      expect(spawn).toHaveBeenCalledWith(
        "test-command",
        ["--test"],
        expect.objectContaining({
          stdio: ["pipe", "pipe", "inherit"],
        })
      );
    });

    it("should merge environment variables from config and options", async () => {
      const options: SpawnOptions = {
        env: { OPTION_VAR: "option-value" },
      };

      await AgentHandle.create(testConfig, options);

      expect(spawn).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          env: expect.objectContaining({
            TEST_VAR: "test-value",
            OPTION_VAR: "option-value",
          }),
        })
      );
    });

    it("should initialize connection with correct capabilities", async () => {
      await AgentHandle.create(testConfig, {});

      expect(mockConnection.initialize).toHaveBeenCalledWith({
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: false,
        },
      });
    });

    it("should enable terminal capability when all handlers provided", async () => {
      const options: SpawnOptions = {
        onTerminalCreate: vi.fn(),
        onTerminalOutput: vi.fn(),
        onTerminalKill: vi.fn(),
        onTerminalRelease: vi.fn(),
        onTerminalWaitForExit: vi.fn(),
      };

      await AgentHandle.create(testConfig, options);

      expect(mockConnection.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          clientCapabilities: expect.objectContaining({
            terminal: true,
          }),
        })
      );
    });

    it("should return AgentHandle with capabilities", async () => {
      const handle = await AgentHandle.create(testConfig, {});

      expect(handle.capabilities).toEqual({ loadSession: true });
    });

    it("should kill process on initialization failure", async () => {
      mockConnection.initialize.mockRejectedValue(new Error("Init failed"));

      await expect(AgentHandle.create(testConfig, {})).rejects.toThrow("Init failed");
      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it("should throw if stdio streams not available", async () => {
      const badProcess = Object.assign(new EventEmitter(), {
        stdin: null,
        stdout: null,
        kill: vi.fn(),
        killed: false,
        exitCode: null,
      });
      vi.mocked(spawn).mockReturnValue(badProcess as any);

      await expect(AgentHandle.create(testConfig, {})).rejects.toThrow(
        "Failed to get agent process stdio streams"
      );
    });
  });

  describe("createSession", () => {
    it("should create session with cwd", async () => {
      const handle = await AgentHandle.create(testConfig, {});
      const session = await handle.createSession("/test/cwd");

      expect(mockConnection.newSession).toHaveBeenCalledWith({
        cwd: "/test/cwd",
        mcpServers: [],
      });
      expect(session.id).toBe("test-session-id");
    });

    it("should pass MCP servers to session", async () => {
      const handle = await AgentHandle.create(testConfig, {});
      const mcpServers = [{ type: "stdio" as const, command: "mcp-server", args: [] }];

      await handle.createSession("/test/cwd", { mcpServers });

      expect(mockConnection.newSession).toHaveBeenCalledWith({
        cwd: "/test/cwd",
        mcpServers,
      });
    });

    it("should set mode if specified", async () => {
      const handle = await AgentHandle.create(testConfig, {});
      await handle.createSession("/test/cwd", { mode: "ask" });

      expect(mockConnection.setSessionMode).toHaveBeenCalledWith({
        sessionId: "test-session-id",
        modeId: "ask",
      });
    });

    it("should return session with modes and models", async () => {
      const handle = await AgentHandle.create(testConfig, {});
      const session = await handle.createSession("/test/cwd");

      expect(session.modes).toEqual(["code", "ask"]);
      expect(session.models).toEqual(["claude-3"]);
    });
  });

  describe("loadSession", () => {
    it("should load existing session", async () => {
      const handle = await AgentHandle.create(testConfig, {});
      const session = await handle.loadSession("existing-session", "/test/cwd");

      expect(mockConnection.loadSession).toHaveBeenCalledWith({
        sessionId: "existing-session",
        cwd: "/test/cwd",
        mcpServers: [],
      });
      expect(session.id).toBe("existing-session");
    });

    it("should throw if agent does not support loadSession", async () => {
      mockConnection.initialize.mockResolvedValue({
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
      });

      const handle = await AgentHandle.create(testConfig, {});

      await expect(handle.loadSession("session-id", "/test/cwd")).rejects.toThrow(
        "Agent does not support loading sessions"
      );
    });
  });

  describe("forkSession", () => {
    it("should fork an existing session", async () => {
      mockConnection.initialize.mockResolvedValue({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { fork: {} },
        },
      });

      const handle = await AgentHandle.create(testConfig, {});
      const session = await handle.forkSession("original-session");

      expect(mockConnection.forkSession).toHaveBeenCalledWith({
        sessionId: "original-session",
      });
      expect(session.id).toBe("forked-session-id");
      expect(session.modes).toEqual(["code", "ask"]);
      expect(session.models).toEqual(["claude-3"]);
    });

    it("should throw if agent does not support forking", async () => {
      mockConnection.initialize.mockResolvedValue({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
      });

      const handle = await AgentHandle.create(testConfig, {});

      await expect(handle.forkSession("session-id")).rejects.toThrow(
        "Agent does not support forking sessions"
      );
    });

    it("should handle null modes and models in response", async () => {
      mockConnection.initialize.mockResolvedValue({
        protocolVersion: 1,
        agentCapabilities: {
          sessionCapabilities: { fork: {} },
        },
      });

      mockConnection.forkSession.mockResolvedValue({
        sessionId: "forked-session-id",
        modes: null,
        models: null,
      });

      const handle = await AgentHandle.create(testConfig, {});
      const session = await handle.forkSession("original-session");

      expect(session.id).toBe("forked-session-id");
      expect(session.modes).toEqual([]);
      expect(session.models).toEqual([]);
    });
  });

  describe("close", () => {
    it("should kill process and wait for connection to close", async () => {
      const handle = await AgentHandle.create(testConfig, {});
      await handle.close();

      expect(mockProcess.kill).toHaveBeenCalled();
    });
  });

  describe("isRunning", () => {
    it("should return true when process is running", async () => {
      const handle = await AgentHandle.create(testConfig, {});

      expect(handle.isRunning()).toBe(true);
    });

    it("should return false when process is killed", async () => {
      mockProcess.killed = true;
      const handle = await AgentHandle.create(testConfig, {});

      expect(handle.isRunning()).toBe(false);
    });

    it("should return false when process has exited", async () => {
      mockProcess.exitCode = 0;
      const handle = await AgentHandle.create(testConfig, {});

      expect(handle.isRunning()).toBe(false);
    });
  });

  describe("getConnection", () => {
    it("should return the underlying connection", async () => {
      const handle = await AgentHandle.create(testConfig, {});
      const connection = handle.getConnection();

      expect(connection).toBe(mockConnection);
    });
  });
});
