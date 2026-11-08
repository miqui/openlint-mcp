import path from 'node:path';

import {
  Document,
  OpenLint,
  getDiagnosticSeverity,
  type IOpenLintDiagnostic,
  type Ruleset,
} from '@openlint/openlint-core';
import { Json, Yaml } from '@openlint/openlint-parsers';
import { Resolver, createHttpAndFileResolver } from '@openlint/openlint-ref-resolver';

export const SEVERITY_NAMES = ['error', 'warn', 'info', 'hint'] as const;
export type SeverityName = (typeof SEVERITY_NAMES)[number];

/** Severity names by core's numeric severity (0 is the most severe). */
const NAME_BY_SEVERITY = new Map<number, SeverityName>(
  SEVERITY_NAMES.map(name => [Number(getDiagnosticSeverity(name)), name]),
);

/** The document name used when the caller gives none. */
export const DEFAULT_FILENAME = 'document.yaml';

export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface Range {
  readonly start: Position;
  readonly end: Position;
}

export interface Location {
  readonly path: (string | number)[];
  readonly range: Range;
  /** Set only for diagnostics in another document, reached through an external `$ref`. */
  readonly source?: string;
}

export interface FlatDiagnostic extends Location {
  readonly code: string;
  readonly severity: SeverityName;
  readonly message: string;
}

export interface GroupedDiagnostic {
  readonly code: string;
  /** The most severe in the group. */
  readonly severity: SeverityName;
  /** The message of the group's first diagnostic. */
  readonly message: string;
  readonly count: number;
  readonly first: Location;
}

export interface LintOptions {
  readonly content: string;
  readonly ruleset: Ruleset;
  /** Never read from disk. Picks the parser (`.json` is JSON, anything else YAML) and names the document. */
  readonly filename?: string;
  /** Diagnostics less severe than this are left out of `diagnostics` (not `counts`). */
  readonly severity?: SeverityName;
  readonly limit?: number;
  readonly groupBy?: 'none' | 'code';
  readonly allowExternalRefs?: boolean;
}

export interface LintResult {
  [key: string]: unknown;
  /** Display names of the formats the ruleset recognized; empty when it recognized none. */
  readonly formats: string[];
  /** Every result, whatever the severity threshold and limit. */
  readonly counts: Record<SeverityName, number>;
  readonly diagnostics: FlatDiagnostic[] | GroupedDiagnostic[];
  readonly truncated: boolean;
  readonly notes: string[];
}

const EXTERNAL_REFS_NOTE =
  "External $refs (to files or URLs) weren't followed, so they're reported as invalid-ref. The server follows them only when started with --allow-external-refs.";

/**
 * Lints `content` with `ruleset`. The document is never read from disk: it's named after `filename`,
 * as if it sat next to the ruleset's file (or in the working directory for rulesets without one), so
 * `overrides` patterns match it. External `$ref`s are only followed when `allowExternalRefs` is set.
 */
export async function lintDocument(options: LintOptions): Promise<LintResult> {
  const {
    content,
    ruleset,
    filename = DEFAULT_FILENAME,
    severity = 'hint',
    limit = 50,
    groupBy = 'code',
    allowExternalRefs = false,
  } = options;

  const baseDir = ruleset.source === null ? process.cwd() : path.dirname(ruleset.source);
  const source = path.join(baseDir, filename);
  const document = filename.toLowerCase().endsWith('.json')
    ? new Document(content, Json, source)
    : new Document(content, Yaml, source);

  const openlint = new OpenLint({ resolver: allowExternalRefs ? createHttpAndFileResolver() : new Resolver() });
  openlint.setRuleset(ruleset);
  const results = await openlint.run(document);

  const relative = relativeTo(baseDir);
  const flat = results.map(result => toFlat(result, source, relative)).sort(compare);

  const counts: Record<SeverityName, number> = { error: 0, warn: 0, info: 0, hint: 0 };
  for (const diagnostic of flat) counts[diagnostic.severity]++;

  const threshold = SEVERITY_NAMES.indexOf(severity);
  const shown = flat.filter(diagnostic => SEVERITY_NAMES.indexOf(diagnostic.severity) <= threshold);
  const entries = groupBy === 'code' ? group(shown) : shown;

  const notes: string[] = [];
  if (!allowExternalRefs && results.some(isUnfollowedExternalRef)) notes.push(EXTERNAL_REFS_NOTE);

  return {
    formats: [...(document.formats ?? [])].map(format => format.displayName ?? format.name),
    counts,
    diagnostics: entries.slice(0, limit),
    truncated: entries.length > limit,
    notes,
  };
}

/**
 * Rewrites absolute paths under `baseDir` relative to it, so messages don't carry server paths. Only
 * paths that start a word are rewritten, so URLs with the same path segments stay intact; at a
 * filesystem root nothing is rewritten.
 */
export function relativeTo(baseDir: string): (text: string) => string {
  if (path.dirname(baseDir) === baseDir) return text => text;
  const prefix = `${baseDir}${path.sep}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[\\s'"(])${prefix}`, 'g');
  return text => text.replace(pattern, '$1');
}

function toFlat(
  result: IOpenLintDiagnostic,
  documentSource: string,
  relative: (text: string) => string,
): FlatDiagnostic {
  const { start, end } = result.range;
  const other = result.source !== undefined && result.source !== null && result.source !== documentSource;
  return {
    code: String(result.code),
    severity: NAME_BY_SEVERITY.get(Number(result.severity)) ?? 'hint',
    message: relative(result.message),
    path: [...result.path],
    range: {
      start: { line: start.line, character: start.character },
      end: { line: end.line, character: end.character },
    },
    ...(other ? { source: relative(result.source!) } : {}),
  };
}

/** Code-point order, the same on every machine (unlike `localeCompare`). */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Most severe first, then by code, then by path and position, so the order is stable. */
function compare(a: FlatDiagnostic, b: FlatDiagnostic): number {
  return (
    SEVERITY_NAMES.indexOf(a.severity) - SEVERITY_NAMES.indexOf(b.severity) ||
    byCodePoint(a.code, b.code) ||
    byCodePoint(a.path.join('/'), b.path.join('/')) ||
    a.range.start.line - b.range.start.line ||
    a.range.start.character - b.range.start.character
  );
}

/** Groups sorted diagnostics by code. Each group takes its first (most severe) diagnostic's details. */
function group(sorted: FlatDiagnostic[]): GroupedDiagnostic[] {
  const groups = new Map<string, { group: GroupedDiagnostic; count: number }>();
  for (const { code, severity, message, ...location } of sorted) {
    const existing = groups.get(code);
    if (existing === undefined)
      groups.set(code, { group: { code, severity, message, count: 1, first: location }, count: 1 });
    else existing.count++;
  }
  return [...groups.values()].map(({ group, count }) => ({ ...group, count }));
}

function isUnfollowedExternalRef(result: IOpenLintDiagnostic): boolean {
  return result.code === 'invalid-ref' && result.message.startsWith('No resolver defined for scheme');
}
