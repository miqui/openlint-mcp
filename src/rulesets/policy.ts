/**
 * Checks on ruleset definitions in their YAML/JSON form (function names and `extends` entries are
 * strings). Inline rulesets come from tool callers, so they are untrusted: they may not run custom
 * code or make the bundler read files, fetch URLs or resolve packages.
 */
import * as builtinFunctions from '@openlint/openlint-functions';

import { PACKAGE_RULESET_NAMES, type PackageRulesetName } from '../config.js';
import type { Issue, IssuePath } from './issues.js';

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Function names exported by `@openlint/openlint-functions`. */
export const BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set(
  Object.entries(builtinFunctions)
    .filter(([name, value]) => name !== 'default' && typeof value === 'function')
    .map(([name]) => name),
);

/**
 * The `extends` aliases the ruleset migrator maps to `@openlint/openlint-rulesets`. This must match
 * its table exactly: the migrator resolves any other name, including an unknown `spectral:` one, as
 * a file path.
 */
export const RULESET_ALIASES: ReadonlyMap<string, PackageRulesetName> = new Map([
  ['spectral:oas', 'oas'],
  ['spectral:asyncapi', 'asyncapi'],
  ['spectral:arazzo', 'arazzo'],
  ['openlint:openapi', 'oas'],
  ['openlint:asyncapi', 'asyncapi'],
  ['openlint:arazzo', 'arazzo'],
]);

/** The alias an inline `extends: [oas]` (and friends) is rewritten to before bundling. */
export const PACKAGE_ALIASES: Readonly<Record<PackageRulesetName, string>> = {
  oas: 'openlint:openapi',
  asyncapi: 'openlint:asyncapi',
  arazzo: 'openlint:arazzo',
};

export function isPackageRulesetName(name: string): name is PackageRulesetName {
  return (PACKAGE_RULESET_NAMES as readonly string[]).includes(name);
}

/** Maps an `extends` name to what the bundler should see, or `undefined` when it isn't allowed. */
export type ExtendsResolver = (name: string) => string | undefined;

interface Scope {
  readonly definition: Json;
  readonly path: IssuePath;
}

/** The ruleset itself and each entry of its `overrides`. */
function scopes(definition: Json): Scope[] {
  const result: Scope[] = [{ definition, path: [] }];
  const { overrides } = definition;
  if (Array.isArray(overrides)) {
    overrides.forEach((override: unknown, index) => {
      if (isObject(override)) result.push({ definition: override, path: ['overrides', index] });
    });
  }
  return result;
}

interface Ref {
  readonly name: unknown;
  readonly path: IssuePath;
}

/** Every `extends` entry. `extends` is a name, or a list of names and `[name, severity]` pairs. */
export function extendsRefs(definition: Json): Ref[] {
  const refs: Ref[] = [];
  for (const scope of scopes(definition)) {
    const value = scope.definition['extends'];
    const base = [...scope.path, 'extends'];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      refs.push({ name: value, path: base });
      continue;
    }
    value.forEach((entry: unknown, index) => {
      if (Array.isArray(entry)) refs.push({ name: entry[0], path: [...base, index, 0] });
      else refs.push({ name: entry, path: [...base, index] });
    });
  }
  return refs;
}

/** Every `then.function` in `rules`, including rules inside `overrides`. */
export function functionRefs(definition: Json): Ref[] {
  const refs: Ref[] = [];
  for (const scope of scopes(definition)) {
    const { rules } = scope.definition;
    if (!isObject(rules)) continue;
    for (const [ruleName, rule] of Object.entries(rules)) {
      if (!isObject(rule)) continue;
      const base = [...scope.path, 'rules', ruleName, 'then'];
      const { then } = rule;
      const thens: [unknown, IssuePath][] = Array.isArray(then)
        ? then.map((entry: unknown, index): [unknown, IssuePath] => [entry, [...base, index]])
        : [[then, base]];
      for (const [entry, path] of thens) {
        if (isObject(entry) && 'function' in entry) refs.push({ name: entry['function'], path: [...path, 'function'] });
      }
    }
  }
  return refs;
}

export function declaredFunctions(definition: Json): Set<string> {
  const { functions } = definition;
  return new Set(Array.isArray(functions) ? functions.filter((name): name is string => typeof name === 'string') : []);
}

/** `functions` and `functionsDir`, which load JavaScript, anywhere in the ruleset. */
export function customFunctionIssues(definition: Json): Issue[] {
  const issues: Issue[] = [];
  for (const scope of scopes(definition)) {
    for (const key of ['functions', 'functionsDir']) {
      if (key in scope.definition) {
        issues.push({
          message: `Inline rulesets can't declare custom functions ("${key}"). Rulesets with custom functions must be configured on the server with --ruleset.`,
          path: [...scope.path, key],
        });
      }
    }
  }
  return issues;
}

/** Function names that are neither built in nor declared in `functions`. */
export function unknownFunctionIssues(definition: Json): Issue[] {
  const declared = declaredFunctions(definition);
  return functionRefs(definition)
    .filter(ref => typeof ref.name === 'string' && !BUILTIN_FUNCTIONS.has(ref.name) && !declared.has(ref.name))
    .map(ref => ({
      message: `Unknown function "${String(ref.name)}". Use a built-in function (${[...BUILTIN_FUNCTIONS].join(', ')}) or declare it in "functions".`,
      path: ref.path,
    }));
}

export interface ExtendsIssues {
  /** `spectral:`/`openlint:` names the migrator doesn't know. Never valid anywhere. */
  readonly unknownAliases: Issue[];
  /** Files, URLs, packages and unknown names. Valid in a server-configured ruleset, not inline. */
  readonly notAllowedInline: Issue[];
}

export function extendsIssues(
  definition: Json,
  resolve: ExtendsResolver,
  allowedNames: readonly string[],
): ExtendsIssues {
  const unknownAliases: Issue[] = [];
  const notAllowedInline: Issue[] = [];
  const allowed = [...allowedNames, ...RULESET_ALIASES.keys()].join(', ');
  for (const ref of extendsRefs(definition)) {
    if (typeof ref.name !== 'string') {
      notAllowedInline.push({ message: 'An "extends" entry must be a ruleset name.', path: ref.path });
    } else if (resolve(ref.name) !== undefined) {
      continue;
    } else if (/^(spectral|openlint):/.test(ref.name)) {
      unknownAliases.push({
        message: `Unknown ruleset alias "${ref.name}". Known aliases: ${[...RULESET_ALIASES.keys()].join(', ')}.`,
        path: ref.path,
      });
    } else {
      notAllowedInline.push({
        message: `Inline rulesets can't extend "${ref.name}". Allowed: ${allowed}. Files, URLs and packages can only be extended from a ruleset configured on the server with --ruleset.`,
        path: ref.path,
      });
    }
  }
  return { unknownAliases, notAllowedInline };
}

/** A copy of `definition` with each allowed `extends` name replaced by what `resolve` returns. */
export function rewriteExtends(definition: Json, resolve: ExtendsResolver): Json {
  const rename = (name: unknown): unknown => (typeof name === 'string' ? (resolve(name) ?? name) : name);
  const rewriteScope = (scope: Json): Json => {
    const value = scope['extends'];
    if (value === undefined) return scope;
    const rewritten = Array.isArray(value)
      ? value.map((entry: unknown) => {
          if (!Array.isArray(entry)) return rename(entry);
          const [name, ...rest] = entry as unknown[];
          return [rename(name), ...rest];
        })
      : rename(value);
    return { ...scope, extends: rewritten };
  };
  // A JSON round trip: the definition came from YAML/JSON, and `structuredClone` rejects the parser's objects.
  const copy = rewriteScope(JSON.parse(JSON.stringify(definition)) as Json);
  if (Array.isArray(copy['overrides'])) {
    copy['overrides'] = copy['overrides'].map((override: unknown) =>
      isObject(override) ? rewriteScope(override) : override,
    );
  }
  return copy;
}
