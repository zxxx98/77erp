import { createApp } from "../../server/app.js";
import { randomUUID } from 'node:crypto';
// An isolated database keeps browser mutations out of the user's working data.
const { app, db } = createApp(":memory:", { imagebedFetch: async (url, options) => {
  if (url.origin !== 'https://img.77erp.test' || url.pathname !== '/upload' || url.searchParams.get('uploadChannel') !== 'cfr2' || options.body.get('file')?.type !== 'image/jpeg')
    throw new Error('Unexpected image host request in browser fixture');
  return new Response(JSON.stringify([{ src: `/file/77erp/products/${randomUUID()}.jpg` }]));
} });
// A separate fresh instance covers the first-run UI without resetting other tests.
const fresh = createApp(":memory:");
const freshServer = fresh.app.listen(3200, "127.0.0.1");
const server = app.listen(3199, "127.0.0.1");
process.on("SIGTERM", () => {
  freshServer.close(() => fresh.db.close());
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
