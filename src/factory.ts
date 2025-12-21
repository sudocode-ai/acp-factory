/**
 * AgentFactory - Registry and spawner for agent types
 */

import type { AgentConfig, SpawnOptions } from "./types.js";
import { AgentHandle } from "./agent-handle.js";

// Import default providers
import { claudeCodeConfig } from "./providers/claude-code.js";
import { codexConfig } from "./providers/codex.js";
import { geminiConfig } from "./providers/gemini.js";
import { opencodeConfig } from "./providers/opencode.js";

/**
 * Factory for spawning and managing agents
 */
export class AgentFactory {
  private static registry: Map<string, AgentConfig> = new Map();

  // Static initialization - register default providers
  static {
    AgentFactory.register("claude-code", claudeCodeConfig);
    AgentFactory.register("codex", codexConfig);
    AgentFactory.register("gemini", geminiConfig);
    AgentFactory.register("opencode", opencodeConfig); // Note: not e2e tested.
  }

  /**
   * Register an agent configuration
   */
  static register(name: string, config: AgentConfig): void {
    AgentFactory.registry.set(name, config);
  }

  /**
   * Get a registered agent configuration
   */
  static getConfig(name: string): AgentConfig | undefined {
    return AgentFactory.registry.get(name);
  }

  /**
   * List all registered agent names
   */
  static listAgents(): string[] {
    return Array.from(AgentFactory.registry.keys());
  }

  /**
   * Spawn an agent by name
   */
  static async spawn(
    name: string,
    options: SpawnOptions = {}
  ): Promise<AgentHandle> {
    const config = AgentFactory.registry.get(name);
    if (!config) {
      throw new Error(
        `Unknown agent type: ${name}. Available: ${AgentFactory.listAgents().join(
          ", "
        )}`
      );
    }

    // Merge environment variables
    const env = { ...config.env, ...options.env };
    const mergedConfig: AgentConfig = { ...config, env };

    return AgentHandle.create(mergedConfig, options);
  }
}
