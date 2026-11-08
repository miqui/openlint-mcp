# openlint-mcp

An [MCP](https://modelcontextprotocol.io) server for [OpenLint](https://github.com/openlint/openlint). It lets AI tools such as Claude, Codex and OpenCode lint OpenAPI, AsyncAPI and Arazzo documents, look up rules, and check OpenLint rulesets.

The server runs locally over stdio and builds only on the published `@openlint/*` npm packages. Design and milestones: [`docs/v1-plan.md`](docs/v1-plan.md).

> **Status: early development.** The package isn't on npm yet, so install it from source (below). Once it's published, `node /abs/path/to/openlint-mcp/dist/index.js` in the examples becomes `npx -y @openlint/openlint-mcp`.

## Tools

All tools are read-only.

| Tool               | What it does                                                                                                         | Status    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | --------- |
| `list_rulesets`    | Lists the rulesets the server is configured with                                                                     | Available |
| `validate_ruleset` | Checks a YAML or JSON ruleset without running any code, and warns about anything `lint_document` would refuse inline | Available |
| `lint_document`    | Lints an OpenAPI, AsyncAPI or Arazzo document                                                                        | Available |
| `list_rules`       | Lists a ruleset's rules, optionally for one format (such as `oas3.1` or `swagger`)                                   | Available |
| `explain_rule`     | Explains one rule, including `extensions` such as fixing guidance                                                    | Available |

## Install from source

Requires Node.js `^22.22.1 || >=24`.

```sh
git clone https://github.com/miqui/openlint-mcp.git
cd openlint-mcp
npm ci
npm run build
npm run smoke   # optional: starts the built server over stdio and calls its tools
```

The server's command is `node /abs/path/to/openlint-mcp/dist/index.js`. Run `pwd` in the clone to get the absolute path.

## Configure rulesets

| Option                       | Meaning                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `--ruleset <path>` (or `-r`) | The default ruleset: a YAML, JSON or JS ruleset file                                                      |
| `--ruleset <name>=<path>`    | An extra named ruleset. Repeat the option to add more. `oas`, `asyncapi` and `arazzo` are reserved names. |
| `OPENLINT_RULESET=<path>`    | The default ruleset, when there is no unnamed `--ruleset`                                                 |
| `--allow-external-refs`      | Let `lint_document` follow `$ref`s to files and URLs (off by default; see below)                          |

- **Which one is the default:** an unnamed `--ruleset`, then `OPENLINT_RULESET`, then the first named ruleset.
- **Filenames that contain `=`:** `--ruleset team=prod.yaml` means a ruleset named `team`, loaded from `prod.yaml`. To load a file called `team=prod.yaml`, start the path with `./` or `/`, as in `--ruleset ./team=prod.yaml`.
- **No ruleset configured:** the server uses the `oas`, `asyncapi` and `arazzo` rulesets from [`@openlint/openlint-rulesets`](https://www.npmjs.com/package/@openlint/openlint-rulesets) (recommended rules).
- **Use absolute paths.** AI tools usually start MCP servers from a different working directory than your project, so relative paths may not resolve.
- **Custom functions are supported** in configured rulesets (`functions`, `functionsDir`, and JS rulesets).
- **Errors at startup:** if a ruleset fails to load, the server prints the error to stderr and exits. Your AI tool will show the server as failed; its MCP logs have the message.

Rulesets that an AI tool passes inline in a tool call are untrusted, so they are restricted:

- no custom functions
- no `overrides`
- JSONPath (`given`, `then.field`, aliases) only as plain paths, without filter or script expressions (nothing with `(`)
- `extends` only names a configured ruleset, `oas`, `asyncapi`, `arazzo`, or one of the aliases `spectral:oas`, `spectral:asyncapi`, `spectral:arazzo`, `openlint:openapi`, `openlint:asyncapi` and `openlint:arazzo`
- `formats` only names formats exported by `@openlint/openlint-formats`

`validate_ruleset` explains what was refused.

## Linting documents

`lint_document` takes the document as text in `content`. Optional inputs:

- **`filename`**, such as `openapi.json`, without directories or `#`, `?` and `%`. It is never read from disk. A `.json` name selects the JSON parser (otherwise YAML), and the ruleset's `overrides` match it as if the document sat next to the ruleset file.
- **`ruleset`**: a name from `list_rulesets` (or `oas`, `asyncapi`, `arazzo`), or an inline YAML/JSON ruleset.
- **`severity`** (`error`, `warn`, `info` or `hint`; default `hint`): leaves out less severe diagnostics.
- **`limit`** (default 50), and **`groupBy`** (`code`, the default, or `none`).

It returns:

- the `formats` the ruleset recognized (empty when none)
- `counts` per severity, which always cover every result
- the `diagnostics`, most severe first, grouped by rule code unless `groupBy` is `none`
- `truncated`, and any `notes`

**External `$ref`s** (to other files or URLs) aren't followed by default. They're reported as `invalid-ref`, with a note. `--allow-external-refs` turns them on; each HTTP request then has a 10-second timeout.

> **Warning:** with `--allow-external-refs`, a document from your AI tool can make the server read any local file it has access to, and fetch any URL. Relative refs resolve against the ruleset file's directory (or the working directory). Only use it when you trust the documents.

## Looking up rules

- **`list_rules`** lists a ruleset's rules, sorted by name: severity, whether it's enabled and recommended, its formats and description.
  - `format` keeps the rules for one kind of document. It accepts names like `oas3.1`, `OpenAPI 3.1`, `swagger` (OpenAPI 2.0), `asyncapi3` or `arazzo1.0`. A version includes rules for its family: `oas3.1` includes rules for OpenAPI 3.x, and `oas3` includes rules for every OpenAPI 3 version.
  - `enabledOnly` (default `true`) lists only the rules `lint_document` runs.
  - `filename` (as for `lint_document`) includes what the ruleset's `overrides` change for a document of that name, such as rules added for `*.json` files.
- **`explain_rule`** explains one rule: its description, message, `given` paths, `then` (function, field and small function options), severity, formats, documentation link and `extensions`.

**Guidance for agents in your ruleset:** core accepts a free-form `extensions` object on each rule, and `explain_rule` returns it as written. The convention for agent guidance is `extensions.prompt`:

```yaml
rules:
  operation-summary:
    description: Every operation needs a summary.
    given: $.paths[*][*]
    then: { field: summary, function: truthy }
    extensions:
      prompt: Write a short summary in sentence case, under 60 characters, without a trailing period.
```

## Use with AI tools

In every example, replace `/abs/path/to/openlint-mcp` with the absolute path of your clone, and `/abs/path/to/.openlint.yaml` with your ruleset. The `--ruleset …` part is optional. Without it, the server uses the default rulesets above.

### Claude Code

Add the server with the `claude` CLI. Everything after `--` is the server's own command line:

```sh
claude mcp add openlint -- node /abs/path/to/openlint-mcp/dist/index.js --ruleset /abs/path/to/.openlint.yaml
```

Choose where the setting is stored with `--scope`:

- `local` (default): only you, only this project.
- `project`: everyone working on the project. It is written to `.mcp.json` in the project root, for committing. Claude Code asks each person to approve the server the first time.
- `user`: only you, in all your projects.

A project-scoped `.mcp.json` looks like this:

```json
{
  "mcpServers": {
    "openlint": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/openlint-mcp/dist/index.js", "--ruleset", "/abs/path/to/.openlint.yaml"],
      "env": {}
    }
  }
}
```

The paths in a committed `.mcp.json` must work on every teammate's machine. If your checkouts live in different places, have each person run `claude mcp add` with the default `local` scope instead.

To set the ruleset through the environment instead, use `-e OPENLINT_RULESET=/abs/path/to/.openlint.yaml` before `--`.

**Check it's connected:** run `claude mcp list`, or `/mcp` inside a Claude Code session.

Docs: [Claude Code MCP](https://code.claude.com/docs/en/mcp).

### Claude Desktop

Open **Settings → Developer → Edit Config**. That opens `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the server:

```json
{
  "mcpServers": {
    "openlint": {
      "command": "/abs/path/to/node",
      "args": ["/abs/path/to/openlint-mcp/dist/index.js", "--ruleset", "/abs/path/to/.openlint.yaml"]
    }
  }
}
```

- **Use the absolute path to `node`** (run `which node`, or `where node` on Windows). Desktop apps often don't see the `PATH` from your shell, especially with version managers like nvm or asdf.
- **On Windows,** escape backslashes in JSON paths: `"C:\\Users\\you\\openlint-mcp\\dist\\index.js"`.
- **Restart:** quit Claude Desktop completely and start it again.
- **If it doesn't connect,** check the logs. On macOS they're at `~/Library/Logs/Claude/mcp-server-openlint.log`.

Docs: [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

### Codex

Add the server with the `codex` CLI. The CLI, the IDE extension and the ChatGPT desktop app share this configuration:

```sh
codex mcp add openlint -- node /abs/path/to/openlint-mcp/dist/index.js --ruleset /abs/path/to/.openlint.yaml
```

This writes to `~/.codex/config.toml`. You can also edit that file directly:

```toml
[mcp_servers.openlint]
command = "node"
args = ["/abs/path/to/openlint-mcp/dist/index.js", "--ruleset", "/abs/path/to/.openlint.yaml"]

# Optional, instead of --ruleset:
# [mcp_servers.openlint.env]
# OPENLINT_RULESET = "/abs/path/to/.openlint.yaml"
```

- **Environment variable from the CLI:** `codex mcp add openlint --env OPENLINT_RULESET=/abs/path/to/.openlint.yaml -- node /abs/path/to/openlint-mcp/dist/index.js`.
- **Per project:** a `.codex/config.toml` in a trusted project can hold the same table.

**Check it's connected:** run `codex mcp list`, or `/mcp` inside the Codex TUI.

Docs: [Codex MCP](https://developers.openai.com/codex/mcp).

### OpenCode

Add the server with the `opencode` CLI. Without `--global`, it goes into the project's configuration:

```sh
opencode mcp add openlint -- node /abs/path/to/openlint-mcp/dist/index.js --ruleset /abs/path/to/.openlint.yaml
```

In some older versions, `opencode mcp add` doesn't take a name and command, and asks for them instead. Enter `openlint` as the name, choose a local server, and give the same command.

Or edit `opencode.json` (or `opencode.jsonc`) in the project root, or `~/.config/opencode/opencode.json` for all projects. The format in OpenCode's current docs (V2) puts servers under `mcp.servers`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "openlint": {
        "type": "local",
        "command": ["node", "/abs/path/to/openlint-mcp/dist/index.js", "--ruleset", "/abs/path/to/.openlint.yaml"],
        // Optional, instead of --ruleset:
        // "environment": { "OPENLINT_RULESET": "/abs/path/to/.openlint.yaml" }
      },
    },
  },
}
```

Older versions (V1) put servers directly under `mcp`, and use `enabled`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "openlint": {
      "type": "local",
      "command": ["node", "/abs/path/to/openlint-mcp/dist/index.js", "--ruleset", "/abs/path/to/.openlint.yaml"],
      "enabled": true,
    },
  },
}
```

If you're not sure which format your version uses, `opencode mcp add` writes the right one.

**Check it's connected:** run `opencode mcp list`, or `/mcps` inside OpenCode.

Docs: [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers/).

## Try it

Once the server is connected, ask your AI tool things like:

- "Which OpenLint rulesets are configured?"
- "Lint `openapi.yaml` with OpenLint and fix the errors."
- "Which OpenLint rules apply to OpenAPI 3.1, and what does `operation-tags` check?"
- "Write an OpenLint ruleset that requires `info.contact` in OpenAPI 3.1 documents, and validate it with `validate_ruleset`."

## Development

```sh
npm ci
npm run lint    # Prettier, ESLint and type-check
npm test        # Vitest
npm run build   # TypeScript 7 → dist/
npm run smoke   # the built server over stdio
```

Commit messages and PR titles follow [conventional commits](https://www.conventionalcommits.org), as in [OpenLint's CONTRIBUTING.md](https://github.com/openlint/openlint/blob/main/CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE)
