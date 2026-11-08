import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { listRules } from '../rules.js';
import { formatIssue } from '../rulesets/issues.js';
import type { RulesetService } from '../rulesets/service.js';
import { ruleSummary } from './rule-schemas.js';
import { result } from './schemas.js';

export function registerListRules(server: McpServer, rulesets: RulesetService): void {
  server.registerTool(
    'list_rules',
    {
      title: 'List rules',
      description:
        "Lists a ruleset's rules, sorted by name. `format` keeps the rules that apply to documents of that format: " +
        'oas3.1 includes rules for OpenAPI 3.1 and 3.x; oas3 includes rules for every OpenAPI 3 version. ' +
        'Use explain_rule for one rule in detail.',
      inputSchema: {
        ruleset: z
          .string()
          .optional()
          .describe(
            'A ruleset name from list_rulesets (or oas, asyncapi, arazzo), or an inline YAML/JSON ruleset. Default: the default ruleset.',
          ),
        format: z
          .string()
          .optional()
          .describe('A format such as oas2 (or swagger), oas3, oas3.1, asyncapi2, asyncapi3 or arazzo1.0'),
        enabledOnly: z.boolean().default(true).describe('Only rules that lint_document runs'),
      },
      outputSchema: { rules: z.array(ruleSummary) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ruleset, format, enabledOnly }) => {
      const resolved = rulesets.resolve(ruleset);
      if (!resolved.ok) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `The ruleset can't be used:\n${resolved.issues.map(formatIssue).join('\n')}` },
          ],
        };
      }
      const listed = listRules(resolved.ruleset, { format, enabledOnly });
      return listed.ok
        ? result({ rules: listed.rules })
        : { isError: true, content: [{ type: 'text', text: listed.message }] };
    },
  );
}
