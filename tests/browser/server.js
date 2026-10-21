import { aiFetch } from './ai-provider.js';
import { createApp } from "../../server/app.js";
import { randomUUID } from 'node:crypto';
const qualityObjects = new Map();
// An isolated database keeps browser mutations out of the user's working data.
const { app, db, notifications } = createApp(":memory:", { aiFetch, aiEncryptionKey: 'ab'.repeat(32), qualityStorage: {
  async put(c,key,body) { qualityObjects.set(`${c.bucket}:${key}`, Buffer.from(body)); },
  async get(c,key) { const body=qualityObjects.get(`${c.bucket}:${key}`); if(!body)throw new Error('Missing fixture Excel');return body; },
  async head(c,key) { if(!qualityObjects.has(`${c.bucket}:${key}`))throw new Error('Missing fixture Excel'); },
  async remove(c,key) { qualityObjects.delete(`${c.bucket}:${key}`); },
}, webhookSend: async config => {
  if (new URL(config.url).hostname !== 'hooks.77erp.test') throw new Error('Unexpected webhook destination');
}, imagebedFetch: async (url, options) => {
  if (url.origin !== 'https://img.77erp.test' || url.pathname !== '/upload' || url.searchParams.get('uploadChannel') !== 'cfr2' || options.body.get('file')?.type !== 'image/webp')
    throw new Error('Unexpected image host request in browser fixture');
  return new Response(JSON.stringify([{ src: `/file/77erp/products/${randomUUID()}.webp` }]));
} });
// A separate fresh instance covers the first-run UI without resetting other tests.
const fresh = createApp(":memory:");
const freshServer = fresh.app.listen(3200, "127.0.0.1");
const server = app.listen(3199, "127.0.0.1");
notifications.start();
process.on("SIGTERM", () => {
  freshServer.close(() => fresh.db.close());
  server.close(async () => {
    await notifications.stop();
    db.close();
    process.exit(0);
  });
});
