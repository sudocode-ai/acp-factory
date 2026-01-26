/**
 * Type tests to verify exports and type definitions.
 *
 * Run with: npx vitest run test/types.test.ts
 */
import { describe, it, expect } from "vitest";
import type {
  ClaudeCodeOptions,
  SkillInfo,
  AgentMeta,
  CompactionConfig,
  SessionOptions,
} from "../src/types.js";

describe("ClaudeCodeOptions type", () => {
  it("should accept valid settingSources", () => {
    const options: ClaudeCodeOptions = {
      settingSources: ["user", "project", "local"],
    };
    expect(options.settingSources).toHaveLength(3);
  });

  it("should accept subset of settingSources", () => {
    const options: ClaudeCodeOptions = {
      settingSources: ["project"],
    };
    expect(options.settingSources).toHaveLength(1);
  });

  it("should accept empty settingSources", () => {
    const options: ClaudeCodeOptions = {
      settingSources: [],
    };
    expect(options.settingSources).toHaveLength(0);
  });

  it("should accept plugins array", () => {
    const options: ClaudeCodeOptions = {
      plugins: [
        { type: "local", path: "./my-plugin" },
        { type: "local", path: "/absolute/path" },
      ],
    };
    expect(options.plugins).toHaveLength(2);
  });

  it("should accept allowedTools array", () => {
    const options: ClaudeCodeOptions = {
      allowedTools: ["Skill", "Read", "Write", "Bash"],
    };
    expect(options.allowedTools).toContain("Skill");
  });

  it("should accept disallowedTools array", () => {
    const options: ClaudeCodeOptions = {
      disallowedTools: ["WebSearch", "WebFetch"],
    };
    expect(options.disallowedTools).toHaveLength(2);
  });

  it("should accept mcpServers", () => {
    const options: ClaudeCodeOptions = {
      mcpServers: {
        "my-server": {
          type: "stdio",
          command: "node",
          args: ["server.js"],
        },
      },
    };
    expect(options.mcpServers).toBeDefined();
  });

  it("should accept hooks", () => {
    const options: ClaudeCodeOptions = {
      hooks: {
        PreToolUse: [],
        PostToolUse: [],
      },
    };
    expect(options.hooks).toBeDefined();
  });

  it("should accept arbitrary additional properties", () => {
    const options: ClaudeCodeOptions = {
      customOption: "value",
      anotherOption: 123,
    };
    expect(options.customOption).toBe("value");
    expect(options.anotherOption).toBe(123);
  });

  it("should accept full configuration", () => {
    const options: ClaudeCodeOptions = {
      settingSources: ["user", "project"],
      plugins: [{ type: "local", path: "~/.claude/plugins/my-plugin" }],
      allowedTools: ["Skill", "Read"],
      disallowedTools: ["WebSearch"],
      mcpServers: {},
      hooks: {},
    };
    expect(options).toBeDefined();
  });
});

describe("SkillInfo type", () => {
  it("should accept minimal skill info", () => {
    const skill: SkillInfo = {
      name: "test-skill",
    };
    expect(skill.name).toBe("test-skill");
  });

  it("should accept full skill info", () => {
    const skill: SkillInfo = {
      name: "pdf-processor",
      description: "Process PDF files",
      source: "project",
    };
    expect(skill.name).toBe("pdf-processor");
    expect(skill.description).toBe("Process PDF files");
    expect(skill.source).toBe("project");
  });

  it("should accept all valid source values", () => {
    const sources: Array<"user" | "project" | "plugin"> = ["user", "project", "plugin"];
    sources.forEach((source) => {
      const skill: SkillInfo = { name: "test", source };
      expect(skill.source).toBe(source);
    });
  });
});

describe("AgentMeta type with ClaudeCodeOptions", () => {
  it("should accept claudeCode with options", () => {
    const meta: AgentMeta = {
      claudeCode: {
        options: {
          settingSources: ["project"],
          allowedTools: ["Skill"],
        },
      },
    };
    expect(meta.claudeCode?.options?.settingSources).toEqual(["project"]);
  });

  it("should accept claudeCode with both options and compaction", () => {
    const meta: AgentMeta = {
      claudeCode: {
        options: {
          settingSources: ["user", "project"],
          plugins: [{ type: "local", path: "./plugin" }],
        },
        compaction: {
          enabled: true,
          contextTokenThreshold: 50000,
        },
      },
    };
    expect(meta.claudeCode?.options).toBeDefined();
    expect(meta.claudeCode?.compaction?.enabled).toBe(true);
  });

  it("should accept additional metadata properties", () => {
    const meta: AgentMeta = {
      claudeCode: {
        options: {},
      },
      customAgent: {
        someOption: true,
      },
    };
    expect(meta.customAgent).toBeDefined();
  });
});

describe("SessionOptions with agentMeta", () => {
  it("should accept full skills configuration in SessionOptions", () => {
    const options: SessionOptions = {
      mode: "code",
      mcpServers: [],
      agentMeta: {
        claudeCode: {
          options: {
            settingSources: ["user", "project", "local"],
            plugins: [{ type: "local", path: "./my-plugin" }],
            allowedTools: ["Skill", "Read", "Write", "Bash"],
          },
          compaction: {
            enabled: true,
            contextTokenThreshold: 80000,
            customInstructions: "Focus on code changes",
          },
        },
      },
    };

    expect(options.agentMeta?.claudeCode?.options?.settingSources).toHaveLength(3);
    expect(options.agentMeta?.claudeCode?.options?.plugins).toHaveLength(1);
    expect(options.agentMeta?.claudeCode?.options?.allowedTools).toContain("Skill");
    expect(options.agentMeta?.claudeCode?.compaction?.enabled).toBe(true);
  });
});

describe("exports from index", () => {
  it("should export ClaudeCodeOptions type", async () => {
    const exports = await import("../src/index.js");
    // Type exports aren't runtime values, but we can verify the module loads
    expect(exports).toBeDefined();
  });

  it("should export SkillInfo type", async () => {
    const exports = await import("../src/index.js");
    expect(exports).toBeDefined();
  });
});
