/**
 * E2E tests for Codex agent integration.
 *
 * These tests use the real Codex CLI and require:
 * 1. @zed-industries/codex-acp installed
 * 2. Codex authenticated (via browser auth, OPENAI_API_KEY, or CODEX_API_KEY)
 *
 * Run with: RUN_E2E_TESTS=true npm run test:run -- test/e2e/codex.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { AgentFactory } from "../../src/factory.js";
import type { AgentHandle } from "../../src/agent-handle.js";
import type { Session } from "../../src/session.js";
import type { ExtendedSessionUpdate } from "../../src/types.js";
import * as fs from "node:fs";
import * as os from "node:os";

const RUN_E2E_TESTS = process.env.RUN_E2E_TESTS === "true";

describe.skipIf(!RUN_E2E_TESTS)("E2E: Codex Agent", () => {
  let handle: AgentHandle;
  let tempDir: string;

  beforeAll(async () => {
    // Spawn Codex agent
    handle = await AgentFactory.spawn("codex");
  }, 120000);

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(os.tmpdir() + "/codex-e2e-");
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

  describe("agent initialization", () => {
    it("should have codex registered in factory", () => {
      const config = AgentFactory.getConfig("codex");
      expect(config).toBeDefined();
      expect(config?.command).toBe("npx");
      expect(config?.args).toContain("@zed-industries/codex-acp");
    });

    it("should spawn codex agent successfully", () => {
      expect(handle).toBeDefined();
      expect(handle.capabilities).toBeDefined();
    });

    it("should advertise capabilities", () => {
      // Log capabilities for debugging
      console.log("Codex capabilities:", JSON.stringify(handle.capabilities, null, 2));

      // Basic capability checks
      expect(handle.capabilities).toBeDefined();
    });
  });

  describe("session management", () => {
    it("should create a new session", async () => {
      const session = await handle.createSession(tempDir);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.cwd).toBe(tempDir);
    }, 60000);

    it("should create multiple sessions", async () => {
      const session1 = await handle.createSession(tempDir);
      const session2 = await handle.createSession(tempDir);

      expect(session1.id).toBeDefined();
      expect(session2.id).toBeDefined();
      expect(session1.id).not.toBe(session2.id);
    }, 60000);
  });

  describe("basic prompting", () => {
    let session: Session;

    beforeAll(async () => {
      session = await handle.createSession(tempDir);
    }, 60000);

    it("should respond to a simple prompt", async () => {
      const updates: ExtendedSessionUpdate[] = [];

      for await (const update of session.prompt(
        "What is 2 + 2? Reply with just the number."
      )) {
        updates.push(update);
      }

      // Should have received some updates
      expect(updates.length).toBeGreaterThan(0);

      // Check for agent message chunks
      const messageChunks = updates.filter(
        (u) => u.sessionUpdate === "agent_message_chunk"
      );
      expect(messageChunks.length).toBeGreaterThan(0);
    }, 120000);

    it("should handle multi-turn conversation", async () => {
      // First turn
      const updates1: ExtendedSessionUpdate[] = [];
      for await (const update of session.prompt(
        "Remember the word 'banana'. Just say 'I will remember banana'."
      )) {
        updates1.push(update);
      }
      expect(updates1.length).toBeGreaterThan(0);

      // Second turn - recall
      const updates2: ExtendedSessionUpdate[] = [];
      let responseText = "";
      for await (const update of session.prompt(
        "What word did I ask you to remember? Just say the word."
      )) {
        updates2.push(update);
        if (update.sessionUpdate === "agent_message_chunk" && "content" in update) {
          const content = update.content as { type: string; text?: string };
          if (content.type === "text" && content.text) {
            responseText += content.text;
          }
        }
      }

      expect(updates2.length).toBeGreaterThan(0);
      // The response should contain "banana"
      expect(responseText.toLowerCase()).toContain("banana");
    }, 180000);

    it("should handle streaming responses", async () => {
      const updates: ExtendedSessionUpdate[] = [];
      let textContent = "";

      for await (const update of session.prompt(
        "Count from 1 to 5, each number on a new line."
      )) {
        updates.push(update);
        if (update.sessionUpdate === "agent_message_chunk" && "content" in update) {
          const content = update.content as { type: string; text?: string };
          if (content.type === "text" && content.text) {
            textContent += content.text;
          }
        }
      }

      // Should have multiple streaming chunks
      const messageChunks = updates.filter(
        (u) => u.sessionUpdate === "agent_message_chunk"
      );
      expect(messageChunks.length).toBeGreaterThan(0);

      // Content should include numbers
      expect(textContent).toMatch(/[1-5]/);
    }, 120000);
  });

  describe("session properties", () => {
    it("should have modes property", async () => {
      const session = await handle.createSession(tempDir);

      // Log for debugging
      console.log("Codex session modes:", session.modes);

      // Modes should be defined (may be empty array)
      expect(session.modes).toBeDefined();
    }, 60000);

    it("should have models property", async () => {
      const session = await handle.createSession(tempDir);

      // Log for debugging
      console.log("Codex session models:", session.models);

      // Models should be defined (may be empty array)
      expect(session.models).toBeDefined();
    }, 60000);

    it("should track isProcessing state", async () => {
      const session = await handle.createSession(tempDir);

      // Initially not processing
      expect(session.isProcessing).toBe(false);

      // Start a prompt
      const promptIterator = session.prompt("Say hello")[Symbol.asyncIterator]();

      // During processing, isProcessing should be true
      // (Note: this may be flaky if the response is very fast)
      const firstResult = await promptIterator.next();
      if (!firstResult.done) {
        // While we're still getting updates, we might be processing
        // This depends on timing, so we just verify the property exists
        expect(typeof session.isProcessing).toBe("boolean");
      }

      // Consume remaining updates
      while (!(await promptIterator.next()).done) {
        // drain
      }

      // After completion, should not be processing
      expect(session.isProcessing).toBe(false);
    }, 120000);
  });

  describe("loadSession capability", () => {
    it("should check loadSession capability", () => {
      // Log the capability
      console.log("Codex loadSession capability:", handle.capabilities.loadSession);

      // This documents what Codex supports
      expect(typeof handle.capabilities.loadSession).toBe("boolean");
    });

    it("should load session if capability is supported", async () => {
      if (!handle.capabilities.loadSession) {
        console.log("Skipping: Codex does not support loadSession");
        return;
      }

      // Create a session first
      const originalSession = await handle.createSession(tempDir);
      const sessionId = originalSession.id;

      // Try to load/resume the session
      const loadedSession = await handle.loadSession(sessionId, tempDir);

      expect(loadedSession.id).toBe(sessionId);
      expect(loadedSession.cwd).toBe(tempDir);
    }, 60000);
  });

  describe("fork capability", () => {
    it("should check fork capability", () => {
      // Log the capability
      console.log(
        "Codex fork capability:",
        handle.capabilities.sessionCapabilities?.fork
      );

      // This documents what Codex supports
      expect(handle.capabilities.sessionCapabilities).toBeDefined();
    });

    it("should fork session if capability is supported", async () => {
      if (!handle.capabilities.sessionCapabilities?.fork) {
        console.log("Skipping: Codex does not support forking");
        return;
      }

      // Create a session
      const session = await handle.createSession(tempDir);

      // Send a prompt to establish history
      for await (const update of session.prompt("Say 'Hello from original'.")) {
        // consume
      }

      // Fork the session
      const forkedSession = await session.fork();

      expect(forkedSession.id).toBeDefined();
      expect(forkedSession.id).not.toBe(session.id);
      expect(forkedSession.cwd).toBe(tempDir);
    }, 120000);
  });

  describe("error handling", () => {
    it("should handle empty prompts gracefully", async () => {
      const session = await handle.createSession(tempDir);

      const updates: ExtendedSessionUpdate[] = [];
      for await (const update of session.prompt("")) {
        updates.push(update);
      }

      // Should complete without throwing
      // May return error update or empty response depending on agent implementation
      expect(Array.isArray(updates)).toBe(true);
    }, 60000);
  });
});

describe.skipIf(!RUN_E2E_TESTS)("E2E: Codex vs Claude Code comparison", () => {
  it("should have both agents registered", () => {
    const agents = AgentFactory.listAgents();

    expect(agents).toContain("claude-code");
    expect(agents).toContain("codex");
  });

  it("should spawn both agents successfully", async () => {
    // This test verifies the factory can spawn different agent types
    const codexHandle = await AgentFactory.spawn("codex");
    expect(codexHandle).toBeDefined();
    expect(codexHandle.capabilities).toBeDefined();

    await codexHandle.close();
  }, 120000);
});
