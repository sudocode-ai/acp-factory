/**
 * Codex agent configuration
 */

import type { AgentConfig } from "../types.js";

/**
 * Default configuration for Codex agent via codex-acp
 */
export const codexConfig: AgentConfig = {
  command: "npx",
  args: ["@zed-industries/codex-acp"],
  env: {},
};
