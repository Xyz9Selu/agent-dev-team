import { describe, expect, it } from "vitest";
import { classifyIntent, isCancelCommand, isResumeCommand, stripMention } from "../src/intent.js";

describe("intent", () => {
  it("defaults ambiguous requests to read-only", () => {
    expect(classifyIntent("帮我看看这个事情")).toBe("read");
    expect(classifyIntent("do something useful")).toBe("read");
  });

  it("requires explicit implementation language for writes", () => {
    expect(classifyIntent("开始实现，完成后提交 PR")).toBe("write");
    expect(classifyIntent("fix this bug")).toBe("write");
  });

  it("honors an explicit read-only qualifier", () => {
    expect(classifyIntent("先分析如何处理这个问题，不要修改代码")).toBe("read");
  });

  it("strips the configured mention without assuming a short alias", () => {
    expect(stripMention("@ESApi001 分析一下", "ESApi001"))
      .toBe("分析一下");
  });

  it("recognizes lifecycle commands", () => {
    expect(isCancelCommand("取消")).toBe(true);
    expect(isResumeCommand("继续执行")).toBe(true);
  });
});
