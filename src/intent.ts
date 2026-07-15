const WRITE_PATTERNS = [
  /(?:开始|进行).{0,4}(?:实现|开发)/i,
  /(?:实现|修复|修改|改掉|处理).{0,12}(?:问题|bug|功能|代码|review|反馈)?/i,
  /(?:implement|fix|modify|address\s+(?:the\s+)?review|start\s+implementation)/i,
];

const READ_PATTERNS = [
  /(?:分析|看看|检查|解释|总结|梳理|grill)/i,
  /(?:analy[sz]e|inspect|explain|summari[sz]e|review\s+only)/i,
];

export function stripMention(body: string, agentUser: string): string {
  return body.replace(new RegExp(`@${escapeRegex(agentUser)}\\b`, "gi"), " ").trim();
}

export function classifyIntent(instruction: string): "read" | "write" {
  if (/(?:只|先).{0,4}(?:分析|检查)|不要.{0,6}(?:修改|改代码)|(?:do\s+not|don't).{0,8}(?:modify|change)|analysis\s+only/i.test(instruction)) {
    return "read";
  }
  if (WRITE_PATTERNS.some((pattern) => pattern.test(instruction))) return "write";
  if (READ_PATTERNS.some((pattern) => pattern.test(instruction))) return "read";
  return "read";
}

export function isCancelCommand(instruction: string): boolean {
  return /^(?:取消|停止|cancel\b|stop\b)/i.test(instruction.trim());
}

export function isResumeCommand(instruction: string): boolean {
  return /^(?:继续|重试|resume\b|retry\b)/i.test(instruction.trim());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
