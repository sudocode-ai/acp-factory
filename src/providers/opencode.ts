/**
 * OpenCode agent configuration
 *
 * OpenCode is an open source AI coding agent built in Go.
 * Install via: curl -fsSL https://opencode.ai/install | bash
 * Or: go install github.com/opencode-ai/opencode@latest
 *
 * @see https://opencode.ai/docs/acp/
 */

import type { AgentConfig } from "../types.js";

/**
 * Default configuration for OpenCode agent via ACP mode
 */
export const opencodeConfig: AgentConfig = {
  command: "opencode",
  args: ["acp"],
  env: {},
};
