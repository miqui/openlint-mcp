import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

export const NAME = 'openlint-mcp';
export const VERSION = pkg.version;
