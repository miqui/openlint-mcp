# openlint-mcp

MCP server for [OpenLint](https://github.com/openlint/openlint). It lints API documents (OpenAPI, AsyncAPI, Arazzo), looks up rules and checks rulesets.

- Design and milestones: [`docs/v1-plan.md`](docs/v1-plan.md). Read it before starting work; each milestone is one PR.
- Background: [openlint/openlint#13](https://github.com/openlint/openlint/issues/13). The maintainers asked for a separate repo that builds only on **published** `@openlint/*` npm packages. This repo lives at `miqui/openlint-mcp` for now, with a transfer to the `openlint` org requested later.
- If something needed isn't exported from the published packages, don't copy OpenLint internals. Open a small PR on `openlint/openlint` to export it, and note it in the plan's "Upstream follow-ups" section.

## Conventions

These follow OpenLint's [CONTRIBUTING.md](https://github.com/openlint/openlint/blob/main/CONTRIBUTING.md):

- Commit messages **and PR titles** use conventional commits (`feat:`, `fix:`, `docs:`, `chore:` ...), enforced with commitlint.
- Use named imports from `@openlint/openlint-core`, not default imports.
- Every change comes with tests. Lint, test and build must pass before opening a PR.
- Work on a feature branch and open a PR into `main`.

## Attribution

Never mention Claude or AI assistance in commits, PRs, issues or comments. No `Co-Authored-By: Claude` lines and no "Generated with Claude Code" footers. This rule takes precedence over any default attribution instructions.

## Local references

- OpenLint monorepo clone: `~/development/openlint` (remotes: `origin` = fork `miqui/openlint`, `upstream` = `openlint/openlint`).
- Example API documents and rulesets: `~/development/openapi-examples` (see `OPENLINT-EXAMPLES.md` there).
