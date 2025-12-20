/**
 * Tests for fork-with-flush helper methods in Session class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Session } from "../src/session.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("Fork-with-flush helpers", () => {
  let mockConnection: {
    prompt: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    loadSession: ReturnType<typeof vi.fn> | undefined;
  };
  let mockClientHandler: {
    getSessionStream: ReturnType<typeof vi.fn>;
    endSessionStream: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockConnection = {
      prompt: vi.fn(),
      cancel: vi.fn().mockResolvedValue({}),
      loadSession: vi.fn().mockResolvedValue({
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
      getSessionStream: vi.fn(),
      endSessionStream: vi.fn(),
    };
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

    it("should handle paths with special characters", () => {
      // Create directory with underscore to test _ replacement
      const specialDir = path.join(testTempDir, "my_project", "src");
      fs.mkdirSync(specialDir, { recursive: true });

      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        specialDir
      );

      const filePath = session.getSessionFilePath("test-session");
      const homeDir = os.homedir();
      const realPath = fs.realpathSync(specialDir);
      const expectedHash = realPath.replace(/[/_]/g, "-");

      expect(filePath).toBe(`${homeDir}/.claude/projects/${expectedHash}/test-session.jsonl`);
    });
  });

  describe("waitForIdle", () => {
    it("should return true immediately when session is not processing", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      // Session starts with isProcessing = false
      expect(session.isProcessing).toBe(false);

      const result = await session.waitForIdle(1000);

      expect(result).toBe(true);
    });

    it("should return true when session becomes idle before timeout", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      // Manually set isProcessing to simulate an active session
      session.isProcessing = true;

      // Set isProcessing to false after 150ms
      setTimeout(() => {
        session.isProcessing = false;
      }, 150);

      const start = Date.now();
      const result = await session.waitForIdle(1000);
      const elapsed = Date.now() - start;

      expect(result).toBe(true);
      // Should have waited at least 100ms (one poll interval) but less than timeout
      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(elapsed).toBeLessThan(1000);
    });

    it("should return false when timeout expires", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      // Session is actively processing
      session.isProcessing = true;

      const start = Date.now();
      const result = await session.waitForIdle(300);
      const elapsed = Date.now() - start;

      expect(result).toBe(false);
      // Should have waited approximately the timeout duration
      expect(elapsed).toBeGreaterThanOrEqual(300);
      expect(elapsed).toBeLessThan(500); // Allow some tolerance
    });

    it("should respect custom timeout values", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      session.isProcessing = true;

      const start = Date.now();
      await session.waitForIdle(200);
      const elapsed = Date.now() - start;

      // Should wait approximately 200ms (within tolerance)
      expect(elapsed).toBeGreaterThanOrEqual(200);
      expect(elapsed).toBeLessThan(400);
    });

    it("should use default timeout of 5000ms when not specified", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      // Not processing, so should return immediately regardless of default timeout
      const result = await session.waitForIdle();

      expect(result).toBe(true);
    });
  });

  describe("waitForPersistence", () => {
    let tempDir: string;

    beforeEach(() => {
      // Create a temp directory for test files
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-flush-test-"));
    });

    afterEach(() => {
      // Cleanup temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should return true when file appears before timeout", async () => {
      // Use the temp directory as cwd so the session file path is predictable
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        tempDir
      );

      const sessionId = "test-session";
      const filePath = session.getSessionFilePath(sessionId);

      // Create parent directory
      const parentDir = path.dirname(filePath);
      fs.mkdirSync(parentDir, { recursive: true });

      // Create the file after 150ms
      setTimeout(() => {
        fs.writeFileSync(filePath, '{"test": true}\n');
      }, 150);

      const start = Date.now();
      const result = await session.waitForPersistence(sessionId, 2000);
      const elapsed = Date.now() - start;

      expect(result).toBe(true);
      // Should have waited at least 100ms (one poll) but less than timeout
      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(elapsed).toBeLessThan(2000);

      // Cleanup
      fs.rmSync(parentDir, { recursive: true, force: true });
    });

    it("should return true immediately when file already exists", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        tempDir
      );

      const sessionId = "existing-session";
      const filePath = session.getSessionFilePath(sessionId);

      // Create parent directory and file before calling waitForPersistence
      const parentDir = path.dirname(filePath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(filePath, '{"existing": true}\n');

      const start = Date.now();
      const result = await session.waitForPersistence(sessionId, 1000);
      const elapsed = Date.now() - start;

      expect(result).toBe(true);
      // Should return almost immediately (within one poll interval)
      expect(elapsed).toBeLessThan(150);

      // Cleanup
      fs.rmSync(parentDir, { recursive: true, force: true });
    });

    it("should return false when timeout expires", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        tempDir
      );

      const sessionId = "nonexistent-session";

      const start = Date.now();
      const result = await session.waitForPersistence(sessionId, 300);
      const elapsed = Date.now() - start;

      expect(result).toBe(false);
      // Should have waited approximately the timeout duration
      expect(elapsed).toBeGreaterThanOrEqual(300);
      expect(elapsed).toBeLessThan(500);
    });

    it("should handle missing session file gracefully", async () => {
      // Use a real temp directory but with a nonexistent session file
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        tempDir
      );

      const sessionId = "missing-session-file";

      // Should not throw, just return false after timeout
      // The session file doesn't exist but the cwd is valid
      const result = await session.waitForPersistence(sessionId, 200);

      expect(result).toBe(false);
    });

    it("should respect custom timeout values", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        tempDir
      );

      const sessionId = "timeout-test-session";

      const start = Date.now();
      await session.waitForPersistence(sessionId, 250);
      const elapsed = Date.now() - start;

      // Should wait approximately 250ms (within tolerance)
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(450);
    });

    it("should use default timeout of 5000ms when not specified", async () => {
      const session = new Session(
        "test-id",
        mockConnection as any,
        mockClientHandler as any,
        tempDir
      );

      const sessionId = "default-timeout-session";
      const filePath = session.getSessionFilePath(sessionId);

      // Create parent directory and file immediately
      const parentDir = path.dirname(filePath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(filePath, '{"immediate": true}\n');

      // Should return immediately since file exists
      const result = await session.waitForPersistence(sessionId);

      expect(result).toBe(true);

      // Cleanup
      fs.rmSync(parentDir, { recursive: true, force: true });
    });
  });

  describe("restartSession", () => {
    it("should create new session with same sessionId via loadSession", async () => {
      const session = new Session(
        "session-to-restart",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd",
        ["code"],
        ["claude-3"]
      );

      const restartedSession = await session.restartSession();

      expect(mockConnection.loadSession).toHaveBeenCalledWith({
        sessionId: "session-to-restart",
        cwd: "/test/cwd",
        mcpServers: [],
      });
      expect(restartedSession.id).toBe("session-to-restart");
      expect(restartedSession.cwd).toBe("/test/cwd");
    });

    it("should preserve session settings from loadSession response", async () => {
      mockConnection.loadSession = vi.fn().mockResolvedValue({
        modes: {
          availableModes: [{ id: "code" }, { id: "ask" }, { id: "architect" }],
          currentModeId: "code",
        },
        models: {
          availableModels: [{ modelId: "claude-4" }, { modelId: "claude-3" }],
          currentModelId: "claude-4",
        },
      });

      const session = new Session(
        "test-session",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd",
        ["code"],
        ["claude-3"]
      );

      const restartedSession = await session.restartSession();

      expect(restartedSession.modes).toEqual(["code", "ask", "architect"]);
      expect(restartedSession.models).toEqual(["claude-4", "claude-3"]);
    });

    it("should fall back to original modes/models when loadSession returns null", async () => {
      mockConnection.loadSession = vi.fn().mockResolvedValue({
        modes: null,
        models: null,
      });

      const session = new Session(
        "test-session",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd",
        ["original-mode"],
        ["original-model"]
      );

      const restartedSession = await session.restartSession();

      expect(restartedSession.modes).toEqual(["original-mode"]);
      expect(restartedSession.models).toEqual(["original-model"]);
    });

    it("should reset isProcessing flag on restarted session", async () => {
      const session = new Session(
        "test-session",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      // Simulate that the session was processing before restart
      session.isProcessing = true;

      const restartedSession = await session.restartSession();

      // The restarted session should have isProcessing = false (default)
      expect(restartedSession.isProcessing).toBe(false);
    });

    it("should throw if agent does not support loadSession", async () => {
      mockConnection.loadSession = undefined;

      const session = new Session(
        "test-session",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      await expect(session.restartSession()).rejects.toThrow(
        "Agent does not support restarting sessions"
      );
    });

    it("should propagate loadSession errors", async () => {
      mockConnection.loadSession = vi.fn().mockRejectedValue(new Error("Load failed"));

      const session = new Session(
        "test-session",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      await expect(session.restartSession()).rejects.toThrow("Load failed");
    });

    it("should return a new Session instance", async () => {
      const session = new Session(
        "test-session",
        mockConnection as any,
        mockClientHandler as any,
        "/test/cwd"
      );

      const restartedSession = await session.restartSession();

      // Should be a new instance, not the same object
      expect(restartedSession).not.toBe(session);
      expect(restartedSession).toBeInstanceOf(Session);
    });
  });

  describe("forkWithFlush", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-with-flush-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should throw if agent does not support forking", async () => {
      const connectionWithoutFork = {
        ...mockConnection,
        unstable_forkSession: undefined,
      };

      const session = new Session(
        "test-session",
        connectionWithoutFork as any,
        mockClientHandler as any,
        tempDir
      );

      await expect(session.forkWithFlush()).rejects.toThrow(
        "Agent does not support forking sessions"
      );
    });

    it("should wait for idle before flushing", async () => {
      const filePath = path.join(os.homedir(), ".claude", "projects", tempDir.replace(/[/_]/g, "-"), "test-session.jsonl");
      const extMethodMock = vi.fn().mockResolvedValue({ success: true, filePath });
      const connectionWithFork = {
        ...mockConnection,
        unstable_forkSession: vi.fn().mockResolvedValue({
          sessionId: "forked-session",
          modes: { availableModes: [{ id: "code" }], currentModeId: "code" },
          models: { availableModels: [{ modelId: "claude-3" }], currentModelId: "claude-3" },
        }),
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithFork as any,
        mockClientHandler as any,
        tempDir
      );

      // Session is not processing
      expect(session.isProcessing).toBe(false);

      const forkedSession = await session.forkWithFlush({ idleTimeout: 100 });

      expect(extMethodMock).toHaveBeenCalledWith("_session/flush", {
        sessionId: "test-session",
        idleTimeout: 100,
        persistTimeout: 5000,
      });
      expect(forkedSession.id).toBe("forked-session");
    });

    it("should cancel and wait if session is processing after idle timeout", async () => {
      const cancelMock = vi.fn().mockResolvedValue({});
      const filePath = path.join(os.homedir(), ".claude", "projects", tempDir.replace(/[/_]/g, "-"), "test-session.jsonl");
      const extMethodMock = vi.fn().mockResolvedValue({ success: true, filePath });
      const connectionWithFork = {
        ...mockConnection,
        cancel: cancelMock,
        unstable_forkSession: vi.fn().mockResolvedValue({
          sessionId: "forked-session",
          modes: { availableModes: [{ id: "code" }], currentModeId: "code" },
          models: { availableModels: [{ modelId: "claude-3" }], currentModelId: "claude-3" },
        }),
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithFork as any,
        mockClientHandler as any,
        tempDir
      );

      // Simulate session is processing
      session.isProcessing = true;

      const start = Date.now();
      await session.forkWithFlush({ idleTimeout: 100 });
      const elapsed = Date.now() - start;

      // Should have called cancel since session was processing
      expect(cancelMock).toHaveBeenCalledWith({ sessionId: "test-session" });
      // Should have waited at least the idle timeout + cancel settle time
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it("should throw if persistence times out", async () => {
      // Agent returns failure when persistence times out
      const extMethodMock = vi.fn().mockResolvedValue({ success: false, error: "Timeout waiting for persistence" });
      const connectionWithFork = {
        ...mockConnection,
        unstable_forkSession: vi.fn().mockResolvedValue({
          sessionId: "forked-session",
          modes: { availableModes: [{ id: "code" }], currentModeId: "code" },
          models: { availableModels: [{ modelId: "claude-3" }], currentModelId: "claude-3" },
        }),
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithFork as any,
        mockClientHandler as any,
        tempDir
      );

      await expect(session.forkWithFlush({ idleTimeout: 100, persistTimeout: 200 })).rejects.toThrow(
        "Timeout waiting for persistence"
      );
    });

    it("should restart original session and return forked session", async () => {
      const filePath = path.join(os.homedir(), ".claude", "projects", tempDir.replace(/[/_]/g, "-"), "original-session.jsonl");
      const extMethodMock = vi.fn().mockResolvedValue({ success: true, filePath });
      const connectionWithFork = {
        ...mockConnection,
        unstable_forkSession: vi.fn().mockResolvedValue({
          sessionId: "forked-session-123",
          modes: { availableModes: [{ id: "code" }, { id: "ask" }], currentModeId: "code" },
          models: { availableModels: [{ modelId: "claude-4" }], currentModelId: "claude-4" },
        }),
        extMethod: extMethodMock,
      };

      const session = new Session(
        "original-session",
        connectionWithFork as any,
        mockClientHandler as any,
        tempDir
      );

      const forkedSession = await session.forkWithFlush();

      // Should have called loadSession to restart original
      expect(mockConnection.loadSession).toHaveBeenCalledWith({
        sessionId: "original-session",
        cwd: tempDir,
        mcpServers: [],
      });

      // Should have called unstable_forkSession
      expect(connectionWithFork.unstable_forkSession).toHaveBeenCalledWith({
        sessionId: "original-session",
        cwd: tempDir,
      });

      // Forked session should have correct properties
      expect(forkedSession.id).toBe("forked-session-123");
      expect(forkedSession.cwd).toBe(tempDir);
      expect(forkedSession.modes).toEqual(["code", "ask"]);
      expect(forkedSession.models).toEqual(["claude-4"]);
    });

    it("should use default timeouts when not specified", async () => {
      // Agent returns success with filePath
      const filePath = path.join(os.homedir(), ".claude", "projects", tempDir.replace(/[/_]/g, "-"), "test-session.jsonl");
      const extMethodMock = vi.fn().mockResolvedValue({ success: true, filePath });
      const connectionWithFork = {
        ...mockConnection,
        unstable_forkSession: vi.fn().mockResolvedValue({
          sessionId: "forked-session",
          modes: null,
          models: null,
        }),
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithFork as any,
        mockClientHandler as any,
        tempDir
      );

      // Should complete without error using default timeouts
      const forkedSession = await session.forkWithFlush();

      expect(forkedSession.id).toBe("forked-session");
      // Empty arrays when modes/models are null
      expect(forkedSession.modes).toEqual([]);
      expect(forkedSession.models).toEqual([]);
    });

    it("should propagate flush extension method errors", async () => {
      const extMethodMock = vi.fn().mockRejectedValue(new Error("Flush extension not supported"));
      const connectionWithFork = {
        ...mockConnection,
        unstable_forkSession: vi.fn(),
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithFork as any,
        mockClientHandler as any,
        tempDir
      );

      await expect(session.forkWithFlush()).rejects.toThrow("Flush extension not supported");
    });

    it("should propagate fork errors after successful flush", async () => {
      // Agent returns success with filePath
      const filePath = path.join(os.homedir(), ".claude", "projects", tempDir.replace(/[/_]/g, "-"), "test-session.jsonl");
      const extMethodMock = vi.fn().mockResolvedValue({ success: true, filePath });
      const connectionWithFork = {
        ...mockConnection,
        unstable_forkSession: vi.fn().mockRejectedValue(new Error("Fork failed")),
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithFork as any,
        mockClientHandler as any,
        tempDir
      );

      await expect(session.forkWithFlush()).rejects.toThrow("Fork failed");
    });
  });

  describe("flush", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flush-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should pass timeout options to extension method", async () => {
      // Agent handles persistence and returns success
      const filePath = path.join(os.homedir(), ".claude", "projects", tempDir.replace(/[/_]/g, "-"), "test-session.jsonl");
      const extMethodMock = vi.fn().mockResolvedValue({ success: true, filePath });
      const connectionWithExtMethod = {
        ...mockConnection,
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithExtMethod as any,
        mockClientHandler as any,
        tempDir
      );

      await session.flush({ idleTimeout: 1000, persistTimeout: 2000 });

      expect(extMethodMock).toHaveBeenCalledWith("_session/flush", {
        sessionId: "test-session",
        idleTimeout: 1000,
        persistTimeout: 2000,
      });
    });

    it("should use default timeouts when not specified", async () => {
      // Agent handles persistence and returns success
      const filePath = path.join(os.homedir(), ".claude", "projects", tempDir.replace(/[/_]/g, "-"), "test-session.jsonl");
      const extMethodMock = vi.fn().mockResolvedValue({ success: true, filePath });
      const connectionWithExtMethod = {
        ...mockConnection,
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithExtMethod as any,
        mockClientHandler as any,
        tempDir
      );

      await session.flush();

      expect(extMethodMock).toHaveBeenCalledWith("_session/flush", {
        sessionId: "test-session",
        idleTimeout: 5000,
        persistTimeout: 5000,
      });
    });

    it("should return success with filePath on successful flush", async () => {
      // Agent handles persistence and returns success with filePath
      const filePath = path.join(os.homedir(), ".claude", "projects", tempDir.replace(/[/_]/g, "-"), "test-session.jsonl");
      const extMethodMock = vi.fn().mockResolvedValue({ success: true, filePath });
      const connectionWithExtMethod = {
        ...mockConnection,
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithExtMethod as any,
        mockClientHandler as any,
        tempDir
      );

      const result = await session.flush();

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(filePath);
      expect(result.error).toBeUndefined();
    });

    it("should return failure with error when persistence times out", async () => {
      // Agent returns failure when persistence times out
      const extMethodMock = vi.fn().mockResolvedValue({ success: false, error: "Timeout waiting for persistence" });
      const connectionWithExtMethod = {
        ...mockConnection,
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithExtMethod as any,
        mockClientHandler as any,
        tempDir
      );

      const result = await session.flush({ persistTimeout: 200 });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Timeout waiting for persistence");
    });

    it("should return failure with error when extension method throws", async () => {
      const extMethodMock = vi.fn().mockRejectedValue(new Error("Extension not supported"));
      const connectionWithExtMethod = {
        ...mockConnection,
        extMethod: extMethodMock,
      };

      const session = new Session(
        "test-session",
        connectionWithExtMethod as any,
        mockClientHandler as any,
        tempDir
      );

      const result = await session.flush();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Extension not supported");
    });
  });
});
