#!/usr/bin/env npx tsx
/**
 * Interrupt and add context example for acp-factory
 *
 * This example demonstrates how to interrupt an agent mid-execution
 * and redirect it with new context using interruptWith().
 *
 * Run with: npx tsx examples/interrupt-context.ts
 */

import * as readline from "node:readline";
import { AgentFactory, type ExtendedSessionUpdate } from "../src/index.js";

function handleUpdate(update: ExtendedSessionUpdate) {
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
        console.log(`[Tool completed]`);
      }
      break;
    case "permission_request":
      console.log(`\n[Permission requested: ${update.toolCall.title}]`);
      break;
  }
}

// Promise-based question helper
function askQuestion(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// Set up keypress detection that resolves when 'i' is pressed
function waitForInterruptKey(): Promise<void> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // Not a TTY, can't use raw mode - never resolve
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (key: Buffer) => {
      const char = key.toString();

      // Check for 'i' key
      if (char === "i" || char === "I") {
        cleanup();
        resolve();
      }
      // Check for Ctrl+C to exit gracefully
      else if (char === "\u0003") {
        cleanup();
        console.log("\n\nExiting...");
        process.exit(0);
      }
    };

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    };

    process.stdin.on("data", onData);
  });
}

async function main() {
  console.log("=== Interrupt Context Example ===\n");
  console.log("This example shows how to redirect the agent mid-execution.\n");
  console.log("While the agent is working, press 'i' to interrupt\n");
  console.log("and provide new context.\n");

  // Spawn agent
  const agent = await AgentFactory.spawn("claude-code", {
    permissionMode: "auto-approve",
  });

  const session = await agent.createSession(process.cwd());
  console.log(`Session: ${session.id}\n`);

  // Initial prompt
  const initialPrompt =
    "List and briefly describe the main source files in this project. Take your time and be thorough.";
  console.log(`Initial prompt: "${initialPrompt}"\n`);
  console.log("--- Response (press 'i' to interrupt) ---\n");

  // Set up interrupt detection
  const interruptPromise = waitForInterruptKey();
  let wasInterrupted = false;

  // Process updates with interrupt checking
  try {
    const promptIterator = session.prompt(initialPrompt)[Symbol.asyncIterator]();

    while (true) {
      // Race between next update and interrupt key
      const result = await Promise.race([
        promptIterator.next().then((r) => ({ type: "update" as const, result: r })),
        interruptPromise.then(() => ({ type: "interrupt" as const })),
      ]);

      if (result.type === "interrupt") {
        wasInterrupted = true;
        console.log("\n\n--- Interrupt detected! ---\n");

        // Get new context from user
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const newContext = await askQuestion(rl, "Enter new context: ");
        rl.close();

        if (newContext.trim()) {
          console.log(`\nRedirecting with: "${newContext}"\n`);
          console.log("--- New Response ---\n");

          // Interrupt and continue with new context
          const newPrompt = `${initialPrompt}\n\nAdditional context from user: ${newContext}`;

          for await (const newUpdate of session.interruptWith(newPrompt)) {
            handleUpdate(newUpdate);
          }
        } else {
          console.log("\nNo context provided, cancelling...");
          await session.cancel();
        }
        break;
      }

      // Normal update
      if (result.result.done) {
        break;
      }
      handleUpdate(result.result.value);
    }
  } catch (error) {
    // Handle cancellation gracefully
    if (String(error).includes("cancel")) {
      console.log("\n[Prompt was cancelled]");
    } else {
      throw error;
    }
  }

  console.log("\n\n--- End Response ---\n");

  // Cleanup
  await agent.close();
  console.log("Done!");
  process.exit(0);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
