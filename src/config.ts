import path from 'node:path';
import { parseArgs } from 'node:util';

/** Name given to the unnamed `--ruleset <path>` (or `OPENLINT_RULESET`). */
export const DEFAULT_RULESET_NAME = 'default';

/**
 * Rulesets from `@openlint/openlint-rulesets`. They can always be used by name in an inline
 * `extends`, so a configured ruleset may not take one of these names.
 */
export const PACKAGE_RULESET_NAMES = ['oas', 'asyncapi', 'arazzo'] as const;
export type PackageRulesetName = (typeof PACKAGE_RULESET_NAMES)[number];

export interface RulesetSpec {
  readonly name: string;
  /** Absolute path to the ruleset file. */
  readonly path: string;
  readonly isDefault: boolean;
}

export interface ServerConfig {
  /** Empty when nothing is configured; the server then uses the package rulesets. */
  readonly rulesets: readonly RulesetSpec[];
  /**
   * Whether `lint_document` follows `$ref`s to files and URLs. Off by default: documents come from
   * the AI tool, and following their refs would let them read local files and fetch URLs.
   */
  readonly allowExternalRefs: boolean;
  /** Set when the command line asks for the version or help instead of starting the server. */
  readonly show?: 'version' | 'help';
}

export const USAGE = `Usage: openlint-mcp [options]

An MCP server for OpenLint over stdio. AI tools start it; it isn't meant to be run by hand.

Options:
  -r, --ruleset <path>         Default ruleset: a YAML, JSON or JS ruleset file
  -r, --ruleset <name>=<path>  Extra named ruleset; can be repeated
      --allow-external-refs    Let lint_document follow $refs to files and URLs
  -v, --version                Print the version and exit
  -h, --help                   Print this help and exit

The default ruleset is the unnamed --ruleset, else OPENLINT_RULESET, else the first named
ruleset. With none of them, the server uses the oas, asyncapi and arazzo rulesets from
@openlint/openlint-rulesets.
`;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

// No `:`, `/` or `\`, so `C:\rules=x.yaml` and `./a=b.yaml` are read as paths, not `name=path`.
const NAME_PATTERN = /^[A-Za-z][\w.-]*$/;

/**
 * Reads the server configuration from command-line arguments and the environment.
 *
 * - `--ruleset <path>` sets the default ruleset; `OPENLINT_RULESET` is used when the flag is absent.
 * - `--ruleset <name>=<path>` adds a named ruleset; it can be repeated.
 * - Without an unnamed ruleset, the first named one is the default.
 * - `--allow-external-refs` lets `lint_document` follow `$ref`s to files and URLs.
 *
 * Relative paths resolve against `cwd`.
 */
export function parseConfig(argv: readonly string[], env: NodeJS.ProcessEnv, cwd: string): ServerConfig {
  let values: { ruleset?: string[]; 'allow-external-refs'?: boolean; version?: boolean; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        ruleset: { type: 'string', short: 'r', multiple: true },
        'allow-external-refs': { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error));
  }

  const allowExternalRefs = values['allow-external-refs'] === true;
  // Before the rulesets are checked, so help and the version work while a configuration is wrong.
  const show = values.help === true ? 'help' : values.version === true ? 'version' : undefined;
  if (show !== undefined) return { rulesets: [], allowExternalRefs, show };

  let unnamed: string | undefined;
  const named: { name: string; path: string }[] = [];

  for (const value of values.ruleset ?? []) {
    const separator = value.indexOf('=');
    const prefix = separator > 0 ? value.slice(0, separator) : '';
    if (NAME_PATTERN.test(prefix) && separator < value.length - 1) {
      named.push({ name: prefix, path: value.slice(separator + 1) });
    } else if (unnamed === undefined) {
      unnamed = value;
    } else {
      throw new ConfigError(
        `Only one unnamed --ruleset is allowed (got "${unnamed}" and "${value}"). Name the others with --ruleset <name>=<path>.`,
      );
    }
  }

  const envRuleset = env['OPENLINT_RULESET']?.trim();
  if (unnamed === undefined && envRuleset !== undefined && envRuleset !== '') {
    unnamed = envRuleset;
  }

  const specs: RulesetSpec[] = [];
  if (unnamed !== undefined) {
    specs.push({ name: DEFAULT_RULESET_NAME, path: path.resolve(cwd, unnamed), isDefault: true });
  }

  const seen = new Set(specs.map(spec => spec.name));
  for (const { name, path: rulesetPath } of named) {
    if ((PACKAGE_RULESET_NAMES as readonly string[]).includes(name)) {
      throw new ConfigError(
        `Ruleset name "${name}" is reserved for @openlint/openlint-rulesets. Choose another name for ${rulesetPath}.`,
      );
    }
    if (seen.has(name)) {
      throw new ConfigError(`Ruleset name "${name}" is used more than once.`);
    }
    seen.add(name);
    specs.push({ name, path: path.resolve(cwd, rulesetPath), isDefault: specs.length === 0 });
  }

  return { rulesets: specs, allowExternalRefs };
}
