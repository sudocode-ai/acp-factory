/**
 * GitHub Copilot CLI agent configuration
 */

import type { AgentConfig } from "../types.js";

/**
 * Default configuration for GitHub Copilot CLI agent via --acp flag
 */
export const copilotCliConfig: AgentConfig = {
  command: "npx",
  args: ["@github/copilot", "--acp"],
  env: {},
};
