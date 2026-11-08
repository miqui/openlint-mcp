import { z } from 'zod';

import { DEFAULT_FILENAME } from '../lint.js';

/** A document name that's never read from disk: no directories, and no characters with URI meaning. */
export const filenameSchema = z
  .string()
  .regex(/^[^/\\#?%]+$/, 'A file name, without directories or the characters # ? %')
  .refine(name => name !== '.' && name !== '..', 'A file name, without directories');

export const rulesetArgument = z
  .string()
  .optional()
  .describe(
    'A ruleset name from list_rulesets (or oas, asyncapi, arazzo), or an inline YAML/JSON ruleset. Default: the default ruleset.',
  );

export const lookupFilename = filenameSchema
  .optional()
  .describe(
    `A document name, such as "openapi.json", to include the rules the ruleset's overrides apply to it, as lint_document would. Never read. Default: ${DEFAULT_FILENAME}.`,
  );

export const issueSchema = z.object({
  message: z.string(),
  path: z
    .array(z.union([z.string(), z.number()]))
    .describe('JSON path inside the ruleset; empty for the ruleset as a whole'),
});

/** Returns a tool result as both text (for clients without structured output) and structured content. */
export function result<T extends Record<string, unknown>>(
  value: T,
): {
  content: [{ type: 'text'; text: string }];
  structuredContent: T;
} {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}
