# openlint-mcp

An [MCP](https://modelcontextprotocol.io) server for [OpenLint](https://github.com/openlint/openlint). It lets AI tools such as Claude, Codex and OpenCode check OpenLint rulesets, and, as the remaining milestones land, lint OpenAPI, AsyncAPI and Arazzo documents and look up rules.

The server runs locally over stdio and builds only on the published `@openlint/*` npm packages. Design and milestones: [`docs/v1-plan.md`](docs/v1-plan.md).

> **Status: early development.** The package isn't on npm yet, so install it from source (below). Once it's published, `node /abs/path/to/openlint-mcp/dist/index.js` in the examples becomes `npx -y @openlint/openlint-mcp`.

## Tools

All tools are read-only.

| Tool                         | What it does                                                                                                         | Status                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `list_rulesets`              | Lists the rulesets the server is configured with                                                                     | Available             |
| `validate_ruleset`           | Checks a YAML or JSON ruleset without running any code, and warns about anything `lint_document` would refuse inline | Available             |
| `lint_document`              | Lints an OpenAPI, AsyncAPI or Arazzo document                                                                        | Planned (milestone 3) |
| `list_rules`, `explain_rule` | Look up the rules in a ruleset                                                                                       | Planned (milestone 4) |

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

- **Which one is the default:** an unnamed `--ruleset`, then `OPENLINT_RULESET`, then the first named ruleset.
- **Filenames that contain `=`:** `--ruleset team=prod.yaml` means a ruleset named `team`, loaded from `prod.yaml`. To load a file called `team=prod.yaml`, start the path with `./` or `/`, as in `--ruleset ./team=prod.yaml`.
- **No ruleset configured:** the server uses the `oas`, `asyncapi` and `arazzo` rulesets from [`@openlint/openlint-rulesets`](https://www.npmjs.com/package/@openlint/openlint-rulesets) (recommended rules).
- **Use absolute paths.** AI tools usually start MCP servers from a different working directory than your project, so relative paths may not resolve.
- **Custom functions are supported** in configured rulesets (`functions`, `functionsDir`, and JS rulesets).
- **Errors at startup:** if a ruleset fails to load, the server prints the error to stderr and exits. Your AI tool will show the server as failed; its MCP logs have the message.

Rulesets that an AI tool passes inline in a tool call are untrusted, so they are restricted:

- no custom functions
- no `overrides`
- `extends` only names a configured ruleset, `oas`, `asyncapi`, `arazzo`, or one of the aliases `spectral:oas`, `spectral:asyncapi`, `spectral:arazzo`, `openlint:openapi`, `openlint:asyncapi` and `openlint:arazzo`
- `formats` only names formats exported by `@openlint/openlint-formats`

`validate_ruleset` explains what was refused.

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
