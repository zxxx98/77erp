import { createApp } from "./app.js";
const publicOrigins = (process.env.PUBLIC_ORIGIN || "").split(",")
  .map((value) => value.trim().replace(/\/+$/, "").toLowerCase())
  .filter((value) => /^https?:\/\/[^/?#]+$/.test(value));
// Only explicitly configured proxy addresses may supply client IP and scheme.
const trustProxy = (process.env.TRUST_PROXY || '').split(',').map(value => value.trim()).filter(Boolean);
const { app, db } = createApp(process.env.DB_PATH, { publicOrigins, trustProxy });
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, "0.0.0.0", () =>
  console.log(`77 ERP API: http://localhost:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
