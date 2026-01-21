/**
 * E2E tests for GitHub Copilot CLI agent integration.
 *
 * These tests use the real GitHub Copilot CLI and require:
 * 1. @github/copilot installed
 * 2. Copilot authenticated (via GitHub)
 *
 * Note: Copilot CLI ACP support is currently in early/iterative stage.
 * Some capabilities may not be fully implemented yet.
 *
 * Run with: RUN_E2E_TESTS=true npm run test:run -- test/e2e/copilot-cli.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { AgentFactory } from "../../src/factory.js";
import type { AgentHandle } from "../../src/agent-handle.js";
import type { Session } from "../../src/session.js";
import type { ExtendedSessionUpdate } from "../../src/types.js";
import * as fs from "node:fs";
import * as os from "node:os";

const RUN_E2E_TESTS = process.env.RUN_E2E_TESTS === "true";

describe.skipIf(!RUN_E2E_TESTS)("E2E: Copilot CLI Agent", () => {
  let handle: AgentHandle;
  let tempDir: string;

  beforeAll(async () => {
    // Spawn Copilot CLI agent
    handle = await AgentFactory.spawn("copilot-cli");
  }, 120000);

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(os.tmpdir() + "/copilot-cli-e2e-");
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
    it("should have copilot-cli registered in factory", () => {
      const config = AgentFactory.getConfig("copilot-cli");
      expect(config).toBeDefined();
      expect(config?.command).toBe("npx");
      expect(config?.args).toContain("@github/copilot");
      expect(config?.args).toContain("--acp");
    });

    it("should spawn copilot-cli agent successfully", () => {
      expect(handle).toBeDefined();
      expect(handle.capabilities).toBeDefined();
    });

    it("should advertise capabilities", () => {
      // Log capabilities for debugging
      console.log("Copilot CLI capabilities:", JSON.stringify(handle.capabilities, null, 2));

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
    let promptTempDir: string;

    beforeAll(async () => {
      // Create a dedicated temp directory for this describe block
      promptTempDir = fs.mkdtempSync(os.tmpdir() + "/copilot-cli-prompt-e2e-");
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
        "Remember the word 'apple'. Just say 'I will remember apple'."
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
      // The response should contain "apple"
      expect(responseText.toLowerCase()).toContain("apple");
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
      console.log("Copilot CLI session modes:", session.modes);

      // Modes should be defined (may be empty array)
      expect(session.modes).toBeDefined();
    }, 60000);

    it("should have models property", async () => {
      const session = await handle.createSession(tempDir);

      // Log for debugging
      console.log("Copilot CLI session models:", session.models);

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
      console.log("Copilot CLI loadSession capability:", handle.capabilities.loadSession);

      // This documents what Copilot CLI supports
      expect(typeof handle.capabilities.loadSession).toBe("boolean");
    });

    it("should load session if capability is supported", async () => {
      if (!handle.capabilities.loadSession) {
        console.log("Skipping: Copilot CLI does not support loadSession");
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
        "Copilot CLI fork capability:",
        handle.capabilities.sessionCapabilities?.fork
      );

      // This documents what Copilot CLI supports
      // May or may not have sessionCapabilities depending on implementation
      expect(handle.capabilities).toBeDefined();
    });

    it("should fork session if capability is supported", async () => {
      if (!handle.capabilities.sessionCapabilities?.fork) {
        console.log("Skipping: Copilot CLI does not support forking");
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
      expect(Array.isArray(updates)).toBe(true);
    }, 60000);
  });

  describe("advanced features", () => {
    describe("message injection", () => {
      it("should check inject support", async () => {
        const session = await handle.createSession(tempDir);

        const supportsInject = await session.checkInjectSupport();
        console.log("Copilot CLI inject support:", supportsInject);

        // Document whether inject is supported
        expect(typeof supportsInject).toBe("boolean");
      }, 60000);

      it("should test inject if supported", async () => {
        const session = await handle.createSession(tempDir);

        const supportsInject = await session.checkInjectSupport();
        if (!supportsInject) {
          console.log("Skipping: Copilot CLI does not support inject");
          return;
        }

        // Send initial prompt
        for await (const update of session.prompt("Say hello")) {
          // consume
        }

        // Try to inject a message
        const result = await session.inject("Remember this: the secret word is 'purple'");
        console.log("Inject result:", result);

        expect(result.success).toBe(true);

        // Verify in next prompt
        let responseText = "";
        for await (const update of session.prompt("What was the secret word I mentioned?")) {
          if (update.sessionUpdate === "agent_message_chunk" && "content" in update) {
            const content = update.content as { type: string; text?: string };
            if (content.type === "text" && content.text) {
              responseText += content.text;
            }
          }
        }

        expect(responseText.toLowerCase()).toContain("purple");
      }, 180000);
    });

    describe("interruption", () => {
      it("should support cancel operation", async () => {
        const session = await handle.createSession(tempDir);

        // Start a prompt
        const promptIterator = session.prompt(
          "Count slowly from 1 to 100, saying each number on its own line"
        )[Symbol.asyncIterator]();

        // Get a few updates
        await promptIterator.next();

        // Cancel
        await session.cancel();

        // Should be able to cancel without error
        expect(true).toBe(true);
      }, 60000);

      it("should support interruptWith for mid-execution redirection", async () => {
        const session = await handle.createSession(tempDir);

        // Start a prompt
        const promptIterator = session.prompt(
          "Count slowly from 1 to 100, saying each number"
        )[Symbol.asyncIterator]();

        // Get first update
        await promptIterator.next();

        // Interrupt with new context
        let responseText = "";
        for await (const update of session.interruptWith(
          "Stop counting. Just say 'Interrupted successfully'."
        )) {
          if (update.sessionUpdate === "agent_message_chunk" && "content" in update) {
            const content = update.content as { type: string; text?: string };
            if (content.type === "text" && content.text) {
              responseText += content.text;
            }
          }
        }

        console.log("Interrupt response:", responseText);
        // Should have gotten a response from the interrupted prompt
        expect(responseText.length).toBeGreaterThan(0);
      }, 120000);
    });

    describe("compaction", () => {
      it("should check compaction support", async () => {
        const session = await handle.createSession(tempDir);

        let supportsCompaction = false;
        let errorMessage = "";

        try {
          await session.setCompaction({
            enabled: true,
            contextTokenThreshold: 50000,
          });
          supportsCompaction = true;
        } catch (error) {
          errorMessage = String(error);
          supportsCompaction = false;
        }

        console.log("Copilot CLI compaction support:", supportsCompaction);
        if (!supportsCompaction) {
          console.log("Compaction error:", errorMessage);
        }

        // Document whether compaction is supported
        expect(typeof supportsCompaction).toBe("boolean");
      }, 60000);
    });

    describe("flush", () => {
      it("should check flush support", async () => {
        const session = await handle.createSession(tempDir);

        // Send a prompt first so there's something to flush
        for await (const update of session.prompt("Say hello")) {
          // consume
        }

        const result = await session.flush();
        console.log("Copilot CLI flush result:", result);

        // Document whether flush is supported
        expect(typeof result.success).toBe("boolean");
        if (!result.success) {
          console.log("Flush error:", result.error);
        }
      }, 60000);
    });

    describe("MCP capabilities", () => {
      it("should check MCP server support", () => {
        console.log("Copilot CLI MCP capabilities:", handle.capabilities.mcpCapabilities);

        // Document MCP support
        expect(handle.capabilities).toBeDefined();
      });
    });

    describe("prompt capabilities", () => {
      it("should document all prompt capabilities", () => {
        console.log("Copilot CLI prompt capabilities:", JSON.stringify(handle.capabilities.promptCapabilities, null, 2));

        // Verify known capabilities from earlier test
        if (handle.capabilities.promptCapabilities) {
          expect(handle.capabilities.promptCapabilities.image).toBe(true);
          expect(handle.capabilities.promptCapabilities.embeddedContext).toBe(true);
        }
      });
    });
  });
});

describe.skipIf(!RUN_E2E_TESTS)("E2E: All Agents Comparison", () => {
  it("should have copilot-cli registered", () => {
    const agents = AgentFactory.listAgents();

    expect(agents).toContain("copilot-cli");
  });

  it("should spawn copilot-cli agent successfully", async () => {
    const copilotHandle = await AgentFactory.spawn("copilot-cli");
    expect(copilotHandle).toBeDefined();
    expect(copilotHandle.capabilities).toBeDefined();

    await copilotHandle.close();
  }, 120000);
});
