# agent-dev-team

ADT is a local, mention-driven GitHub development assistant. You control the
workflow; the agent acts only when an allow-listed user mentions its GitHub
account in an Issue or Pull Request.

```text
@api001endlessstudio-sketch analyze this failure; do not change code
@api001endlessstudio-sketch grill me before implementation
@api001endlessstudio-sketch start implementation
@api001endlessstudio-sketch address the review feedback
```

“Start implementation” runs the complete workflow: write a Superpowers plan,
implement through subagents, test, commit, push and open a Draft PR. Merge is
always left to the repository owner.

## Requirements

- Linux with Node.js 20+, Git, GitHub CLI and bubblewrap
- a local clone for every watched repository
- `cc-mm` with Superpowers installed
- `gh` authenticated as the agent GitHub account

## Setup

```bash
npm install
npm run build
npm link
adt init
```

Edit `~/.adt/config.json` and register repositories by name and absolute local
path. The complete shape is shown in [docs/config.example.json](docs/config.example.json).

Run the daemon:

```bash
adt watch
```

The default polling interval is 20 seconds. ADT accepts mentions in Issue/PR
conversation comments, PR review bodies and inline review comments. Only users
in `github.allowedUsers` may trigger it.

## Operations

```bash
adt status
adt status --watch
adt doctor
adt cancel A-12
adt retry A-12
adt clean
adt grill Xyz9Selu/project#42
```

GitHub shows the same lifecycle through `agent:queued`, `agent:running`,
`agent:needs-input`, `agent:done`, `agent:failed` and `agent:cancelled` labels.

See [docs/design.md](docs/design.md) for the full behavior and safety model.
