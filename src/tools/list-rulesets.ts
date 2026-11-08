import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { RulesetService } from '../rulesets/service.js';
import { result } from './schemas.js';

export function registerListRulesets(server: McpServer, rulesets: RulesetService): void {
  server.registerTool(
    'list_rulesets',
    {
      title: 'List rulesets',
      description:
        'Lists the rulesets this server is configured with. Pass a name as the `ruleset` argument of other tools; ' +
        'when `ruleset` is omitted, the default ruleset is used. `ruleCount` counts the rules that are enabled.',
      outputSchema: {
        rulesets: z.array(
          z.object({
            name: z.string(),
            source: z.string().describe('File path, or the package the ruleset comes from'),
            isDefault: z.boolean(),
            ruleCount: z.number().int(),
            formats: z.array(z.string()).describe('Document formats the rules apply to'),
          }),
        ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => result({ rulesets: rulesets.list() }),
  );
}
