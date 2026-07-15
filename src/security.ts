import { z } from "zod";

export type RuleReview =
  | { decision: "allow" }
  | { decision: "confirm" | "deny"; reasons: string[] };

const DENY_RULES: Array<[RegExp, string]> = [
  [/(?:读取|显示|输出|泄露|cat).{0,20}(?:\.env|ssh\s*key|private\s*key|token|密码|credential)/i, "requests credentials or secrets"],
  [/(?:rm\s+-rf\s+\/|mkfs|dd\s+if=|格式化磁盘)/i, "requests destructive system operations"],
  [/(?:git\s+push\s+--force|强制推送|force.?push)/i, "requests a force push"],
  [/(?:修改|change).{0,15}(?:仓库权限|collaborator|repository permissions)/i, "requests repository permission changes"],
];

const CONFIRM_RULES: Array<[RegExp, string]> = [
  [/(?:数据库迁移|database migration|drop\s+table|alter\s+table)/i, "includes a database migration"],
  [/(?:curl|wget).{0,80}(?:\||bash|sh)/i, "downloads and executes a script"],
  [/(?:安装|install|upgrade).{0,20}(?:依赖|package|dependency)/i, "changes dependencies"],
  [/(?:忽略|ignore).{0,20}(?:之前|previous|system).{0,20}(?:指令|instructions?)/i, "contains a prompt-injection pattern"],
];

export function ruleReview(text: string): RuleReview {
  const denied = DENY_RULES.filter(([pattern]) => pattern.test(text)).map(([, reason]) => reason);
  if (denied.length > 0) return { decision: "deny", reasons: denied };
  const confirmations = CONFIRM_RULES.filter(([pattern]) => pattern.test(text)).map(([, reason]) => reason);
  if (confirmations.length > 0) return { decision: "confirm", reasons: confirmations };
  return { decision: "allow" };
}

export const AgentReviewSchema = z.object({
  decision: z.enum(["allow", "confirm", "deny"]),
  risks: z.array(z.string()),
  safeTask: z.string(),
});

export type AgentReview = z.infer<typeof AgentReviewSchema>;
