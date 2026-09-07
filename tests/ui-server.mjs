import { after } from 'node:test';
import { createServer } from 'vite';

const server = process.env.TEST_BASE_URL ? null : await createServer({
  server: { host: '127.0.0.1', port: 0 },
});
if (server) await server.listen();
after(async () => { await server?.close(); });
export const BASE = process.env.TEST_BASE_URL || server.resolvedUrls.local[0];
