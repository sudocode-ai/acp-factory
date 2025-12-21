import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock AgentHandle to avoid actual subprocess spawning
vi.mock("../src/agent-handle.js", () => ({
  AgentHandle: {
    create: vi.fn(),
  },
}));

import { AgentFactory } from "../src/factory.js";
import { AgentHandle } from "../src/agent-handle.js";
import type { AgentConfig } from "../src/types.js";

describe("AgentFactory", () => {
  const mockAgentHandle = {
    capabilities: { loadSession: true },
    createSession: vi.fn(),
    loadSession: vi.fn(),
    close: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(AgentHandle.create).mockResolvedValue(mockAgentHandle as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("register", () => {
    it("should register a new agent configuration", () => {
      const config: AgentConfig = {
        command: "custom-agent",
        args: ["--flag"],
      };

      AgentFactory.register("custom", config);

      expect(AgentFactory.getConfig("custom")).toEqual(config);
    });

    it("should overwrite existing configuration", () => {
      const config1: AgentConfig = { command: "agent1", args: [] };
      const config2: AgentConfig = { command: "agent2", args: ["--new"] };

      AgentFactory.register("test-overwrite", config1);
      AgentFactory.register("test-overwrite", config2);

      expect(AgentFactory.getConfig("test-overwrite")).toEqual(config2);
    });
  });

  describe("getConfig", () => {
    it("should return config for registered agent", () => {
      const config: AgentConfig = { command: "test", args: [] };
      AgentFactory.register("get-test", config);

      expect(AgentFactory.getConfig("get-test")).toEqual(config);
    });

    it("should return undefined for unknown agent", () => {
      expect(AgentFactory.getConfig("nonexistent-agent")).toBeUndefined();
    });
  });

  describe("listAgents", () => {
    it("should include pre-registered claude-code", () => {
      const agents = AgentFactory.listAgents();

      expect(agents).toContain("claude-code");
    });

    it("should include custom registered agents", () => {
      AgentFactory.register("list-test-agent", { command: "test", args: [] });

      const agents = AgentFactory.listAgents();

      expect(agents).toContain("list-test-agent");
    });
  });

  describe("spawn", () => {
    it("should spawn registered agent", async () => {
      AgentFactory.register("spawn-test", {
        command: "test-cmd",
        args: ["--test"],
        env: { CONFIG_VAR: "config-value" },
      });

      await AgentFactory.spawn("spawn-test", {
        env: { OPTION_VAR: "option-value" },
      });

      expect(AgentHandle.create).toHaveBeenCalledWith(
        {
          command: "test-cmd",
          args: ["--test"],
          env: {
            CONFIG_VAR: "config-value",
            OPTION_VAR: "option-value",
          },
        },
        expect.objectContaining({
          env: { OPTION_VAR: "option-value" },
        })
      );
    });

    it("should throw for unknown agent type", async () => {
      await expect(AgentFactory.spawn("unknown-agent")).rejects.toThrow(
        /Unknown agent type: unknown-agent/
      );
    });

    it("should include available agents in error message", async () => {
      AgentFactory.register("error-test-agent", { command: "test", args: [] });

      await expect(AgentFactory.spawn("bad-agent")).rejects.toThrow(
        /Available:.*claude-code/
      );
    });

    it("should return AgentHandle from create", async () => {
      AgentFactory.register("return-test", { command: "test", args: [] });

      const handle = await AgentFactory.spawn("return-test");

      expect(handle).toBe(mockAgentHandle);
    });

    it("should merge environment variables correctly", async () => {
      AgentFactory.register("env-test", {
        command: "test",
        args: [],
        env: { A: "1", B: "2" },
      });

      await AgentFactory.spawn("env-test", {
        env: { B: "override", C: "3" },
      });

      expect(AgentHandle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          env: { A: "1", B: "override", C: "3" },
        }),
        expect.anything()
      );
    });

    it("should pass permission mode to options", async () => {
      AgentFactory.register("perm-test", { command: "test", args: [] });

      await AgentFactory.spawn("perm-test", {
        permissionMode: "auto-deny",
      });

      expect(AgentHandle.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          permissionMode: "auto-deny",
        })
      );
    });

    it("should pass callbacks to options", async () => {
      const onPermissionRequest = vi.fn();
      const onFileRead = vi.fn();

      AgentFactory.register("callback-test", { command: "test", args: [] });

      await AgentFactory.spawn("callback-test", {
        onPermissionRequest,
        onFileRead,
      });

      expect(AgentHandle.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          onPermissionRequest,
          onFileRead,
        })
      );
    });
  });

  describe("claude-code provider", () => {
    it("should have claude-code pre-registered", () => {
      const config = AgentFactory.getConfig("claude-code");

      expect(config).toBeDefined();
      expect(config?.command).toBe("npx");
      expect(config?.args).toContain("@sudocode-ai/claude-code-acp");
    });

    it("should be spawnable", async () => {
      await AgentFactory.spawn("claude-code");

      expect(AgentHandle.create).toHaveBeenCalled();
    });
  });

  describe("codex provider", () => {
    it("should have codex pre-registered", () => {
      const config = AgentFactory.getConfig("codex");

      expect(config).toBeDefined();
      expect(config?.command).toBe("npx");
      expect(config?.args).toContain("@zed-industries/codex-acp");
    });

    it("should be spawnable", async () => {
      await AgentFactory.spawn("codex");

      expect(AgentHandle.create).toHaveBeenCalled();
    });

    it("should be listed in available agents", () => {
      const agents = AgentFactory.listAgents();

      expect(agents).toContain("codex");
    });
  });

  describe("gemini provider", () => {
    it("should have gemini pre-registered", () => {
      const config = AgentFactory.getConfig("gemini");

      expect(config).toBeDefined();
      expect(config?.command).toBe("npx");
      expect(config?.args).toContain("@google/gemini-cli");
      expect(config?.args).toContain("--experimental-acp");
    });

    it("should be spawnable", async () => {
      await AgentFactory.spawn("gemini");

      expect(AgentHandle.create).toHaveBeenCalled();
    });

    it("should be listed in available agents", () => {
      const agents = AgentFactory.listAgents();

      expect(agents).toContain("gemini");
    });
  });

  describe("opencode provider", () => {
    it("should have opencode pre-registered", () => {
      const config = AgentFactory.getConfig("opencode");

      expect(config).toBeDefined();
      expect(config?.command).toBe("opencode");
      expect(config?.args).toContain("acp");
    });

    it("should be spawnable", async () => {
      await AgentFactory.spawn("opencode");

      expect(AgentHandle.create).toHaveBeenCalled();
    });

    it("should be listed in available agents", () => {
      const agents = AgentFactory.listAgents();

      expect(agents).toContain("opencode");
    });
  });
});
