import { createApp } from "../../server/app.js";
// An isolated database keeps browser mutations out of the user's working data.
const { app, db } = createApp(":memory:");
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
