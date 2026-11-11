/**
 * Take a database backup right now (the worker also does it nightly with
 * BACKUPS_ENABLED=true). Needs pg_dump. Usage: npm run backup:now
 */
import { runBackup } from "../src/server/backups";

runBackup(new Date(), { force: true })
  .then((r) => {
    console.log(r ? `Saved ${r.key} (${r.bytes} bytes before compression).` : "Nothing done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
