# Pretty `adt status` Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `adt status` easier to scan by giving every task status a distinct color when interactive, while keeping plain non-TTY/log output readable and leaving task state and ordering behavior unchanged.

**Architecture:** Keep the status command's data access and refresh loop in `src/cli.ts`, and extract only table rendering and color-policy decisions into a dependency-free, pure formatter module. The formatter will preserve the existing table fields, padding, and plain-text status values; the CLI will enable ANSI styling only for a TTY and will honor `NO_COLOR`, so redirected output contains no escape sequences. Tests will exercise the formatter directly, including every `JobStatus`, visible-width behavior, empty output, and caller-provided row order.

**Tech Stack:** TypeScript 5.8 with strict NodeNext ESM, Node.js `>=20`, Vitest 2, Commander 12, and no new runtime dependencies. ANSI SGR sequences are emitted directly rather than adding a color package.

## Global Constraints

- The supported status values remain exactly the `JobStatus` union in `src/types.ts`: `queued`, `running`, `needs-input`, `done`, `failed`, and `cancelled`.
- `allJobs(db, 50)` and its existing `ORDER BY updated_at DESC` query are not changed; the formatter must render rows in the order it receives them and must not sort or filter them.
- The existing table fields and plain layout remain unchanged: `ID`, `STATUS`, `PHASE`, `EXECUTOR`, `THREAD`, with widths 8, 13, 14, and 10 for the padded columns.
- Plain output must contain the original status text (for example, `needs-input`) and no ANSI escape sequences. This is the non-TTY and log-safe path.
- ANSI color is enabled only when `process.stdout.isTTY` is truthy and `NO_COLOR` is absent. A `NO_COLOR` variable with an empty value still disables color, following the convention that presence means no color.
- The status command remains read-only, keeps the existing `--watch` screen-clear sequence and two-second interval, and continues to print one line at a time.
- Do not add a color dependency, change the database schema, change `JobStatus`, change sorting, or add unrelated CLI behavior.
- Tests use the repository's existing Vitest setup under `tests/**/*.test.ts`; the final verification command is `npm run check` (`npm run build && npm test`).
- The GitHub Issue body supplies the four requirements: distinguish states visually, remain readable in non-TTY/log environments, preserve task state/sorting logic, and add tests. The workflow comments describe executor failures/retries only and add no product decision that changes this plan.

---

## File Structure

**Create:**

- `src/statusFormat.ts` — pure status-cell and table rendering helpers; owns the status-to-color mapping and color decision interface, but performs no I/O.
- `tests/statusFormat.test.ts` — unit tests for every formatter behavior and all six supported statuses.

**Modify:**

- `src/cli.ts:5-6,83-102` — import the formatter and replace only the status command's line construction with formatter calls; keep store access, ordering, watch refresh, and output control flow intact.

**Do not modify:**

- `src/store.ts` — `allJobs` already supplies the required order and limit.
- `src/types.ts` — the status model is already complete.
- `README.md` — the existing `adt status` and `adt status --watch` invocations remain valid; color is automatic and does not add a user-facing option.
- `package.json` or lockfiles — no dependency is required.

---

### Task 1: Add a tested, dependency-free status formatter

**Files:**

- Create: `src/statusFormat.ts`
- Create: `tests/statusFormat.test.ts`

**Interfaces:**

- Consumes: `JobRow` and `JobStatus` from `src/types.ts`.
- Produces for Task 2:
  - `colorEnabled(options: { isTTY: boolean; noColor?: boolean }): boolean` — returns `true` only when `isTTY` is true and `noColor` is not true.
  - `formatStatusCell(status: JobStatus, colorOn: boolean): string` — returns the status padded to the legacy width of 13 visible characters; in color mode it wraps that same padded text in one ANSI SGR code and a reset sequence.
  - `renderStatusTable(jobs: readonly JobRow[], executorKind: string, colorOn: boolean): string[]` — returns `['No ADT tasks.']` for an empty array, otherwise the unchanged header followed by one row per input job, preserving input order.

#### Step 1: Write the failing formatter tests

Create `tests/statusFormat.test.ts` with this complete content:

```ts
import { describe, expect, it } from "vitest";
import { colorEnabled, formatStatusCell, renderStatusTable } from "../src/statusFormat.js";
import type { JobRow, JobStatus } from "../src/types.js";

const statuses: JobStatus[] = [
  "queued",
  "running",
  "needs-input",
  "done",
  "failed",
  "cancelled",
];

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 1,
    repo: "owner/repository",
    event_kind: "issue-comment",
    event_id: 1,
    number: 42,
    is_pull_request: 0,
    author: "owner",
    instruction: "inspect the task",
    status: "queued",
    phase: "security",
    mode: "read",
    session_id: null,
    worktree_path: null,
    branch: null,
    plan_path: null,
    pr_number: null,
    attempts: 0,
    last_error: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("colorEnabled", () => {
  it("disables color for non-TTY output", () => {
    expect(colorEnabled({ isTTY: false })).toBe(false);
  });

  it("enables color for a TTY when no override is present", () => {
    expect(colorEnabled({ isTTY: true })).toBe(true);
  });

  it("honors the NO_COLOR decision supplied by the caller", () => {
    expect(colorEnabled({ isTTY: true, noColor: true })).toBe(false);
    expect(colorEnabled({ isTTY: false, noColor: true })).toBe(false);
  });
});

describe("formatStatusCell", () => {
  it.each(statuses)("keeps %s unchanged and padded when color is disabled", (status) => {
    expect(formatStatusCell(status, false)).toBe(status.padEnd(13));
    expect(formatStatusCell(status, false)).not.toContain("\x1b[");
  });

  it.each(statuses)("keeps %s at 13 visible characters when color is enabled", (status) => {
    expect(stripAnsi(formatStatusCell(status, true))).toHaveLength(13);
  });

  it("wraps the status cell in an ANSI color and reset sequence", () => {
    const cell = formatStatusCell("running", true);
    expect(cell).toMatch(/^\x1b\[[0-9;]+m/);
    expect(cell).toMatch(/\x1b\[0m$/);
    expect(stripAnsi(cell)).toBe("running".padEnd(13));
  });

  it("assigns a different ANSI color code to every supported status", () => {
    const codes = statuses.map((status) => {
      const match = formatStatusCell(status, true).match(/^\x1b\[([0-9;]+)m/);
      return match?.[1];
    });
    expect(new Set(codes).size).toBe(statuses.length);
  });
});

describe("renderStatusTable", () => {
  it("renders the existing empty-state text without color", () => {
    expect(renderStatusTable([], "cc-mm", false)).toEqual(["No ADT tasks."]);
  });

  it("preserves the existing header and plain row layout", () => {
    const lines = renderStatusTable(
      [job({ id: 7, repo: "Xyz9Selu/example", number: 9, status: "running" })],
      "cc-mm",
      false,
    );

    expect(lines).toEqual([
      "ID".padEnd(8) + "STATUS".padEnd(13) + "PHASE".padEnd(14) + "EXECUTOR".padEnd(10) + "THREAD",
      "A-7".padEnd(8)
        + "running".padEnd(13)
        + "security".padEnd(14)
        + "cc-mm".padEnd(10)
        + "Xyz9Selu/example#9",
    ]);
  });

  it("preserves the caller-provided row order", () => {
    const lines = renderStatusTable(
      [
        job({ id: 3, status: "done" }),
        job({ id: 1, status: "queued" }),
        job({ id: 2, status: "failed" }),
      ],
      "cc-mm",
      false,
    );

    expect(lines.slice(1).map((line) => line.slice(0, 8).trim())).toEqual(["A-3", "A-1", "A-2"]);
  });

  it("colors only the status cell while leaving other visible fields intact", () => {
    const lines = renderStatusTable([job({ status: "needs-input" })], "cc-mm", true);
    const plainRow = stripAnsi(lines[1]);

    expect(plainRow).toBe(
      "A-1".padEnd(8)
        + "needs-input".padEnd(13)
        + "security".padEnd(14)
        + "cc-mm".padEnd(10)
        + "owner/repository#42",
    );
    expect(lines[1]).toContain("\x1b[");
    expect(lines[1]).toContain("\x1b[0m");
  });
});
```

Run:

```bash
npx vitest run tests/statusFormat.test.ts
```

Expected: FAIL because `src/statusFormat.ts` does not exist yet; no implementation should be added before confirming the new test file fails for that reason.

#### Step 2: Add the minimal formatter implementation

Create `src/statusFormat.ts` with this complete content:

```ts
import type { JobRow, JobStatus } from "./types.js";

const COLUMN_WIDTHS = {
  id: 8,
  status: 13,
  phase: 14,
  executor: 10,
} as const;

const STATUS_COLORS: Record<JobStatus, string> = {
  queued: "36",
  running: "34",
  "needs-input": "33",
  done: "32",
  failed: "31",
  cancelled: "90",
};

export function colorEnabled(options: { isTTY: boolean; noColor?: boolean }): boolean {
  return options.isTTY && options.noColor !== true;
}

export function formatStatusCell(status: JobStatus, colorOn: boolean): string {
  const paddedStatus = status.padEnd(COLUMN_WIDTHS.status);
  if (!colorOn) return paddedStatus;
  return `\x1b[${STATUS_COLORS[status]}m${paddedStatus}\x1b[0m`;
}

function headerLine(): string {
  return "ID".padEnd(COLUMN_WIDTHS.id)
    + "STATUS".padEnd(COLUMN_WIDTHS.status)
    + "PHASE".padEnd(COLUMN_WIDTHS.phase)
    + "EXECUTOR".padEnd(COLUMN_WIDTHS.executor)
    + "THREAD";
}

export function renderStatusTable(
  jobs: readonly JobRow[],
  executorKind: string,
  colorOn: boolean,
): string[] {
  if (jobs.length === 0) return ["No ADT tasks."];

  const lines = [headerLine()];
  for (const job of jobs) {
    lines.push(
      `A-${job.id}`.padEnd(COLUMN_WIDTHS.id)
        + formatStatusCell(job.status, colorOn)
        + job.phase.padEnd(COLUMN_WIDTHS.phase)
        + executorKind.padEnd(COLUMN_WIDTHS.executor)
        + `${job.repo}#${job.number}`,
    );
  }
  return lines;
}
```

The implementation deliberately does not add markers, change the status text, or pad based on ANSI-inclusive string length. The color wraps the already-padded legacy cell, so stripping ANSI sequences yields exactly the current table output in every row.

#### Step 3: Run the formatter tests and the full check

Run:

```bash
npx vitest run tests/statusFormat.test.ts
npm run check
```

Expected:

- The focused formatter test passes for all six statuses, empty state, column layout, ANSI reset, and input ordering.
- `npm run check` completes successfully: TypeScript emits no errors and all existing tests plus `tests/statusFormat.test.ts` pass.

#### Step 4: Commit the self-contained formatter change during implementation

The current planning session must not run this command. When an implementation worker executes the plan and the focused/full tests are green, it may create the first implementation commit:

```bash
git add src/statusFormat.ts tests/statusFormat.test.ts
git commit -m "feat: add status table formatter"
```

---

### Task 2: Wire `adt status` to TTY-aware rendering without changing queue behavior

**Files:**

- Modify: `src/cli.ts:5-6` — add the formatter import.
- Modify: `src/cli.ts:83-102` — replace only the status row construction and keep the existing command loop.

**Interfaces:**

- Consumes: `colorEnabled` and `renderStatusTable` from `./statusFormat.js`.
- Produces: the same `adt status` data and row order as before, with ANSI color around status cells only when stdout is a TTY and `NO_COLOR` is not present.

#### Step 1: Add the formatter import

Add this import alongside the existing local imports in `src/cli.ts`:

```ts
import { colorEnabled, renderStatusTable } from "./statusFormat.js";
```

Do not change the existing store import; `allJobs` remains the source of the 50-row, `updated_at DESC` ordering.

#### Step 2: Replace the status command block

Replace the current `program.command("status")` block with this complete block:

```ts
program.command("status")
  .description("Show the ADT task queue")
  .option("--watch", "Refresh continuously")
  .action(async ({ watch }: { watch?: boolean }) => {
    const config = loadConfig();
    do {
      const db = openStore();
      const jobs = allJobs(db, 50);
      db.close();
      if (watch) process.stdout.write("\x1Bc");
      const colorOn = colorEnabled({
        isTTY: Boolean(process.stdout.isTTY),
        noColor: process.env.NO_COLOR !== undefined,
      });
      for (const line of renderStatusTable(jobs, config.executor.kind, colorOn)) {
        console.log(line);
      }
      if (watch) await sleep(2000);
    } while (watch);
  });
```

This preserves all behavior outside formatting:

- `loadConfig()` still runs once per command invocation.
- `openStore()`, `allJobs(db, 50)`, and `db.close()` stay in the same order.
- No sort, filter, state transition, or database write is introduced.
- `--watch` still clears the screen with `\x1Bc`, sleeps for 2 seconds, and repeats.
- Empty stores still print `No ADT tasks.` through the formatter.
- `console.log` remains one call per output line, preserving newline and pipe behavior.
- In a non-TTY or when `NO_COLOR` is present, the row is byte-for-byte equivalent to the current plain table.

#### Step 3: Build and run the existing automated suite

Run:

```bash
npm run build
npm test
```

Expected: both commands pass. The build must accept the new `.js` import under the repository's NodeNext/strict TypeScript configuration, and every existing test remains green.

#### Step 4: Smoke-test the CLI output modes

After the build, run these commands without adding generated `dist/` files to Git:

```bash
node dist/cli.js status --help
node dist/cli.js status | cat
NO_COLOR=1 node dist/cli.js status | cat
```

Expected:

- Help still lists `status` and `--watch`; no new option is required.
- Piped output has no `\x1b[` sequences and retains the header, status text, phase, executor, and thread columns.
- `NO_COLOR=1` also produces plain output.
- If the local store is empty, each status invocation prints exactly `No ADT tasks.`.

Do not use `adt status --watch` as an automated smoke test unless the process is run under a bounded timeout; the command is intentionally continuous and its existing Ctrl-C behavior is unchanged.

#### Step 5: Commit the CLI wiring during implementation

The current planning session must not run this command. After the implementation worker has completed the build, tests, and smoke checks, it may create the second commit:

```bash
git add src/cli.ts
git commit -m "feat: colorize status output in interactive terminals"
```

---

### Task 3: Final verification and acceptance walk-through

**Files:** none; this task verifies the two implementation commits and does not change source files.

#### Step 1: Run the repository's complete check

Run:

```bash
npm run check
```

Expected: TypeScript compilation and the complete Vitest suite both pass with exit code 0.

#### Step 2: Verify each Issue requirement against concrete behavior

1. **Different states are visually distinct:** `STATUS_COLORS` maps all six `JobStatus` values to different ANSI SGR codes; the formatter tests assert six unique codes. The status words remain present, so the distinction is still understandable when color is unavailable.
2. **Non-TTY and log output is readable:** the CLI computes `isTTY` from `process.stdout.isTTY` and disables color for non-TTY output or any `NO_COLOR` value. The plain-mode tests assert no ANSI sequences and preserve the exact status text and table fields.
3. **Task status and sorting logic are unchanged:** `src/types.ts` and `src/store.ts` are untouched; the CLI still calls `allJobs(db, 50)` and the formatter preserves the order supplied by that function. The formatter has no state mutation or sorting code.
4. **Tests are added:** `tests/statusFormat.test.ts` covers color policy, all status values, ANSI width/reset behavior, plain layout, empty state, and caller ordering; the full suite confirms no regression in the existing store, executor, intent, security, or sandbox tests.

#### Step 3: Inspect the final diff for scope

Run:

```bash
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git status --short
```

Expected: only `src/statusFormat.ts`, `tests/statusFormat.test.ts`, and `src/cli.ts` are implementation changes; no product file outside that set, generated build output, dependency lockfile, or unrelated formatting change is present. `git diff --check` reports no whitespace errors.

The current session stops after writing this plan: it must not execute implementation, test, commit, push, or Draft PR commands.

---

## Plan self-review

- **Spec coverage:** The four Issue bullets map directly to Task 1's status/color tests, Task 2's TTY/`NO_COLOR` wiring, the unchanged `allJobs` call and row-order test, and the new formatter test file.
- **Placeholder scan:** Every implementation step includes complete code or an exact command with an expected result. The only references to "current planning session" explicitly prevent execution here; there are no TODO/TBD or unspecified follow-up behaviors.
- **Type consistency:** The `JobStatus` and `JobRow` imports match `src/types.ts`; `colorEnabled` accepts `{ isTTY: boolean; noColor?: boolean }` and the CLI passes those fields; `renderStatusTable` accepts `readonly JobRow[]`, `string`, and `boolean` exactly as its call site uses them.
- **Layout correctness:** Color wraps the 13-character padded status cell, so ANSI stripping recovers the legacy row byte-for-byte. This avoids the common mistake of padding a string whose escape codes were counted as visible characters.
- **Scope correctness:** No new dependency, schema change, state transition, ordering change, watch-loop change, README change, commit, push, or PR creation is needed for the requested behavior.
