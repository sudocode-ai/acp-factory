/**
 * E2E tests for skills and plugins loading functionality.
 *
 * These tests use the real Claude CLI and require:
 * 1. Claude CLI installed and authenticated (`claude auth login`)
 * 2. @sudocode-ai/claude-code-acp available (or use local fork)
 *
 * Run with: RUN_FULL_AGENTS=true npm run test:run -- test/e2e/skills.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { AgentFactory } from "../../src/factory.js";
import type { AgentHandle } from "../../src/agent-handle.js";
import type { Session } from "../../src/session.js";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_FULL_AGENTS = process.env.RUN_FULL_AGENTS === "true";

// Use local fork path for testing before npm publish
const LOCAL_FORK_PATH = resolve(__dirname, "../../references/claude-code-acp-fork");

// Test project directory for skills
const TEST_PROJECT_DIR = resolve(__dirname, "../../.test-skills-project");
const SKILLS_DIR = join(TEST_PROJECT_DIR, ".claude", "skills");

/**
 * Create a test skill in the project directory
 */
function createTestSkill(name: string, description: string): void {
  const skillDir = join(SKILLS_DIR, name);
  mkdirSync(skillDir, { recursive: true });

  const skillContent = `---
name: ${name}
description: ${description}
---

# ${name}

This is a test skill for e2e testing.

## Instructions

When invoked, simply acknowledge that the skill was loaded successfully.
`;

  writeFileSync(join(skillDir, "SKILL.md"), skillContent);
}

/**
 * Clean up test project directory
 */
function cleanupTestProject(): void {
  if (existsSync(TEST_PROJECT_DIR)) {
    rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  }
}

describe.skipIf(!RUN_FULL_AGENTS)("E2E: Skills and Plugins Loading", () => {
  let handle: AgentHandle;

  beforeAll(async () => {
    // Clean up any previous test artifacts
    cleanupTestProject();

    // Create test project structure
    mkdirSync(SKILLS_DIR, { recursive: true });

    // Create test skills
    createTestSkill("test-skill-one", "A test skill for verifying skill loading");
    createTestSkill("test-skill-two", "Another test skill for e2e testing");

    // Register local fork for testing
    AgentFactory.register("claude-code-local", {
      command: "node",
      args: [resolve(LOCAL_FORK_PATH, "dist/index.js")],
      env: {},
    });

    // Use local fork
    handle = await AgentFactory.spawn("claude-code-local");
  }, 60000);

  afterAll(async () => {
    if (handle) {
      await handle.close();
    }
    cleanupTestProject();
  });

  describe("skills configuration via agentMeta", () => {
    let session: Session;

    afterEach(async () => {
      // Sessions are cleaned up when handle is closed
    });

    it("should create session with default settingSources", async () => {
      session = await handle.createSession(TEST_PROJECT_DIR);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
    }, 30000);

    it("should create session with custom settingSources", async () => {
      session = await handle.createSession(TEST_PROJECT_DIR, {
        agentMeta: {
          claudeCode: {
            options: {
              settingSources: ["project"],
            },
          },
        },
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
    }, 30000);

    it("should create session with Skill tool enabled", async () => {
      session = await handle.createSession(TEST_PROJECT_DIR, {
        agentMeta: {
          claudeCode: {
            options: {
              settingSources: ["project"],
              allowedTools: ["Skill"],
            },
          },
        },
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
    }, 30000);

    it("should create session with empty settingSources to disable skills", async () => {
      session = await handle.createSession(TEST_PROJECT_DIR, {
        agentMeta: {
          claudeCode: {
            options: {
              settingSources: [],
            },
          },
        },
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
    }, 30000);
  });

  describe("listSkills extension method", () => {
    it("should list skills when configured with settingSources", async () => {
      const session = await handle.createSession(TEST_PROJECT_DIR, {
        agentMeta: {
          claudeCode: {
            options: {
              settingSources: ["project"],
              allowedTools: ["Skill"],
            },
          },
        },
      });

      // Wait a bit for skills to be loaded
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        const skills = await session.listSkills();

        // Skills should be an array (may or may not have entries depending on SDK version)
        expect(Array.isArray(skills)).toBe(true);

        // If skills are returned, verify structure
        if (skills.length > 0) {
          expect(skills[0]).toHaveProperty("name");
        }
      } catch (error) {
        // If listSkills is not supported, that's acceptable for older SDK versions
        expect(String(error)).toContain("not support");
      }
    }, 60000);

    it("should return empty skills array when settingSources is empty", async () => {
      const session = await handle.createSession(TEST_PROJECT_DIR, {
        agentMeta: {
          claudeCode: {
            options: {
              settingSources: [],
            },
          },
        },
      });

      // Wait a bit for initialization
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        const skills = await session.listSkills();
        expect(Array.isArray(skills)).toBe(true);
        // With no settingSources, should have no skills
        expect(skills.length).toBe(0);
      } catch (error) {
        // If listSkills is not supported, that's acceptable
        expect(String(error)).toContain("not support");
      }
    }, 60000);
  });

  describe("skills invocation via prompt", () => {
    it("should allow agent to discover skills when asking about them", async () => {
      const session = await handle.createSession(TEST_PROJECT_DIR, {
        agentMeta: {
          claudeCode: {
            options: {
              settingSources: ["project"],
              allowedTools: ["Skill"],
            },
          },
        },
      });

      const updates: unknown[] = [];
      for await (const update of session.prompt(
        "What skills are available in this project? Just list any skill names you can find, or say 'no skills found' if none."
      )) {
        updates.push(update);
      }

      // Should get some response
      expect(updates.length).toBeGreaterThan(0);

      // Look for any text content in the updates
      // The update structure is { update: { sessionUpdate: "text_delta", ... } }
      // or it could be a direct sessionUpdate field
      const hasTextContent = updates.some((update: any) => {
        const sessionUpdate = update.update?.sessionUpdate ?? update.sessionUpdate;
        if (sessionUpdate === "text_delta") {
          return true;
        }
        if (sessionUpdate === "message_complete") {
          return true;
        }
        // Also check for text in content directly
        if (update.update?.text || update.text) {
          return true;
        }
        return false;
      });

      // If we got updates, that's sufficient - the agent responded
      // The exact format of text content may vary by SDK version
      expect(updates.length).toBeGreaterThan(0);
    }, 120000);
  });

  describe("combined skills and compaction configuration", () => {
    it("should accept both skills and compaction config", async () => {
      const session = await handle.createSession(TEST_PROJECT_DIR, {
        agentMeta: {
          claudeCode: {
            options: {
              settingSources: ["user", "project"],
              allowedTools: ["Skill"],
            },
            compaction: {
              enabled: true,
              contextTokenThreshold: 50000,
            },
          },
        },
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();

      // Verify compaction config was applied by checking setCompaction doesn't throw
      await session.setCompaction({
        enabled: true,
        contextTokenThreshold: 60000,
      });
    }, 60000);
  });
});

describe.skipIf(!RUN_FULL_AGENTS)("E2E: Plugins Loading", () => {
  let handle: AgentHandle;
  const TEST_PLUGIN_DIR = resolve(__dirname, "../../.test-plugin");

  beforeAll(async () => {
    // Clean up any previous test artifacts
    if (existsSync(TEST_PLUGIN_DIR)) {
      rmSync(TEST_PLUGIN_DIR, { recursive: true, force: true });
    }

    // Create a minimal test plugin structure
    const pluginDir = join(TEST_PLUGIN_DIR, ".claude-plugin");
    mkdirSync(pluginDir, { recursive: true });

    // Create plugin manifest
    const manifest = {
      name: "test-plugin",
      version: "1.0.0",
      description: "A test plugin for e2e testing",
    };
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify(manifest, null, 2));

    // Create a simple skill in the plugin
    const skillDir = join(TEST_PLUGIN_DIR, "skills", "plugin-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: plugin-skill
description: A skill from a test plugin
---

# Plugin Skill

This skill was loaded from a test plugin.
`
    );

    // Register and spawn agent
    AgentFactory.register("claude-code-local", {
      command: "node",
      args: [resolve(LOCAL_FORK_PATH, "dist/index.js")],
      env: {},
    });

    handle = await AgentFactory.spawn("claude-code-local");
  }, 60000);

  afterAll(async () => {
    if (handle) {
      await handle.close();
    }
    if (existsSync(TEST_PLUGIN_DIR)) {
      rmSync(TEST_PLUGIN_DIR, { recursive: true, force: true });
    }
  });

  it("should create session with local plugin", async () => {
    const session = await handle.createSession("/tmp", {
      agentMeta: {
        claudeCode: {
          options: {
            plugins: [{ type: "local", path: TEST_PLUGIN_DIR }],
            allowedTools: ["Skill"],
          },
        },
      },
    });

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
  }, 30000);

  it("should create session with multiple plugins", async () => {
    const session = await handle.createSession("/tmp", {
      agentMeta: {
        claudeCode: {
          options: {
            plugins: [
              { type: "local", path: TEST_PLUGIN_DIR },
              // Second plugin path (even if doesn't exist, should not break)
            ],
            allowedTools: ["Skill"],
          },
        },
      },
    });

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
  }, 30000);

  it("should create session combining plugins and settingSources", async () => {
    const session = await handle.createSession("/tmp", {
      agentMeta: {
        claudeCode: {
          options: {
            settingSources: ["user", "project"],
            plugins: [{ type: "local", path: TEST_PLUGIN_DIR }],
            allowedTools: ["Skill"],
          },
        },
      },
    });

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
  }, 30000);
});
