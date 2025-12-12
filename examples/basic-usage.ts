#!/usr/bin/env npx tsx
/**
 * Basic usage example for acp-factory
 *
 * Prerequisites:
 * - Have Claude Code installed and authenticated (run `claude` once to set up)
 * - Or set ANTHROPIC_API_KEY environment variable
 *
 * Run with: npx tsx examples/basic-usage.ts
 */

import { AgentFactory, type SessionUpdate } from "../src/index.js";

async function main() {
  console.log("Available agents:", AgentFactory.listAgents());

  // Spawn Claude Code agent
  // Uses existing Claude Code authentication from ~/.claude.json
  // Or pass ANTHROPIC_API_KEY in env if needed
  console.log("\nSpawning Claude Code agent...");
  const agent = await AgentFactory.spawn("claude-code", {
    // Auto-approve all permission requests (for demo purposes)
    permissionMode: "auto-approve",
  });

  console.log("Agent capabilities:", agent.capabilities);

  // Create a session
  console.log("\nCreating session...");
  const session = await agent.createSession(process.cwd());
  console.log(`Session ID: ${session.id}`);
  console.log(`Available modes: ${session.modes.join(", ") || "none"}`);
  console.log(`Available models: ${session.models.join(", ") || "none"}`);

  // Send a prompt and stream responses
  console.log("\nSending prompt: 'What is 2 + 2?'\n");
  console.log("--- Response ---");

  for await (const update of session.prompt("What is 2 + 2?")) {
    handleUpdate(update);
  }

  console.log("\n--- End Response ---");

  // Clean up
  console.log("\nClosing agent...");
  await agent.close();
  console.log("Done!");
}

function handleUpdate(update: SessionUpdate) {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      if (update.content.type === "text") {
        process.stdout.write(update.content.text);
      }
      break;
    case "tool_call":
      console.log(`\n[Tool: ${update.title}]`);
      break;
    case "tool_call_update":
      if (update.status === "completed") {
        console.log(`[Tool completed: ${update.toolCallId}]`);
      }
      break;
    case "agent_thought_chunk":
      // Optionally show thinking
      break;
    default:
      // Other update types
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
