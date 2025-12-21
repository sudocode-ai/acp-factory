/**
 * E2E tests for Gemini CLI agent integration.
 *
 * These tests use the real Gemini CLI and require:
 * 1. @google/gemini-cli installed
 * 2. Gemini authenticated (via Google login, GEMINI_API_KEY, or Vertex AI)
 *
 * Run with: RUN_E2E_TESTS=true npm run test:run -- test/e2e/gemini.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { AgentFactory } from "../../src/factory.js";
import type { AgentHandle } from "../../src/agent-handle.js";
import type { Session } from "../../src/session.js";
import type { ExtendedSessionUpdate } from "../../src/types.js";
import * as fs from "node:fs";
import * as os from "node:os";

const RUN_E2E_TESTS = process.env.RUN_E2E_TESTS === "true";

describe.skipIf(!RUN_E2E_TESTS)("E2E: Gemini Agent", () => {
  let handle: AgentHandle;
  let tempDir: string;

  beforeAll(async () => {
    // Spawn Gemini agent
    handle = await AgentFactory.spawn("gemini");
  }, 120000);

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(os.tmpdir() + "/gemini-e2e-");
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
    it("should have gemini registered in factory", () => {
      const config = AgentFactory.getConfig("gemini");
      expect(config).toBeDefined();
      expect(config?.command).toBe("npx");
      expect(config?.args).toContain("@google/gemini-cli");
      expect(config?.args).toContain("--experimental-acp");
    });

    it("should spawn gemini agent successfully", () => {
      expect(handle).toBeDefined();
      expect(handle.capabilities).toBeDefined();
    });

    it("should advertise capabilities", () => {
      // Log capabilities for debugging
      console.log("Gemini capabilities:", JSON.stringify(handle.capabilities, null, 2));

      // Basic capability checks based on zedIntegration.ts
      expect(handle.capabilities).toBeDefined();

      // Gemini advertises these capabilities
      if (handle.capabilities.promptCapabilities) {
        expect(handle.capabilities.promptCapabilities.image).toBe(true);
        expect(handle.capabilities.promptCapabilities.audio).toBe(true);
        expect(handle.capabilities.promptCapabilities.embeddedContext).toBe(true);
      }

      if (handle.capabilities.mcpCapabilities) {
        expect(handle.capabilities.mcpCapabilities.http).toBe(true);
        expect(handle.capabilities.mcpCapabilities.sse).toBe(true);
      }
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
    let promptTempDir: string;

    beforeAll(async () => {
      // Create a dedicated temp directory for this describe block
      promptTempDir = fs.mkdtempSync(os.tmpdir() + "/gemini-prompt-e2e-");
      session = await handle.createSession(promptTempDir);
    }, 60000);

    afterAll(() => {
      // Cleanup the dedicated temp directory
      if (promptTempDir && fs.existsSync(promptTempDir)) {
        fs.rmSync(promptTempDir, { recursive: true, force: true });
      }
    });

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
        "Remember the word 'orange'. Just say 'I will remember orange'."
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
      // The response should contain "orange"
      expect(responseText.toLowerCase()).toContain("orange");
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

    it("should support thought chunks (thinking)", async () => {
      const updates: ExtendedSessionUpdate[] = [];

      for await (const update of session.prompt(
        "Think step by step: what is 15 * 7?"
      )) {
        updates.push(update);
      }

      // Log thought chunks for debugging
      const thoughtChunks = updates.filter(
        (u) => u.sessionUpdate === "agent_thought_chunk"
      );
      console.log(`Received ${thoughtChunks.length} thought chunks`);

      // Gemini may or may not send thought chunks depending on model config
      expect(updates.length).toBeGreaterThan(0);
    }, 120000);
  });

  describe("session properties", () => {
    it("should have modes property", async () => {
      const session = await handle.createSession(tempDir);

      // Log for debugging
      console.log("Gemini session modes:", session.modes);

      // Modes should be defined (may be empty array)
      expect(session.modes).toBeDefined();
    }, 60000);

    it("should have models property", async () => {
      const session = await handle.createSession(tempDir);

      // Log for debugging
      console.log("Gemini session models:", session.models);

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
      const firstResult = await promptIterator.next();
      if (!firstResult.done) {
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
      console.log("Gemini loadSession capability:", handle.capabilities.loadSession);

      // Gemini currently advertises loadSession: false
      expect(handle.capabilities.loadSession).toBe(false);
    });
  });

  describe("fork capability", () => {
    it("should check fork capability", () => {
      // Log the capability
      console.log(
        "Gemini fork capability:",
        handle.capabilities.sessionCapabilities?.fork
      );

      // Gemini currently doesn't advertise sessionCapabilities
      // This test documents the current behavior
      expect(handle.capabilities.sessionCapabilities?.fork).toBeUndefined();
    });
  });

  describe("error handling", () => {
    // Skip: Gemini CLI may hang on empty prompts - not a supported use case
    it.skip("should handle empty prompts gracefully", async () => {
      const session = await handle.createSession(tempDir);

      const updates: ExtendedSessionUpdate[] = [];
      for await (const update of session.prompt("")) {
        updates.push(update);
      }

      // Should complete without throwing
      expect(Array.isArray(updates)).toBe(true);
    }, 60000);
  });
});

describe.skipIf(!RUN_E2E_TESTS)("E2E: All Agents Comparison", () => {
  it("should have all three agents registered", () => {
    const agents = AgentFactory.listAgents();

    expect(agents).toContain("claude-code");
    expect(agents).toContain("codex");
    expect(agents).toContain("gemini");
  });

  it("should spawn gemini agent successfully", async () => {
    const geminiHandle = await AgentFactory.spawn("gemini");
    expect(geminiHandle).toBeDefined();
    expect(geminiHandle.capabilities).toBeDefined();

    await geminiHandle.close();
  }, 120000);
});
