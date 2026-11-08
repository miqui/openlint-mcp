import { z } from 'zod';

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
