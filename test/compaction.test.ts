import { describe, it, expect, vi } from "vitest";
import type {
  CompactionConfig,
  AgentMeta,
  SessionOptions,
} from "../src/types.js";

describe("CompactionConfig", () => {
  it("should accept full compaction configuration", () => {
    const config: CompactionConfig = {
      enabled: true,
      contextTokenThreshold: 50000,
      customInstructions: "Focus on code changes and key decisions",
    };

    expect(config.enabled).toBe(true);
    expect(config.contextTokenThreshold).toBe(50000);
    expect(config.customInstructions).toBe("Focus on code changes and key decisions");
  });

  it("should accept minimal compaction configuration with just enabled flag", () => {
    const config: CompactionConfig = {
      enabled: false,
    };

    expect(config.enabled).toBe(false);
    expect(config.contextTokenThreshold).toBeUndefined();
    expect(config.customInstructions).toBeUndefined();
  });

  it("should accept compaction configuration with only threshold", () => {
    const config: CompactionConfig = {
      enabled: true,
      contextTokenThreshold: 100000,
    };

    expect(config.enabled).toBe(true);
    expect(config.contextTokenThreshold).toBe(100000);
    expect(config.customInstructions).toBeUndefined();
  });
});

describe("AgentMeta", () => {
  it("should accept Claude Code specific metadata with compaction", () => {
    const meta: AgentMeta = {
      claudeCode: {
        compaction: {
          enabled: true,
          contextTokenThreshold: 75000,
        },
      },
    };

    expect(meta.claudeCode?.compaction?.enabled).toBe(true);
    expect(meta.claudeCode?.compaction?.contextTokenThreshold).toBe(75000);
  });

  it("should accept Claude Code specific metadata with options", () => {
    const meta: AgentMeta = {
      claudeCode: {
        options: {
          maxThinkingTokens: 5000,
          customSetting: "value",
        },
      },
    };

    expect(meta.claudeCode?.options).toEqual({
      maxThinkingTokens: 5000,
      customSetting: "value",
    });
  });

  it("should accept both compaction and options", () => {
    const meta: AgentMeta = {
      claudeCode: {
        compaction: {
          enabled: true,
        },
        options: {
          someOption: true,
        },
      },
    };

    expect(meta.claudeCode?.compaction?.enabled).toBe(true);
    expect(meta.claudeCode?.options).toEqual({ someOption: true });
  });

  it("should accept additional agent-specific metadata", () => {
    const meta: AgentMeta = {
      claudeCode: {
        compaction: { enabled: true },
      },
      customAgent: {
        customField: "value",
      },
    };

    expect(meta.claudeCode?.compaction?.enabled).toBe(true);
    expect((meta as any).customAgent.customField).toBe("value");
  });

  it("should allow empty claudeCode object", () => {
    const meta: AgentMeta = {
      claudeCode: {},
    };

    expect(meta.claudeCode).toEqual({});
    expect(meta.claudeCode?.compaction).toBeUndefined();
  });
});

describe("SessionOptions with agentMeta", () => {
  it("should accept session options without agentMeta", () => {
    const options: SessionOptions = {
      mode: "default",
    };

    expect(options.mode).toBe("default");
    expect(options.agentMeta).toBeUndefined();
  });

  it("should accept session options with full agentMeta", () => {
    const options: SessionOptions = {
      mode: "default",
      mcpServers: [],
      agentMeta: {
        claudeCode: {
          compaction: {
            enabled: true,
            contextTokenThreshold: 50000,
            customInstructions: "Summarize key points",
          },
        },
      },
    };

    expect(options.mode).toBe("default");
    expect(options.agentMeta?.claudeCode?.compaction?.enabled).toBe(true);
    expect(options.agentMeta?.claudeCode?.compaction?.contextTokenThreshold).toBe(50000);
  });

  it("should accept session options with only compaction enabled", () => {
    const options: SessionOptions = {
      agentMeta: {
        claudeCode: {
          compaction: {
            enabled: true,
          },
        },
      },
    };

    expect(options.agentMeta?.claudeCode?.compaction?.enabled).toBe(true);
  });

  it("should work with MCP servers and agentMeta together", () => {
    const options: SessionOptions = {
      mcpServers: [
        {
          name: "test-server",
          command: "npx",
          args: ["test-mcp"],
        },
      ],
      agentMeta: {
        claudeCode: {
          compaction: {
            enabled: true,
            contextTokenThreshold: 100000,
          },
        },
      },
    };

    expect(options.mcpServers).toHaveLength(1);
    expect(options.agentMeta?.claudeCode?.compaction?.enabled).toBe(true);
  });
});

describe("CompactionConfig default values", () => {
  it("should document default threshold of 100000 tokens", () => {
    // This test documents the expected default behavior
    // The actual default is applied in claude-code-acp createSession
    const DEFAULT_THRESHOLD = 100000;

    const minimalConfig: CompactionConfig = {
      enabled: true,
    };

    // When contextTokenThreshold is not specified, the agent should use 100000
    expect(minimalConfig.contextTokenThreshold).toBeUndefined();
    // Document the expected default
    expect(DEFAULT_THRESHOLD).toBe(100000);
  });
});
