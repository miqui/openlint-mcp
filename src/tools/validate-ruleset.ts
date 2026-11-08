import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { RulesetService } from '../rulesets/service.js';
import { issueSchema, result } from './schemas.js';

export function registerValidateRuleset(server: McpServer, rulesets: RulesetService): void {
  server.registerTool(
    'validate_ruleset',
    {
      title: 'Validate ruleset',
      description:
        'Checks a YAML or JSON OpenLint ruleset without running any code. `valid` means the ruleset is well formed. ' +
        '`warnings` list what lint_document would refuse when the ruleset is passed inline (custom functions, or ' +
        'extending files, URLs or packages); such rulesets can still be configured on the server with --ruleset. ' +
        'JavaScript rulesets are not supported.',
      inputSchema: { content: z.string().describe('The ruleset as YAML or JSON text') },
      outputSchema: { valid: z.boolean(), errors: z.array(issueSchema), warnings: z.array(issueSchema) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ content }) => result({ ...(await rulesets.validate(content)) }),
  );
}
