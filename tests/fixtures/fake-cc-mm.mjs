#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const promptIndex = args.indexOf("--print");
const prompt = promptIndex >= 0 ? args[promptIndex + 1] : "";
const sessionIndex = args.findIndex((arg) => arg === "--session-id" || arg === "--resume");
const sessionId = sessionIndex >= 0 ? args[sessionIndex + 1] : "fake-session";
let structured_output;

if (prompt.includes("security gate")) {
  structured_output = { decision: "allow", risks: [], safeTask: "safe normalized task" };
} else if (prompt.includes("writing-plans")) {
  const match = /write a complete implementation plan to ([^\s.]+(?:\.md)?)/.exec(prompt);
  const plan = match?.[1] ?? "docs/plans/fake.md";
  fs.mkdirSync(path.dirname(path.join(process.cwd(), plan)), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), plan), "# Fake plan\n");
  structured_output = { status: "done", summary: "Plan written" };
} else if (prompt.includes("subagent-driven-development")) {
  fs.writeFileSync(path.join(process.cwd(), "implemented.txt"), "implemented\n");
  structured_output = { status: "done", summary: "Implemented", tests: ["fake test passed"] };
} else {
  structured_output = { status: "needs-input", summary: "Need a choice", questions: ["Choose A or B?"], checkpoint: "analysis" };
}

process.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: sessionId, structured_output }));
