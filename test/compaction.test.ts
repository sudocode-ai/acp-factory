import { describe, it, expect, vi } from "vitest";
import type {
  CompactionConfig,
  AgentMeta,
  SessionOptions,
  CompactionStartedUpdate,
  CompactionCompletedUpdate,
  CompactionUpdate,
  ExtendedSessionUpdate,
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

describe("CompactionStartedUpdate", () => {
  it("should have correct structure for auto-triggered compaction", () => {
    const update: CompactionStartedUpdate = {
      sessionUpdate: "compaction_started",
      sessionId: "session-123",
      trigger: "auto",
      preTokens: 105000,
      threshold: 100000,
    };

    expect(update.sessionUpdate).toBe("compaction_started");
    expect(update.sessionId).toBe("session-123");
    expect(update.trigger).toBe("auto");
    expect(update.preTokens).toBe(105000);
    expect(update.threshold).toBe(100000);
  });

  it("should have correct structure for manually-triggered compaction", () => {
    const update: CompactionStartedUpdate = {
      sessionUpdate: "compaction_started",
      sessionId: "session-456",
      trigger: "manual",
      preTokens: 80000,
    };

    expect(update.sessionUpdate).toBe("compaction_started");
    expect(update.trigger).toBe("manual");
    expect(update.threshold).toBeUndefined();
  });
});

describe("CompactionCompletedUpdate", () => {
  it("should have correct structure", () => {
    const update: CompactionCompletedUpdate = {
      sessionUpdate: "compaction_completed",
      sessionId: "session-123",
      trigger: "auto",
      preTokens: 105000,
    };

    expect(update.sessionUpdate).toBe("compaction_completed");
    expect(update.sessionId).toBe("session-123");
    expect(update.trigger).toBe("auto");
    expect(update.preTokens).toBe(105000);
  });
});

describe("CompactionUpdate union type", () => {
  it("should accept CompactionStartedUpdate", () => {
    const update: CompactionUpdate = {
      sessionUpdate: "compaction_started",
      sessionId: "session-123",
      trigger: "auto",
      preTokens: 100000,
    };

    expect(update.sessionUpdate).toBe("compaction_started");
  });

  it("should accept CompactionCompletedUpdate", () => {
    const update: CompactionUpdate = {
      sessionUpdate: "compaction_completed",
      sessionId: "session-123",
      trigger: "manual",
      preTokens: 80000,
    };

    expect(update.sessionUpdate).toBe("compaction_completed");
  });
});

describe("ExtendedSessionUpdate with compaction events", () => {
  it("should accept compaction_started as ExtendedSessionUpdate", () => {
    const update: ExtendedSessionUpdate = {
      sessionUpdate: "compaction_started",
      sessionId: "session-123",
      trigger: "auto",
      preTokens: 100000,
      threshold: 100000,
    } as CompactionStartedUpdate;

    expect((update as CompactionStartedUpdate).sessionUpdate).toBe("compaction_started");
  });

  it("should accept compaction_completed as ExtendedSessionUpdate", () => {
    const update: ExtendedSessionUpdate = {
      sessionUpdate: "compaction_completed",
      sessionId: "session-123",
      trigger: "auto",
      preTokens: 100000,
    } as CompactionCompletedUpdate;

    expect((update as CompactionCompletedUpdate).sessionUpdate).toBe("compaction_completed");
  });

  it("should still accept permission_request as ExtendedSessionUpdate", () => {
    const update: ExtendedSessionUpdate = {
      sessionUpdate: "permission_request",
      requestId: "perm-1",
      sessionId: "session-123",
      toolCall: {
        toolCallId: "tool-1",
        title: "Test Tool",
        status: "pending",
      },
      options: [],
    };

    expect(update.sessionUpdate).toBe("permission_request");
  });
});
