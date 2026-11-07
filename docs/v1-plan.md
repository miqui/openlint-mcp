# OpenLint MCP server: v1 plan

Status: draft · Tracking issue: [openlint/openlint#13](https://github.com/openlint/openlint/issues/13)

## Goal

An MCP server that lets AI agents lint API documents (OpenAPI, AsyncAPI, Arazzo) with OpenLint, look up rules, and check rulesets they write. It talks over stdio and runs with `npx`.

It lives in its own repo (this one) and builds only on **published** `@openlint/*` npm packages, as the maintainers asked on #13. The plan is to move it to the `openlint` org later, probably as `openlint/mcp`.

## Decisions from #13

| Topic | Decision | Source |
|---|---|---|
| Location | Separate repo, not `packages/mcp` | P0lip |
| `detect_format` | Dropped. `lint_document` returns the formats it matched instead. | P0lip |
| `list_rulesets` | Lists the rulesets the server is **configured** with, not a set of "built-ins" | P0lip |
| `validate_ruleset` | In v1 (read-only, high value) | kinlane |
| Input | `content` is the only document input in v1. `path` comes later, behind a flag. | kinlane |
| Output size | Severity counts first, plus `severity` threshold, `limit` and grouping by rule `code` | kinlane |
| Org config | Default ruleset set at startup (`--ruleset` or env), which a call can override | kinlane |
| Format names | Accept `swagger` as a synonym for OpenAPI 2.0 | kinlane |
| Imports | Named imports from `@openlint/openlint-core` only | kinlane |
| CLI output | Don't wrap the CLI or pass its JSON through. Call `core` directly. | kinlane |
| Prompts / resources | After v1 (v1.1) | kinlane |

## Dependencies

All are already on npm:

| Package | Version | Used for |
|---|---|---|
| `@openlint/openlint-core` | 0.1.1 | `OpenLint`, `Document`, `Ruleset`, `Rule`, `assertValidRuleset`, `RulesetValidationError` |
| `@openlint/openlint-parsers` | 1.0.0 | `Yaml` / `Json` parsers for documents and inline rulesets |
| `@openlint/openlint-rulesets` | 0.1.0 | `oas`, `asyncapi`, `arazzo` ruleset objects |
| `@openlint/openlint-ruleset-bundler` | 0.1.1 | `bundleAndLoadRuleset` (`/with-loader`) for ruleset **files** (YAML/JSON/JS) |
| `@openlint/openlint-ruleset-migrator` | 0.1.0 | Resolving `extends: spectral:oas`-style aliases in YAML/JSON rulesets |
| `@openlint/openlint-runtime` | 0.0.1 | `fetch` for the loader's `io` |
| `@openlint/openlint-ref-resolver` | 0.1.0 | Building a resolver with external refs turned off (see Safety) |
| `@modelcontextprotocol/sdk` | ^1.32 | Server, stdio transport, in-memory transport for tests |
| `zod` | ^4 | Tool input schemas |

Core is CommonJS. This package is ESM and imports core by name. It needs Node `^22 || >=24`, the same as the CLI.

**Checked against the published npm packages** (not the monorepo build), 2026-11-07:
- Named ESM imports work: `{ OpenLint, Document }` from core, `{ Yaml }` from parsers, `{ oas }` from rulesets, and `{ bundleAndLoadRuleset }` from the bundler's `/with-loader` entry.
- Linting an OAS 3.0 document with `oas` works (9 results). The CLI's JS-ruleset crash doesn't happen here.
- After `run()`, `document.formats` holds the matched formats (for example `OpenAPI 3.x`, `OpenAPI 3.0.x`), so `lint_document` can report them.
- `bundleAndLoadRuleset(file, { fs, fetch })` loads a YAML ruleset file with `extends: ["spectral:oas"]` and gives the same results as the CLI.

## Tools (v1)

All tools are read-only. None of them write files.

### `lint_document`

- **Input:**
  - `content` (string, required)
  - `ruleset` (optional): the name of a configured ruleset, or an inline YAML/JSON ruleset string
  - `severity` (`error|warn|info|hint`, default `hint`): the threshold
  - `limit` (default 50)
  - `groupBy` (`none|code`, default `code`)
- **Output:**
  - `formats`: the formats matched by the active ruleset; empty means unrecognized
  - `counts`: `{ error, warn, info, hint }`
  - `diagnostics`, either:
    - grouped: `{ code, severity, message, count, first: { path, range } }[]`
    - flat: `{ code, severity, message, path, range }[]`
  - `truncated: boolean`
- **Notes:**
  - Diagnostics are sorted by severity, most severe first, then by code.
  - Counts always cover every result, even when `limit` truncates the list.

### `list_rulesets`

- **Input:** none
- **Output:** the configured rulesets, `{ name, source, isDefault, ruleCount, formats }[]`

### `list_rules`

- **Input:**
  - `ruleset` (optional; default ruleset if omitted)
  - `format` (optional, e.g. `oas3`; `swagger` is treated as `oas2`)
  - `enabledOnly` (default `true`)
- **Output:** `{ name, severity, recommended, formats, description }[]`

### `explain_rule`

- **Input:** `rule` (required), `ruleset` (optional)
- **Output:** `description`, `message`, `severity`, `given`, `formats`, `documentationUrl`, and **`extensions`**
- **Note on `extensions`:** core already supports a free-form `extensions` object on rule definitions (core `Rule.extensions`, added upstream in #2345). Rulesets can put agent guidance there, such as `extensions: { prompt: "…" }`, and this tool returns it as is. That covers kinlane's point 6 without a spec change. We should document it as the convention.

### `validate_ruleset`

- **Input:** `content` (YAML or JSON string)
- **Output:** `{ valid: boolean, errors: { message, path }[] }`, built from `RulesetValidationError`
- **Note:** JS rulesets aren't supported in v1.

## Ruleset sources

1. **Startup default:** `openlint-mcp --ruleset ./.openlint.yaml`, or the `OPENLINT_RULESET` env var. It is loaded with `bundleAndLoadRuleset`, so YAML, JSON and JS files all work. This is set by whoever runs the server, so it is trusted.
2. **Named extras** (optional): `--ruleset name=path`, which can be repeated. These show up in `list_rulesets`.
3. **Fallback** when nothing is configured: the `oas`, `asyncapi` and `arazzo` exports of `@openlint/openlint-rulesets`, recommended rules only. `list_rulesets` labels them by package rather than calling them "core" rulesets.
4. **Per-call inline** (`ruleset` given as YAML/JSON text): parsed, aliases resolved, then validated. This text comes from the caller, so it is untrusted (see Safety).

**Spike needed:** the migrator's `migrateRuleset(filepath, { fs, … })` expects a file path. For inline text we have two options:
- the bundler's `stdin` plugin, which the CLI uses for rulesets read from stdin
- an in-memory `fs`

Pick one in PR 2. If neither works cleanly, open a small upstream PR to export a content-based helper. That is the "expose missing members" route P0lip suggested.

## Safety

- **No document reads from disk or network in v1.** Input is `content` only.
- **External `$ref`s:** by default the resolver would follow `file:` and `http(s):` refs found in `content`. v1 turns off external resolution by default and adds an `--allow-external-refs` startup flag. The plan is a resolver from `@openlint/openlint-ref-resolver` that has no `file` or `http` handlers, passed through `OpenLint`'s `resolver` option. Confirm this in PR 3.
- **No custom JS from callers.** Inline rulesets that declare `functions` or `functionsDir` are rejected. Custom functions are only allowed in the startup ruleset.
- **Inline `extends` is limited to an allowlist.** Each entry may only be one of:
  - the name of a configured ruleset
  - a `spectral:*` or `openlint:*` alias

  Anything else is rejected before the migrator or bundler sees it:
  - URLs: the remote ruleset could pull in and run remote JS
  - relative or absolute paths: these read files on the server's disk
  - npm package names: these trigger package resolution

  The same check applies to entries inside `overrides`. Without it, the `functions` rule above could be bypassed.

## Repo setup (PR 1)

Mirrors the OpenLint monorepo conventions:

- TypeScript build with `tsc`
- Vitest for tests
- ESLint and Prettier
- commitlint (conventional commits) with husky; this applies to PR titles too
- `semantic-release` for versioning
- GitHub Actions CI: lint, test and build on Node 22 and 24
- `bin: { "openlint-mcp": "./dist/index.js" }`, published as `@openlint/openlint-mcp` once transferred (until then, unpublished or under a personal scope)
- License: Apache-2.0 (already in the repo)

## Testing

- Tests drive the server through the MCP SDK's in-memory transport and a real `Client`. No stdio is needed.
- Small OpenAPI 2.0, 3.0 and 3.1, AsyncAPI and Arazzo fixtures. kinlane offered fixtures from `api-commons/api-governance-mcp`, already checked against Spectral 6.16.1.
- Cases to cover:
  - unrecognized format
  - grouping and truncation
  - an inline ruleset that is invalid
  - an inline ruleset that declares `functions` (rejected)
  - an inline ruleset whose `extends` is a URL, a relative or absolute path, or a package name (rejected)
  - an external `$ref` when external resolution is off
- Smoke test: `npx @modelcontextprotocol/inspector` against the built binary

## Milestones (one PR each)

1. **Scaffold.** Tooling and CI; a server that starts on stdio with no tools.
2. **Ruleset service.** Startup and fallback loading, inline parsing (the spike), the `extends` allowlist and the `functions` rejection, `validate_ruleset`, `list_rulesets`.
3. **`lint_document`.** Output shaping (counts, grouping, limit), external-ref policy.
4. **`list_rules` and `explain_rule`.** Format synonyms, `extensions` passthrough.
5. **Docs and release.** README with client setup (`claude mcp add openlint -- npx openlint-mcp --ruleset ./.openlint.yaml`, and other clients), first release.

## Later (v1.1+)

- `path` input behind `--allow-path <dir>` (an allowlist of directories)
- MCP **prompts**: "fix these diagnostics", "write a ruleset from this style guide"
- MCP **resources**: `openlint://rulesets/{name}/rules`, rule docs
- JS rulesets in `validate_ruleset`

## Upstream follow-ups (small PRs to `openlint/openlint`)

- Add the missing `openlint:oas` alias in `packages/ruleset-migrator/src/transformers/extends.ts`. `openlint:asyncapi` and `openlint:arazzo` exist, but `openlint:oas` doesn't.
- JS (`.mjs`) rulesets that import `oas` crash in the CLI on OAS 3.0 documents: `oasDocumentSchema … a is not a function`. The same ruleset works through `core` directly, so the bug is likely in the bundler path. The published packages don't hit it with a YAML ruleset, but a startup `--ruleset` written in JS might. Reproduce it during PR 2 and file it.
- Export a content-based ruleset loader, if the spike shows one is needed.

## Open questions

1. What npm name to use before the transfer: unpublished, `@miqui/openlint-mcp`, or ask now for `@openlint/openlint-mcp`?
2. Should the fallback load all three rulesets, or start with none and tell the agent to configure one?
3. Should `lint_document` accept a `format` hint (`yaml|json`), or always parse as YAML (a superset of JSON)?
