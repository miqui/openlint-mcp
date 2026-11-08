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
| `@openlint/openlint-ruleset-bundler` | 0.1.1 | `bundleAndLoadRuleset` (`/with-loader`) for configured ruleset files (YAML/JSON/JS). It runs the migrator, which resolves `spectral:oas`-style aliases, so the migrator isn't a direct dependency. Inline rulesets don't use it (see Ruleset sources). |
| `@openlint/openlint-functions` | 0.1.0 | Names of the built-in functions, for checking `then.function` |
| `@openlint/openlint-formats` | 0.1.0 | Format exports, the source of truth for `formats` names in inline rulesets |
| `@openlint/openlint-runtime` | 0.0.1 | `fetch` for the loader's `io` |
| `@openlint/openlint-ref-resolver` | 0.1.0 | Building a resolver with external refs turned off (see Safety) |
| `@modelcontextprotocol/sdk` | ^1.32 | Server, stdio transport, in-memory transport for tests |
| `zod` | ^4 | Tool input schemas |

Core is CommonJS. This package is ESM and imports core by name. It needs Node `^22.22.1 || >=24`. That's the CLI's `^22 || >=24`, with the 22.x minimum raised to 22.22.1 because the dev toolchain needs it (lint-staged).

**Checked against the published npm packages** (not the monorepo build), 2026-11-07:
- Named ESM imports work: `{ OpenLint, Document }` from core, `{ Yaml }` from parsers, `{ oas }` from rulesets, and `{ bundleAndLoadRuleset }` from the bundler's `/with-loader` entry. Exception: `fetch` from `@openlint/openlint-runtime` needs the default import on Node 22 (see Upstream follow-ups).
- Linting an OAS 3.0 document with `oas` works (9 results). The CLI's JS-ruleset crash doesn't happen here.
- After `run()`, `document.formats` holds the matched formats (for example `OpenAPI 3.x`, `OpenAPI 3.0.x`), so `lint_document` can report them.
- `bundleAndLoadRuleset(file, { fs, fetch })` loads a YAML ruleset file with `extends: ["spectral:oas"]` and gives the same results as the CLI.

## Tools (v1)

All tools are read-only. None of them write files.

### `lint_document`

- **Input:**
  - `content` (string, required)
  - `filename` (optional, PR 3): a plain file name such as `openapi.json`, never read from disk. It can't contain directories or `#`, `?` and `%`, which would change how relative refs resolve. A `.json` name selects the JSON parser, otherwise YAML (open question 3). The document gets this name as if it sat next to the active ruleset's file (or in the working directory), so the ruleset's `overrides` match it. Default `document.yaml`.
  - `ruleset` (optional): the name of a configured ruleset (or `oas`, `asyncapi`, `arazzo`, an alias), or an inline YAML/JSON ruleset string
  - `severity` (`error|warn|info|hint`, default `hint`): the threshold
  - `limit` (1–1000, default 50)
  - `groupBy` (`none|code`, default `code`)
- **Output:**
  - `formats`: the formats matched by the active ruleset; empty means unrecognized (core also adds an `unrecognized-format` diagnostic)
  - `counts`: `{ error, warn, info, hint }`
  - `diagnostics`, either:
    - grouped: `{ code, severity, message, count, first: { path, range, source? } }[]`
    - flat: `{ code, severity, message, path, range, source? }[]`
    - `source` is set only for problems in another document, reached through a `$ref`
  - `truncated: boolean`
  - `notes: string[]` (PR 3): hints about the result, such as external `$ref`s that weren't followed
- **Notes:**
  - Diagnostics are sorted by severity, most severe first, then by code, then by path and position.
  - A group's severity is its most severe diagnostic's, and its message and location are that diagnostic's.
  - Counts always cover every result, even when `severity` or `limit` leave some out.
  - Ranges are 0-based lines and characters. Messages refer to files relative to the document's directory (including sibling files, as `../shared/x.yaml`), not as server paths. URLs and OpenAPI paths such as `/pets` are left as they are.
  - A ruleset the server can't use (unknown name, refused inline ruleset) is a tool error (`isError`) listing the issues, not an empty result.
  - With `--allow-external-refs`, the tool's `openWorldHint` annotation is `true`.

### `list_rulesets`

- **Input:** none
- **Output:** `{ rulesets: { name, source, isDefault, ruleCount, formats }[] }`, the configured rulesets
- **Notes:**
  - `ruleCount` counts enabled rules, which are the ones `lint_document` runs. For example, `oas` has 57 rules, 46 of them enabled.
  - Rulesets passed inline aren't listed, because they only exist for one call. P0lip suggested listing them on #13. We decided not to, for that reason.

### `list_rules`

- **Input:**
  - `ruleset` (optional; default ruleset if omitted): a name or an inline ruleset, as for `lint_document`
  - `format` (optional, e.g. `oas3`; `swagger` is treated as `oas2`)
  - `enabledOnly` (default `true`)
- **Output:** `{ rules: { name, severity, enabled, recommended, formats, description }[] }`, sorted by name
- **Notes (PR 4):**
  - `severity` is `error|warn|info|hint`, or `off`. `formats` are display names; empty means the rule applies to all of the ruleset's formats.
  - **Format names:** `format` resolves against `@openlint/openlint-formats`, like inline rulesets, ignoring case, whitespace, `.`, `_` and `-`. It also accepts `swagger` (OpenAPI 2.0), `openapi<version>` and `asyncapi<version>`, so `OpenAPI 3.1` and `asyncapi3` work.
  - **Format families:** a format includes rules declared for formats whose names extend each other. `oas3.1` includes rules for `oas3` (OpenAPI 3.x) and `oas3_1`; `oas3` includes rules for every `oas3_*`. Core's `Rule.matchesFormat` does the match.
  - Unknown formats and rulesets are tool errors.
  - `filename` (PR 4 review): rules are listed as `lint_document` would apply them to a document of that name, with core's `Ruleset.fromSource`, so rules that `overrides` add or turn off are included. Severity changes that overrides make for parts of a document (`files: ["openapi.yaml#/paths"]`) aren't reflected, since they apply per path while linting.

### `explain_rule`

- **Input:** `rule` (required), `ruleset` (optional)
- **Output:** `description`, `message`, `severity`, `given`, `formats`, `documentationUrl`, and **`extensions`**. PR 4 adds `name`, `enabled`, `recommended`, and `then` (`{ function, field?, functionOptions? }[]`).
- **Notes (PR 4):**
  - `given` is as written, so it may name the ruleset's aliases (`#OperationObject`).
  - `functionOptions` is left out when its JSON is over 2,000 characters, such as a whole JSON Schema, or when it can't be serialized (a `BigInt`, a cycle).
  - `then.function` is the name the ruleset registered the function under. For YAML/JSON rulesets configured at startup, the server reads it from the ruleset file. Otherwise it's the function's own name, which the bundler usually derives from the function's file name.
  - `filename` works as for `list_rules`.
  - An unknown rule is a tool error that suggests similar names, closest first.
- **Note on `extensions`:** core already supports a free-form `extensions` object on rule definitions (core `Rule.extensions`, added upstream in #2345). Rulesets can put agent guidance there, such as `extensions: { prompt: "…" }`, and this tool returns it as is. That covers kinlane's point 6 without a spec change. *PR 4:* the README documents `extensions.prompt` as the convention for agent guidance.

### `validate_ruleset`

- **Input:** `content` (YAML or JSON string)
- **Output:** `{ valid: boolean, errors: { message, path }[], warnings: { message, path }[] }`
- **Notes:**
  - Validation runs no code. Core's `assertValidRuleset(definition, 'json')` checks the YAML/JSON form, which names functions as strings, so no placeholder functions are needed. On top of that, every `then.function` must be built in or declared in `functions`.
  - `valid` means the ruleset is well formed. `warnings` list what `lint_document` would refuse inline, such as custom functions or extending files, URLs or packages. Those rulesets can still be configured with `--ruleset`.
  - If there are no warnings, the ruleset is also loaded the way `lint_document` loads it, so `valid` covers its `extends` too.
  - JS rulesets aren't supported in v1.

## Ruleset sources

1. **Startup default:** `openlint-mcp --ruleset ./.openlint.yaml`, or the `OPENLINT_RULESET` env var. The flag wins when both are set. It is loaded with `bundleAndLoadRuleset`, so YAML, JSON and JS files all work, including custom functions. This is set by whoever runs the server, so it is trusted.
2. **Named extras** (optional): `--ruleset name=path`, which can be repeated. These show up in `list_rulesets`. Without an unnamed `--ruleset` or a non-empty `OPENLINT_RULESET`, the first named one is the default. `oas`, `asyncapi` and `arazzo` are reserved names.
3. **Fallback** when nothing is configured (open question 2, decided): the `oas`, `asyncapi` and `arazzo` exports of `@openlint/openlint-rulesets`, recommended rules only.
   - `list_rulesets` labels them by package, not as "core" rulesets, and marks all three as defaults.
   - The default ruleset extends all three. Each rule only runs on documents of its own formats.
4. **Per-call inline** (`ruleset` given as YAML/JSON text): parsed, checked against the inline policy (see Safety), validated, then built with core. This text comes from the caller, so it is untrusted.
   - `oas`, `asyncapi` and `arazzo` can always be used in an inline `extends`, even when other rulesets are configured. `extends: [oas]` is the preferred form.
   - A tool's `ruleset` argument can also be one of those names, a configured name or an alias.

Startup errors (a bad flag, or a ruleset that fails to load) go to stderr and exit with status 1. The server never falls back silently. MCP clients often start servers with an unexpected working directory, so the README should recommend absolute ruleset paths.

**How inline rulesets are loaded (PR 3; replaces the PR 2 spike result):** they're built with core's `Ruleset` directly, without the bundler.
- **How it works:** after the inline policy check, every name in the ruleset is one the server can map to an object it already holds:
  - `then.function` names map to `@openlint/openlint-functions` exports.
  - `formats` names map to `@openlint/openlint-formats` exports.
  - `oas`, `asyncapi`, `arazzo` and their aliases map to the `@openlint/openlint-rulesets` definitions.
  - Configured ruleset names map to the definitions loaded at startup, custom functions included.

  The mapped definition goes to `new Ruleset(…, { severity: 'recommended' })`, which validates the JS form, including rule overrides.
- **Why it changed:** in PR 2, inline rulesets were bundled from an in-memory entry file. That bundled a configured ruleset again whenever an inline ruleset extended it, re-reading its files and re-running its code. `lint_document` would have done that on every call. PR 2 avoided building by hand because it meant copying the migrator's tables. The policy now limits names to package exports and loaded rulesets, so nothing needs copying.
- **Results:**
  - An inline `extends: [my-org]` keeps `my-org`'s custom functions working, and its files aren't read again.
  - Inline rulesets read no files and fetch nothing themselves, and the only functions they name are built-in ones. Rules they inherit from a configured ruleset run that ruleset's custom functions, which are trusted like the rest of the server's configuration.
  - `overrides` of an extended ruleset don't apply. Core only applies `overrides` on the top-level ruleset, and that was already true with the bundler.

## Safety

- **No document reads from disk or network in v1.** Input is `content` only.
- **External `$ref`s:** core's default resolver follows `file:` and `http(s):` refs found in `content`. v1 turns off external resolution by default and adds an `--allow-external-refs` startup flag.
  - *Confirmed in PR 3:* `lint_document` passes `new Resolver()` from `@openlint/openlint-ref-resolver`, which has no `file` or `http` handlers, through `OpenLint`'s `resolver` option. External refs become `invalid-ref` errors ("No resolver defined for scheme …"), and refs inside the document still resolve. Tests check that no request is made and no file is read, with positive controls for both.
  - With the flag, it uses `createHttpAndFileResolver()`, the same resolver as core's default. Relative refs then resolve against the document's directory: the active ruleset's directory, or the working directory. Each HTTP request has a 10-second timeout and is cancelled when the MCP call is cancelled.
  - `$ref`s inside rule options (for example a `schema` function's `functionOptions`) aren't fetched either way; a test checks this.
- **No custom JS from callers.**
  - Inline rulesets that declare `functions` or `functionsDir`, at the top level or in `overrides`, are rejected.
  - Inline rulesets can't use `overrides` at all (PR 3), since their `files` patterns have no ruleset file to be relative to.
- **Inline JSONPath stays plain (PR 3).** `lint_document` evaluates an inline ruleset's JSONPath against documents. As defense in depth, inline `given`, `then.field` and alias paths can't contain filter or script expressions (anything with `(`). Configured rulesets can use them, and `validate_ruleset` warns instead of erroring. `npm audit --omit=dev` reports no known vulnerabilities in the dependencies (checked in PR 3).
  - Every inline `then.function` must name a built-in function from `@openlint/openlint-functions`.
  - Custom functions are only allowed in rulesets configured at startup.
- **Inline `formats` names must be exports of `@openlint/openlint-formats`.**
  - **Where:** the check covers every place the migrator reads `formats`: the ruleset, `overrides`, rules, and `aliases` targets.
  - **Matching:** names are matched against the package's format exports (the exports with a `displayName`), ignoring case, `.`, `_` and `-`. So `oas3.1`, `oas3_1` and `OAS3.1` all mean `oas3_1`, and `json-schema-draft7` means `jsonSchemaDraft7`.
  - **Mapping:** each name is replaced by the format function it names before the ruleset is built.
  - **Why not the migrator's table:** it has drifted from the package. `asyncapi3` and `arazzo1` are listed but fail to load, and `oas3.2` isn't listed but works.
  - **Scope:** configured rulesets are trusted and still go through the migrator unchanged.
- **The general rule:** every name in an inline ruleset that the migrator resolves must come from a fixed set: built-in function names, format exports, ruleset aliases and configured rulesets. If the migrator starts resolving other fields, extend the check.
- **Inline `extends` is limited to an allowlist.** Each entry may only be one of:
  - the name of a configured ruleset
  - `oas`, `asyncapi` or `arazzo`
  - one of the exact aliases the migrator knows: `spectral:oas`, `spectral:asyncapi`, `spectral:arazzo`, `openlint:openapi`, `openlint:asyncapi`, `openlint:arazzo`

  A prefix match on `spectral:*` or `openlint:*` would not be safe. The migrator resolves any other name, such as `spectral:bogus`, as a file path relative to the ruleset. Name lookups use a `Map`, so names like `constructor` or `__proto__` don't match `Object` prototype keys.

  Anything else is rejected before the ruleset is built:
  - URLs: the remote ruleset could pull in and run remote JS
  - relative or absolute paths: these read files on the server's disk
  - npm package names: these trigger package resolution

  The same check applies to entries inside `overrides`, and to plain-string, list and `[name, severity]` forms. Without it, the `functions` rule above could be bypassed. Tests check that `fs.promises.readFile` isn't called for any rejected ruleset.

## Repo setup (PR 1)

Mirrors the OpenLint monorepo conventions:

- TypeScript build with `tsc`
- Vitest for tests
- ESLint and Prettier
- commitlint (conventional commits) with husky; this applies to PR titles too
- `semantic-release` for versioning (PR 5: GitHub releases only until the transfer; see Distribution)
- GitHub Actions CI: lint, test and build on Node 22 and 24
- `bin: { "openlint-mcp": "./dist/index.js" }`, published to npm as `@openlint/openlint-mcp` once transferred (until then, GitHub releases only)
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
  - an external `$ref` when external resolution is off, and when it's on
  - each format (OpenAPI 2.0, 3.0, 3.1, AsyncAPI, Arazzo), invalid YAML, and the JSON parser for `.json` names
  - severity threshold, and `overrides` in a configured ruleset matched against `filename`
- Smoke test: `npm run smoke` (`scripts/smoke.js`) starts `dist/index.js` over stdio with the SDK's stdio client. It checks the handshake, `list_rulesets`, a `validate_ruleset` call that builds an inline ruleset, and `lint_document` with the default rulesets, an inline ruleset, and `--allow-external-refs`. CI runs it on Node 22 and 24. For manual checks, use `npx @modelcontextprotocol/inspector` against the built binary.

## Milestones (one PR each)

1. **Scaffold.** Tooling and CI; a server that starts on stdio with no tools.
2. **Ruleset service.** Startup and fallback loading, inline parsing (the spike), the `extends` allowlist and the `functions` rejection, `validate_ruleset`, `list_rulesets`.
3. **`lint_document`.** Output shaping (counts, grouping, limit), external-ref policy.
4. **`list_rules` and `explain_rule`.** Format synonyms, `extensions` passthrough.
5. **Docs and release.** Setup steps for Claude Code, Claude Desktop, Codex and OpenCode were added to the README in PR 2, and were checked against each tool's docs and, for Claude Code and Codex, against the files their `mcp add` commands write. *PR 5:* the first release, on GitHub only (see Distribution). The README installs from the release tarball and uses the `openlint-mcp` command, with absolute paths for Claude Desktop. The npm release, and switching the examples to `npx -y @openlint/openlint-mcp`, wait for the transfer.

### Distribution (PR 5)

- **No npm until the transfer** (open question 1). The package stays `private: true`, and semantic-release runs with `npmPublish: false`.
- **What a release does:** `release.yml` runs on pushes to `main`, after CI (`ci.yml` through `workflow_call`). semantic-release:
  - picks the version from the conventional commits (the first release is 1.0.0)
  - writes `CHANGELOG.md`
  - commits the version bump (`chore(release): x.y.z [skip ci]`)
  - tags it
  - creates a GitHub release with the packed package (`npm pack`, which builds `dist/`) as `openlint-mcp.tgz`

  It uses the built-in `GITHUB_TOKEN` with `contents: write` only. It makes no issue or PR comments and adds no labels, and it never runs in forks. `workflow_dispatch` runs a dry run by default. If `main` gets branch protection, the release commit needs a bypass for GitHub Actions.
- **Why a tarball, not `npx github:`:**
  - npm 12 defaults `allow-git` and `allow-remote` to `none`, so `npx github:miqui/openlint-mcp` and tarball URLs fail unless users opt in.
  - npm 12 also skips dependency install scripts, so a git install wouldn't build `dist/`; this was checked locally.
  - Local tarball files are allowed (`allow-file: all`). `npm install -g ./openlint-mcp.tgz` installs in seconds with no build and no flags, and the smoke test passes against the installed command on Node 22 and 24.
- **Desktop apps** often don't inherit the shell's `PATH` (nvm, asdf). For Claude Desktop, the README uses the absolute path to Node.js (`node -p process.execPath`) and to `dist/index.js` under `npm root -g`.
- **`openlint-mcp --version` and `--help`** print and exit, so users can check an install. Neither writes to stdout while serving MCP.

### Milestone 2 notes

Points raised while reviewing the plan against #13, and how PR 2 settled them.

- **Custom functions stay supported.** Only inline rulesets from callers are restricted. The startup and named rulesets can use `functions`, `functionsDir` and JS rulesets. *Settled:* covered by tests, including YAML and JS rulesets loaded from outside the package directory. The README (PR 5) still needs to say this, so the `functions` rejection isn't read as "no custom functions".
- **Inline rulesets that extend a configured ruleset.** *Settled:* this works. An inline `extends: [my-org]` is rewritten to `my-org`'s trusted file path, so its custom functions load as they do at startup. It's tested for the plain-string, list and `[name, severity]` forms.
- **`validate_ruleset` checks structure without running functions.** *Settled:* see the `validate_ruleset` notes. Core's JSON-mode validation accepts function names it hasn't loaded, so no placeholders are needed. Rulesets with `functions` are valid and come back with a warning. JS rulesets stay out of v1, as kinlane suggested.
- **`list_rulesets` and per-call rulesets.** *Settled:* configured rulesets only. The reason is recorded under `list_rulesets` and can still be confirmed with P0lip on #13.
- **Fallback and "core" rulesets.** *Settled:* open question 2 is decided (load all three). They are presented as the server's default configuration and labelled by package.
- **Prefer configured names over aliases in inline `extends`.** *Settled:* `oas`, `asyncapi` and `arazzo` are always accepted, and the `spectral:` / `openlint:` aliases stay for existing Spectral rulesets. The README (PR 5) should document `extends: [oas]` as the main form.

### Milestone 3 notes

- **Inline `overrides`.** *Settled in PR 3:* rejected inline. Their `files` patterns match document paths relative to the ruleset's own file, and an inline ruleset has none. `validate_ruleset` returns a warning, as for custom functions. Configured rulesets can still use `overrides`.
- **Bundling cost.** *Settled in PR 3:* inline rulesets are no longer bundled (see Ruleset sources), so there's nothing to cache.

## Later (v1.1+)

- `path` input behind `--allow-path <dir>` (an allowlist of directories)
- MCP **prompts**: "fix these diagnostics", "write a ruleset from this style guide"
- MCP **resources**: `openlint://rulesets/{name}/rules`, rule docs
- JS rulesets in `validate_ruleset`

## Upstream follow-ups (small PRs to `openlint/openlint`)

- **Security report, to send privately** to the OpenLint maintainers (for example through a GitHub security advisory), about how the ruleset migrator handles `formats` names. Details are withheld here until a fix ships. Then add them here, and this repo may be able to drop its own format check.
- **Migrator format table drift:** `asyncapi3` and `arazzo1` are listed but fail to load, and `oas3.2` isn't listed but works. Resolving format names against the exports of `@openlint/openlint-formats` would fix it.
- **`fetch` isn't importable by name on Node 22:** `import { fetch } from '@openlint/openlint-runtime'` fails there at startup with `Named export 'fetch' not found`. It works on Node 24.16. The package's CommonJS build defines `fetch` with a getter that wraps a call (`__importDefault(...)`), which Node 22's export detection can't see. This repo uses the default import instead. A small upstream fix would be to re-export it in a form Node detects.
- **Optional:** add an `openlint:oas` alias in `packages/ruleset-migrator/src/transformers/extends.ts` for symmetry with `spectral:oas`. The OpenAPI alias is `openlint:openapi`, so nothing is missing, but `openlint:oas` is an easy guess. Today it is resolved as a file path and fails.
- **JS rulesets crashing in the CLI:** `.mjs` rulesets that import `oas` crash on OAS 3.0 documents with `oasDocumentSchema … a is not a function`. *PR 2:* this doesn't reproduce through the published bundler. `bundleAndLoadRuleset` loads such a ruleset from outside the package directory and lints OAS 3.0 correctly, so the bug is likely in the CLI. Reproduce it with the CLI before filing.
- **Possible core limitation:** core can't extend a ruleset that uses aliases, such as `oas`, inside `overrides`. It fails with `Alias "ArrayProperties" does not exist`. Check whether that's intended (Spectral may behave the same) before filing.
- ~~Export a content-based ruleset loader.~~ Not needed: the spike works with the bundler as published.

## Open questions

1. ~~What npm name to use before the transfer: unpublished, `@miqui/openlint-mcp`, or ask now for `@openlint/openlint-mcp`?~~ Decided in PR 5: nothing on npm until the transfer, then `@openlint/openlint-mcp`. Until then, GitHub releases with a package tarball (see Distribution).
2. ~~Should the fallback load all three rulesets, or start with none and tell the agent to configure one?~~ Decided in PR 2: load all three (see Ruleset sources).
3. ~~Should `lint_document` accept a `format` hint (`yaml|json`), or always parse as YAML (a superset of JSON)?~~ Decided in PR 3: an optional `filename`, whose `.json` extension selects the JSON parser (see `lint_document`).
