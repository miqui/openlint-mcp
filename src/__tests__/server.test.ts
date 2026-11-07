import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../server.js';
import { NAME, VERSION } from '../version.js';

describe('createServer', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('completes the MCP handshake and reports its name and version', async () => {
    const server = createServer();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    expect(client.getServerVersion()).toEqual({ name: NAME, version: VERSION });
  });

  it('does not advertise any tools yet', async () => {
    const server = createServer();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    expect(client.getServerCapabilities()?.tools).toBeUndefined();
  });
});
