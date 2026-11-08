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
}

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
  let values: { ruleset?: string[]; 'allow-external-refs'?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        ruleset: { type: 'string', short: 'r', multiple: true },
        'allow-external-refs': { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error));
  }

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

  return { rulesets: specs, allowExternalRefs: values['allow-external-refs'] === true };
}
