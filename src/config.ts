import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { AdtConfig } from "./types.js";

export const ADT_HOME = process.env.ADT_HOME ?? path.join(os.homedir(), ".adt");
export const CONFIG_PATH = process.env.ADT_CONFIG ?? path.join(ADT_HOME, "config.json");

const ConfigSchema = z.object({
  github: z.object({
    agentUser: z.string().min(1),
    allowedUsers: z.array(z.string().min(1)).min(1),
    allowSelfTrigger: z.boolean().default(false),
    pollIntervalSeconds: z.number().int().min(5).default(20),
  }),
  executor: z.object({
    kind: z.literal("cc-mm"),
    command: z.string().min(1).default("cc-mm"),
    maxMinutes: z.number().int().positive().default(60),
  }),
  isolation: z.object({
    enabled: z.boolean().default(true),
    command: z.string().min(1).default("bwrap"),
    readOnlyHomePaths: z.array(z.string()).default([]),
    writableHomePaths: z.array(z.string()).default([]),
  }),
  maxConcurrent: z.number().int().positive().default(2),
  retentionDays: z.number().int().positive().default(30),
  repositories: z.array(
    z.object({ name: z.string().regex(/^[^/]+\/[^/]+$/), path: z.string().min(1) }),
  ),
});

export function loadConfig(configPath = CONFIG_PATH): AdtConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration not found: ${configPath}. Run 'adt init'.`);
  }
  return ConfigSchema.parse(JSON.parse(fs.readFileSync(configPath, "utf8"))) as AdtConfig;
}

export function writeExampleConfig(destination = CONFIG_PATH): void {
  if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const example: AdtConfig = {
    github: {
      agentUser: "api001endlessstudio-sketch",
      allowedUsers: ["Xyz9Selu"],
      allowSelfTrigger: false,
      pollIntervalSeconds: 20,
    },
    executor: { kind: "cc-mm", command: "cc-mm", maxMinutes: 60 },
    isolation: {
      enabled: true,
      command: "bwrap",
      readOnlyHomePaths: [
        path.join(os.homedir(), ".local"),
        path.join(os.homedir(), ".npm-global"),
        path.join(os.homedir(), ".claude.json"),
      ],
      writableHomePaths: [path.join(os.homedir(), ".claude")],
    },
    maxConcurrent: 2,
    retentionDays: 30,
    repositories: [],
  };
  fs.writeFileSync(destination, `${JSON.stringify(example, null, 2)}\n`, { mode: 0o600 });
}
