/**
 * Claude Code agent configuration
 */

import type { AgentConfig } from "../types.js";

/**
 * Default configuration for Claude Code agent via claude-code-acp
 */
export const claudeCodeConfig: AgentConfig = {
  command: "npx",
  args: ["@sudocode-ai/claude-code-acp"],
  env: {},
};
