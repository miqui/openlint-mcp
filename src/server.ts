import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { NAME, VERSION } from './version.js';

/**
 * Creates the OpenLint MCP server. Tools are registered in later milestones.
 */
export function createServer(): McpServer {
  return new McpServer({ name: NAME, version: VERSION });
}
