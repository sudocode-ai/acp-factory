/**
 * Gemini CLI agent configuration
 */

import type { AgentConfig } from "../types.js";

/**
 * Default configuration for Gemini CLI agent via --experimental-acp flag
 */
export const geminiConfig: AgentConfig = {
  command: "npx",
  args: ["@google/gemini-cli", "--experimental-acp"],
  env: {},
};
