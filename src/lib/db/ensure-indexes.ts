/** `npm run migrate`: create the indexes the queue needs. Idempotent. */
import { closeDb, ensureIndexes } from "./client";

ensureIndexes()
  .then(() => console.log("[db] indexes ensured"))
  .catch((err) => {
    console.error("[db] failed to ensure indexes", err);
    process.exitCode = 1;
  })
  .finally(closeDb);
