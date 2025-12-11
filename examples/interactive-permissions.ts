#!/usr/bin/env npx tsx
/**
 * Interactive permissions example for acp-factory
 *
 * This example demonstrates how to use interactive permission mode
 * to show permission requests to users and collect their responses.
 *
 * NOTE: Permission requests only trigger for tools that are NOT pre-approved
 * in your Claude Code settings (~/.claude/settings.json or .claude/settings.json).
 * Read-only commands like `ls` may be auto-approved by default settings.
 * This example uses a file write operation which typically requires permission.
 *
 * Run with: npx tsx examples/interactive-permissions.ts
 */

import * as readline from "node:readline";
import {
  AgentFactory,
  type ExtendedSessionUpdate,
  type PermissionRequestUpdate,
} from "../src/index.js";

// Helper to check if update is a permission request
function isPermissionRequest(
  update: ExtendedSessionUpdate
): update is PermissionRequestUpdate {
  return update.sessionUpdate === "permission_request";
}

// Simple CLI prompt for user input
async function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.log("Spawning Claude Code agent with interactive permissions...\n");

  // Spawn with interactive permission mode
  const agent = await AgentFactory.spawn("claude-code", {
    permissionMode: "interactive",
  });

  console.log("Agent spawned. Creating session...\n");

  const session = await agent.createSession(process.cwd());
  console.log(`Session ID: ${session.id}\n`);

  // Send a prompt that will likely trigger a permission request
  // File writes typically require explicit permission (not pre-approved in settings)
  const prompt = "Create a file called /tmp/acp-test.txt with the content 'Hello from ACP!'";
  console.log(`Sending prompt: "${prompt}"\n`);
  console.log("NOTE: If no permission request appears, the tool may be pre-approved in your Claude Code settings.\n");
  console.log("--- Response ---\n");

  for await (const update of session.prompt(prompt)) {
    // Handle permission requests interactively
    if (isPermissionRequest(update)) {
      console.log("\n=== Permission Request ===");
      console.log(`Tool: ${update.toolCall.title}`);
      console.log(`Tool Call ID: ${update.toolCall.toolCallId}`);
      console.log("\nOptions:");

      update.options.forEach((opt, index) => {
        console.log(`  ${index + 1}. [${opt.kind}] ${opt.name}`);
      });

      // Get user choice - loop until valid input
      let responded = false;
      while (!responded) {
        const answer = await askUser("\nEnter option number (or 'c' to cancel): ");

        if (answer.toLowerCase() === "c") {
          console.log("Cancelling permission request...");
          session.cancelPermission(update.requestId);
          responded = true;
        } else {
          const optionIndex = parseInt(answer) - 1;
          if (optionIndex >= 0 && optionIndex < update.options.length) {
            const selectedOption = update.options[optionIndex];
            console.log(`Selected: ${selectedOption.name}`);
            session.respondToPermission(update.requestId, selectedOption.optionId);
            responded = true;
          } else {
            console.log(`Invalid choice. Please enter 1-${update.options.length} or 'c' to cancel.`);
          }
        }
      }
      console.log("=========================\n");
      continue;
    }

    // Handle regular session updates
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
    }
  }

  console.log("\n\n--- End Response ---");

  // Clean up
  console.log("\nClosing agent...");
  await agent.close();
  console.log("Done!");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
