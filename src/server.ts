import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { RulesetService } from './rulesets/service.js';
import { registerListRulesets } from './tools/list-rulesets.js';
import { registerValidateRuleset } from './tools/validate-ruleset.js';
import { NAME, VERSION } from './version.js';

export interface ServerDependencies {
  readonly rulesets: RulesetService;
}

/** Creates the OpenLint MCP server with its tools registered. It is not connected to a transport. */
export function createServer({ rulesets }: ServerDependencies): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION });
  registerListRulesets(server, rulesets);
  registerValidateRuleset(server, rulesets);
  return server;
}
