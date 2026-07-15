# Mention-driven ADT implementation plan

## Goal

Replace the previous autonomous stage machine with a human-directed GitHub
assistant. An allow-listed mention becomes one idempotent job. The agent may
analyze, grill or complete an implementation and Draft PR, depending on the
explicit instruction.

## Work packages

1. Establish a new TypeScript CLI with validated configuration, SQLite state,
   repository registration and operational commands.
2. Poll Issue comments, PR conversation comments, reviews and inline comments;
   enforce author allow-listing and event idempotency.
3. Add deterministic input rules and a tool-less model security review before
   invoking the coding agent.
4. Implement a queue with per-thread serialization, bounded global concurrency,
   cancellation controls, restart recovery and visible GitHub labels.
5. Implement the `cc-mm` adapter using JSON Schema results, native session IDs,
   resume, Superpowers planning and subagent-driven implementation.
6. Run the executor through a capability-preserving bubblewrap profile while
   withholding GitHub and SSH credentials.
7. Make ADT own Git commit, branch push and Draft PR creation, so delivery can
   retry independently from implementation.
8. Add synchronous TUI grill, status, doctor, retry, cancel and cleanup commands.
9. Validate intent classification, safety rules, persistence, scheduling,
   sandbox command construction and executor protocol with automated tests.

## Completion criteria

- `npm run check` passes.
- `npm audit --omit=dev` reports no production vulnerabilities.
- A real `cc-mm` call satisfies the security-review JSON protocol.
- `adt init`, `adt status` and `adt --help` execute successfully.
- `adt doctor` clearly reports missing host prerequisites such as bubblewrap.
- No GitHub credential is passed to the executor process.
- Documentation describes setup, operation, recovery and the agreed safety
  boundaries.
