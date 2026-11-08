/**
 * Format names, resolved against the exports of `@openlint/openlint-formats`, the single source of
 * truth for which formats exist.
 */
import type { Format } from '@openlint/openlint-core';
import * as formatExports from '@openlint/openlint-formats';

/** A format function. Formats have a `displayName`; the package's helpers (such as `detectDialect`) don't. */
export type FormatFunction = Format & { readonly displayName: string };

const isFormat = (value: unknown): value is FormatFunction =>
  typeof value === 'function' && typeof (value as { displayName?: unknown }).displayName === 'string';

const FORMATS: ReadonlyMap<string, FormatFunction> = new Map(
  Object.entries(formatExports as Record<string, unknown>).flatMap(([name, value]): [string, FormatFunction][] =>
    name !== 'default' && isFormat(value) ? [[name, value]] : [],
  ),
);

const formatKey = (name: string): string => name.toLowerCase().replace(/[._-]/g, '');

const FORMATS_BY_KEY = new Map<string, string[]>();
for (const name of FORMATS.keys()) {
  FORMATS_BY_KEY.set(formatKey(name), [...(FORMATS_BY_KEY.get(formatKey(name)) ?? []), name]);
}

/** Format export names, for messages. */
export const FORMAT_NAMES: readonly string[] = [...FORMATS.keys()];

/**
 * Maps a format name to an export of `@openlint/openlint-formats`, or `undefined` when there is none.
 * Case, `.`, `_` and `-` are ignored, so `oas3.1`, `oas3_1` and `OAS3.1` all name `oas3_1`, and
 * `json-schema-draft7` names `jsonSchemaDraft7`. Names that match different formats are refused.
 */
export function resolveFormat(name: string): string | undefined {
  if (FORMATS.has(name)) return name;
  const candidates = FORMATS_BY_KEY.get(formatKey(name)) ?? [];
  const formats = new Set(candidates.map(candidate => FORMATS.get(candidate)));
  return formats.size === 1 ? candidates[0] : undefined;
}

/** The format function for an export name returned by `resolveFormat`. */
export function formatByName(name: string): FormatFunction | undefined {
  return FORMATS.get(name);
}

/**
 * Resolves a format a caller asks about, also accepting common names: `swagger` for OpenAPI 2.0,
 * `openapi3.1` (or `OpenAPI 3.1`) for `oas3.1`, and `asyncapi3` for `aas3`. Whitespace is ignored.
 */
export function resolveFormatQuery(query: string): string | undefined {
  const key = formatKey(query.replace(/\s+/g, ''));
  if (/^swagger(2|20)?$/.test(key)) return 'oas2';
  const direct = resolveFormat(key);
  if (direct !== undefined) return direct;
  if (key.startsWith('openapi')) return resolveFormat(`oas${key.slice('openapi'.length)}`);
  if (key.startsWith('asyncapi')) return resolveFormat(`aas${key.slice('asyncapi'.length)}`);
  return undefined;
}

/**
 * The formats a document of `name`'s format also matches, or that narrow it down: the formats whose
 * names extend each other. `oas3_1` gives `oas3` and `oas3_1`; `oas3` gives `oas3` and every
 * `oas3_*`. A rule applies to documents of `name`'s format when it declares any of these.
 */
export function formatFamily(name: string): Set<FormatFunction> {
  const format = FORMATS.get(name);
  if (format === undefined) return new Set();
  const keysOf = (target: FormatFunction): string[] =>
    [...FORMATS].filter(([, value]) => value === target).map(([exportName]) => formatKey(exportName));
  const own = keysOf(format);
  const family = new Set<FormatFunction>();
  for (const candidate of new Set(FORMATS.values())) {
    const related = keysOf(candidate).some(key => own.some(ownKey => key.startsWith(ownKey) || ownKey.startsWith(key)));
    if (related) family.add(candidate);
  }
  return family;
}
