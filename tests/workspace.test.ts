import { describe, expect, it } from "vitest";
import { branchName } from "../src/workspace.js";

describe("workspace branch names", () => {
  it("derives the namespace from the configured agent user", () => {
    expect(branchName(12, "Fix status output", "ESApi001"))
      .toBe("esapi001/issue-12-fix-status-output");
  });
});
