# ADT design

## Product definition

ADT is an on-demand GitHub development assistant. The human owner controls the
workflow. ADT acts only when an allow-listed user mentions the configured agent
account in an Issue or Pull Request.

GitHub is the collaboration record. Local repositories, worktrees, executor
sessions and logs are implementation details managed by the daemon.

## Identities and authorization

- Repository owner: `Xyz9Selu`.
- Agent account: `api001endlessstudio-sketch`, with write access.
- Only users in `allowedUsers` may trigger work.
- Events authored by the agent account are always ignored.
- Event IDs are persisted with a unique constraint, so polling is idempotent.

## Accepted events

The first release polls every configured repository for:

- Issue and PR conversation comments;
- PR review bodies;
- PR inline review comments.

Editing an Issue or PR body, assignment and label changes do not trigger ADT.

## Intent and authorization

Read-only language such as “analyze”, “inspect”, “explain” or “grill” grants no
permission to edit. Explicit implementation language such as “implement”,
“fix”, “modify”, “start implementation” or “address review” permits changes.
Ambiguous requests default to read-only.

“Start implementation” means the complete delivery workflow: plan, implement,
test, commit, push and open a Draft PR. Merge is never implicit.

## Grill

GitHub grill asks three to five high-value questions per turn. When synchronous
conversation is preferable, `adt grill owner/repo#number` launches the configured
executor in its native TUI. At the end, the executor posts a requirements
summary, acceptance criteria and open questions. Grill never starts
implementation automatically.

## Implementation

The configured executor is fixed for a run. Version one supports `cc-mm` and
defines an adapter interface for `cc-oc` and OpenCode.

Implementation uses two executor invocations:

1. Superpowers planning writes `docs/plans/<issue>-<slug>.md` and exits without
   changing product code.
2. Superpowers subagent-driven development reads the plan, delegates the work,
   runs tests and returns a structured result.

ADT, not the executor, commits, pushes and opens the Draft PR.

## Human interaction and recovery

An executor that needs a decision returns `needs-input` with structured
questions and a checkpoint. ADT posts the questions to the originating thread,
persists the executor session ID and exits the process. A later allow-listed
mention resumes that session. If native resume fails, ADT starts a fresh session
with the plan, worktree, execution record and GitHub discussion as context.

Cancel stops the process but preserves all artifacts. A later “continue”
resumes the cancelled task. Parse failures and executor crashes retry once.
Delivery failures retry only commit/push/PR creation, never implementation.

## Scheduling and visibility

- Default global concurrency is two.
- A single Issue or PR has at most one running job.
- Every job uses a separate worktree and branch.
- New feedback arriving during a run is queued for the next job.
- ADT adds an eyes reaction when possible and manages the labels
  `agent:queued`, `agent:running`, `agent:needs-input`, `agent:done`,
  `agent:failed` and `agent:cancelled`.

## Isolation

Executors run through bubblewrap. The sandbox retains the host toolchain,
network access and selected executor configuration. It exposes only the current
repository/worktree as writable state and hides SSH, GitHub CLI credentials,
other repositories and ADT state. GitHub credentials remain in the ADT process.

## Cleanup

ADT polls linked PRs. When `merged_at` becomes non-null, it marks the thread
complete and removes its worktree. Closed but unmerged work is preserved.
Task records and logs expire after 30 days. Remote branch deletion is left to
GitHub repository settings.
