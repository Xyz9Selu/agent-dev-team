import { describe, expect, it } from "vitest";
import { shouldAcceptTrigger } from "../src/intent.js";
import { formatAgentComment } from "../src/github.js";
import { ADT_SYSTEM_MARKER, type AdtConfig, type TriggerEvent } from "../src/types.js";

const config: AdtConfig = {
  github: { agentUser: "api001", allowedUsers: ["api001"], allowSelfTrigger: true, pollIntervalSeconds: 20 },
  executor: { kind: "cc-mm", command: "cc-mm", maxMinutes: 60 },
  isolation: { enabled: true, command: "bwrap", readOnlyHomePaths: [], writableHomePaths: [] },
  maxConcurrent: 2, retentionDays: 30, repositories: [],
};

function event(body: string): TriggerEvent {
  return { repo: "o/r", kind: "issue-comment", id: 1, number: 1, author: "api001", body,
    url: "https://example.test", createdAt: new Date().toISOString(), isPullRequest: false };
}

describe("single-account test trigger", () => {
  it("accepts a manual comment from the agent account when enabled", () => {
    expect(shouldAcceptTrigger(config, event("@api001 开始实现"))).toBe(true);
  });

  it("always rejects ADT-authored system comments", () => {
    const body = formatAgentComment("please reply @api001");
    expect(body).toContain(ADT_SYSTEM_MARKER);
    expect(shouldAcceptTrigger(config, event(body))).toBe(false);
  });

  it("rejects all self-authored comments when the test switch is disabled", () => {
    const disabled = { ...config, github: { ...config.github, allowSelfTrigger: false } };
    expect(shouldAcceptTrigger(disabled, event("@api001 analyze"))).toBe(false);
  });
});
