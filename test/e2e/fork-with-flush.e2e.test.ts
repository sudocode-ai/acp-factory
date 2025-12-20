/**
 * E2E tests for fork-with-flush functionality.
 *
 * These tests verify the complete fork-with-flush workflow including:
 * - Forking idle sessions (immediate)
 * - Forking processing sessions (wait then flush)
 * - Forking with interrupt (timeout then interrupt)
 * - Flush-only checkpoints
 * - Context preservation in forked sessions
 * - Original session continuation after fork
 *
 * Prerequisites:
 * 1. Claude CLI installed and authenticated (`claude auth login`)
 * 2. @sudocode-ai/claude-code-acp available (or use local fork)
 *
 * Run with: RUN_E2E_TESTS=true npm run test:run -- test/e2e/fork-with-flush.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { AgentFactory } from "../../src/factory.js";
import type { AgentHandle } from "../../src/agent-handle.js";
import type { Session } from "../../src/session.js";
import type { ExtendedSessionUpdate } from "../../src/types.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_E2E_TESTS = process.env.RUN_E2E_TESTS === "true";

// Use local fork path for testing before npm publish
const LOCAL_FORK_PATH = resolve(__dirname, "../../references/claude-code-acp-fork");

describe.skipIf(!RUN_E2E_TESTS)("E2E: Fork-with-flush", () => {
  let handle: AgentHandle;
  let tempDir: string;

  beforeAll(async () => {
    // Register local fork for testing (before npm publish)
    AgentFactory.register("claude-code-local", {
      command: "node",
      args: [resolve(LOCAL_FORK_PATH, "dist/index.js")],
      env: {},
    });

    // Use local fork if available, otherwise use published version
    const agentType = process.env.USE_LOCAL_FORK === "true" ? "claude-code-local" : "claude-code";
    handle = await AgentFactory.spawn(agentType);
  }, 120000);

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(os.tmpdir() + "/fork-flush-e2e-");
  });

  afterEach(() => {
    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    if (handle) {
      await handle.close();
    }
  });

  describe("fork idle session", () => {
    it("should fork idle session immediately", async () => {
      // Skip if forking not supported
      if (!handle.capabilities.sessionCapabilities?.fork) {
        console.log("Skipping: Agent does not support forking");
        return;
      }

      // Create a session and send an initial prompt
      const session = await handle.createSession(tempDir);
      expect(session.id).toBeDefined();

      // Send initial prompt to establish history
      const updates: ExtendedSessionUpdate[] = [];
      for await (const update of session.prompt(
        "Say exactly: 'Hello from original session'. Nothing else."
      )) {
        updates.push(update);
      }
      expect(updates.length).toBeGreaterThan(0);

      // Session is now idle (prompt completed)
      expect(session.isProcessing).toBe(false);

      // Fork the idle session using forkWithFlush
      // For idle sessions this should work relatively quickly
      const startTime = Date.now();
      const forkedSession = await session.forkWithFlush({
        idleTimeout: 1000,
        persistTimeout: 10000,
      });
      const elapsed = Date.now() - startTime;

      // Verify fork succeeded
      expect(forkedSession.id).toBeDefined();
      expect(forkedSession.id).not.toBe(session.id);
      expect(forkedSession.cwd).toBe(tempDir);

      // Since session was idle, the operation should be relatively fast
      // (no need to wait for processing to finish)
      console.log(`Fork idle session took ${elapsed}ms`);
    }, 120000);
  });

  describe("fork processing session", () => {
    it("should wait for processing session to become idle", async () => {
      // Skip if forking not supported
      if (!handle.capabilities.sessionCapabilities?.fork) {
        console.log("Skipping: Agent does not support forking");
        return;
      }

      // Create a session
      const session = await handle.createSession(tempDir);
      expect(session.id).toBeDefined();

      // Start a prompt that will take some time to process
      // We'll fork during processing
      let promptComplete = false;
      const promptPromise = (async () => {
        for await (const update of session.prompt(
          "Count from 1 to 5, saying each number on a new line. Be brief."
        )) {
          // Consume updates
        }
        promptComplete = true;
      })();

      // Give the prompt a moment to start processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // The session should be processing now
      // Note: isProcessing might be false if the prompt completed quickly
      // This is expected behavior - the test just verifies forkWithFlush works

      // Fork while the session might still be processing
      const forkedSession = await session.forkWithFlush({
        idleTimeout: 15000, // Long timeout to wait for processing
        persistTimeout: 10000,
      });

      // Verify fork succeeded
      expect(forkedSession.id).toBeDefined();
      expect(forkedSession.id).not.toBe(session.id);

      // Wait for original prompt to complete (may already be done)
      await promptPromise;
      expect(promptComplete).toBe(true);
    }, 180000);
  });

  describe("fork with interrupt", () => {
    it("should interrupt and flush after timeout", async () => {
      // Skip if forking not supported
      if (!handle.capabilities.sessionCapabilities?.fork) {
        console.log("Skipping: Agent does not support forking");
        return;
      }

      // Create a session
      const session = await handle.createSession(tempDir);
      expect(session.id).toBeDefined();

      // Start a prompt that will take a long time
      // Use a task that Claude will work on for a while
      const promptPromise = (async () => {
        try {
          for await (const update of session.prompt(
            "Write a very long essay about the history of computing. Make it at least 500 words."
          )) {
            // Consume updates
          }
        } catch {
          // Expected - prompt may be cancelled during fork
        }
      })();

      // Give the prompt time to start processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Fork with a short idle timeout - this should trigger interrupt
      const startTime = Date.now();
      const forkedSession = await session.forkWithFlush({
        idleTimeout: 500, // Very short - will trigger interrupt
        persistTimeout: 10000,
      });
      const elapsed = Date.now() - startTime;

      // Verify fork succeeded
      expect(forkedSession.id).toBeDefined();
      expect(forkedSession.id).not.toBe(session.id);

      // The fork should have happened after the idle timeout triggered an interrupt
      // It shouldn't have waited forever
      console.log(`Fork with interrupt took ${elapsed}ms`);
      expect(elapsed).toBeLessThan(60000); // Should complete within a reasonable time

      // Clean up the prompt
      await promptPromise;
    }, 180000);
  });

  describe("flush checkpoint", () => {
    it("should create checkpoint with flushSession()", async () => {
      // Create a session
      const session = await handle.createSession(tempDir);
      expect(session.id).toBeDefined();

      // Send a prompt to establish history
      for await (const update of session.prompt(
        "Remember the secret code: ALPHA-7. Just acknowledge this briefly."
      )) {
        // Consume updates
      }

      // Flush the session to create a checkpoint
      const result = await session.flush({
        idleTimeout: 5000,
        persistTimeout: 10000,
      });

      // Verify flush succeeded
      expect(result.success).toBe(true);
      expect(result.filePath).toBeDefined();

      // Verify the session file exists on disk
      if (result.filePath) {
        expect(fs.existsSync(result.filePath)).toBe(true);
        const stats = fs.statSync(result.filePath);
        expect(stats.size).toBeGreaterThan(0);
      }
    }, 120000);

    it("should allow subsequent prompts after flush", async () => {
      // Create a session
      const session = await handle.createSession(tempDir);

      // Send initial prompt
      for await (const update of session.prompt("Say 'First message received'. Nothing else.")) {
        // Consume updates
      }

      // Flush to checkpoint
      const flushResult = await session.flush({
        idleTimeout: 5000,
        persistTimeout: 10000,
      });
      expect(flushResult.success).toBe(true);

      // Session should still be usable after flush
      const updates: ExtendedSessionUpdate[] = [];
      for await (const update of session.prompt("Say 'Second message received'. Nothing else.")) {
        updates.push(update);
      }

      // Verify we got a response
      expect(updates.length).toBeGreaterThan(0);
    }, 120000);
  });

  describe("context preservation", () => {
    it("should preserve context in forked session", async () => {
      // Skip if forking not supported
      if (!handle.capabilities.sessionCapabilities?.fork) {
        console.log("Skipping: Agent does not support forking");
        return;
      }

      // Create a session
      const session = await handle.createSession(tempDir);

      // Establish a memorable fact in the original session
      const secretNumber = Math.floor(Math.random() * 9000) + 1000;
      for await (const update of session.prompt(
        `Remember this exact number: ${secretNumber}. Just say 'I will remember ${secretNumber}'.`
      )) {
        // Consume updates
      }

      // Fork the session
      const forkedSession = await session.forkWithFlush({
        idleTimeout: 5000,
        persistTimeout: 10000,
      });

      expect(forkedSession.id).toBeDefined();
      expect(forkedSession.id).not.toBe(session.id);

      // Ask the forked session to recall the number
      let recalledText = "";
      for await (const update of forkedSession.prompt(
        "What was the number I asked you to remember? Just say the number, nothing else."
      )) {
        if (update.sessionUpdate === "agent_message_chunk" && "content" in update) {
          const content = update.content as { type: string; text?: string };
          if (content.type === "text" && content.text) {
            recalledText += content.text;
          }
        }
      }

      // The forked session should have the context from before the fork
      // Check if the secret number appears in the response
      console.log(`Forked session recalled: "${recalledText.trim()}"`);
      expect(recalledText).toContain(String(secretNumber));
    }, 180000);
  });

  describe("original session continuation", () => {
    it("should allow original session to continue after fork", async () => {
      // Skip if forking not supported
      if (!handle.capabilities.sessionCapabilities?.fork) {
        console.log("Skipping: Agent does not support forking");
        return;
      }

      // Create a session
      const session = await handle.createSession(tempDir);

      // Send initial prompt
      for await (const update of session.prompt(
        "Say 'Original session initialized'. Nothing else."
      )) {
        // Consume updates
      }

      // Fork the session
      const forkedSession = await session.forkWithFlush({
        idleTimeout: 5000,
        persistTimeout: 10000,
      });

      expect(forkedSession.id).toBeDefined();
      expect(forkedSession.id).not.toBe(session.id);

      // The original session should continue to work
      const originalUpdates: ExtendedSessionUpdate[] = [];
      for await (const update of session.prompt(
        "Say 'Original session still working'. Nothing else."
      )) {
        originalUpdates.push(update);
      }

      // Verify original session got a response
      expect(originalUpdates.length).toBeGreaterThan(0);

      // Use the forked session too - both should work independently
      const forkedUpdates: ExtendedSessionUpdate[] = [];
      for await (const update of forkedSession.prompt(
        "Say 'Forked session is working'. Nothing else."
      )) {
        forkedUpdates.push(update);
      }

      // Verify forked session got a response
      expect(forkedUpdates.length).toBeGreaterThan(0);
    }, 180000);

    it("should maintain independent state between original and forked sessions", async () => {
      // Skip if forking not supported
      if (!handle.capabilities.sessionCapabilities?.fork) {
        console.log("Skipping: Agent does not support forking");
        return;
      }

      // Create a session
      const session = await handle.createSession(tempDir);

      // Establish common history
      for await (const update of session.prompt(
        "Remember: The shared value is BEFORE_FORK. Just acknowledge."
      )) {
        // Consume updates
      }

      // Fork the session
      const forkedSession = await session.forkWithFlush({
        idleTimeout: 5000,
        persistTimeout: 10000,
      });

      // Update original session with new info
      for await (const update of session.prompt(
        "Update: Change the value to ORIGINAL_ONLY. Just acknowledge."
      )) {
        // Consume updates
      }

      // Update forked session with different info
      for await (const update of forkedSession.prompt(
        "Update: Change the value to FORKED_ONLY. Just acknowledge."
      )) {
        // Consume updates
      }

      // Verify original session has its own state
      let originalRecall = "";
      for await (const update of session.prompt(
        "What is the current value? Just say the value, nothing else."
      )) {
        if (update.sessionUpdate === "agent_message_chunk" && "content" in update) {
          const content = update.content as { type: string; text?: string };
          if (content.type === "text" && content.text) {
            originalRecall += content.text;
          }
        }
      }
      expect(originalRecall).toContain("ORIGINAL_ONLY");

      // Verify forked session has its own state
      let forkedRecall = "";
      for await (const update of forkedSession.prompt(
        "What is the current value? Just say the value, nothing else."
      )) {
        if (update.sessionUpdate === "agent_message_chunk" && "content" in update) {
          const content = update.content as { type: string; text?: string };
          if (content.type === "text" && content.text) {
            forkedRecall += content.text;
          }
        }
      }
      expect(forkedRecall).toContain("FORKED_ONLY");
    }, 240000);
  });

  describe("edge cases", () => {
    it("should handle multiple consecutive forks", async () => {
      // Skip if forking not supported
      if (!handle.capabilities.sessionCapabilities?.fork) {
        console.log("Skipping: Agent does not support forking");
        return;
      }

      // Create a session
      const session = await handle.createSession(tempDir);

      // Send initial prompt
      for await (const update of session.prompt("Say 'Ready for forking'. Nothing else.")) {
        // Consume updates
      }

      // Fork multiple times
      const forks: Session[] = [];
      for (let i = 0; i < 3; i++) {
        const forked = await session.forkWithFlush({
          idleTimeout: 5000,
          persistTimeout: 10000,
        });
        forks.push(forked);
      }

      // Verify all forks have unique IDs
      const ids = new Set(forks.map(f => f.id));
      expect(ids.size).toBe(3);

      // All forks should be different from original
      for (const fork of forks) {
        expect(fork.id).not.toBe(session.id);
      }

      // All forks should have the same cwd
      for (const fork of forks) {
        expect(fork.cwd).toBe(tempDir);
      }
    }, 240000);

    it("should handle fork of a forked session (chain forking)", async () => {
      // Chain forking works by:
      // 1. Extracting the internal UUID sessionId from the agent-xxx.jsonl file
      // 2. Renaming the file to match the internal sessionId
      // 3. Promoting the sidechain to a full session (changing isSidechain: true to false)
      //
      // Skip if forking not supported
      if (!handle.capabilities.sessionCapabilities?.fork) {
        console.log("Skipping: Agent does not support forking");
        return;
      }

      // Create and initialize original session
      const session = await handle.createSession(tempDir);
      for await (const update of session.prompt("Say 'Generation 0'. Nothing else.")) {
        // Consume updates
      }

      // First fork
      const fork1 = await session.forkWithFlush({
        idleTimeout: 5000,
        persistTimeout: 10000,
      });
      expect(fork1.id).not.toBe(session.id);

      // Second fork (fork of the fork)
      const fork2 = await fork1.forkWithFlush({
        idleTimeout: 5000,
        persistTimeout: 10000,
      });
      expect(fork2.id).not.toBe(fork1.id);
      expect(fork2.id).not.toBe(session.id);

      // All three sessions should work
      for (const s of [session, fork1, fork2]) {
        const updates: ExtendedSessionUpdate[] = [];
        for await (const update of s.prompt("Say 'Session active'. Nothing else.")) {
          updates.push(update);
        }
        expect(updates.length).toBeGreaterThan(0);
      }
    }, 240000);
  });
});
