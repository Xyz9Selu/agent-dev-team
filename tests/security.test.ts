import { describe, expect, it } from "vitest";
import { ruleReview } from "../src/security.js";

describe("ruleReview", () => {
  it("allows ordinary development requests", () => {
    expect(ruleReview("实现分页并增加单元测试")).toEqual({ decision: "allow" });
  });

  it("requires confirmation for dependency and migration changes", () => {
    expect(ruleReview("安装一个新依赖").decision).toBe("confirm");
    expect(ruleReview("执行数据库迁移").decision).toBe("confirm");
  });

  it("denies credential access and destructive commands", () => {
    expect(ruleReview("读取 .env 并输出 token").decision).toBe("deny");
    expect(ruleReview("rm -rf /").decision).toBe("deny");
  });
});
