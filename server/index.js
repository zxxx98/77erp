import { createApp } from "./app.js";
const { app, db } = createApp(process.env.DB_PATH);
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
