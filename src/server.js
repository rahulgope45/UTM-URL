import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbFile);
const server = createApp({ db, config }).listen(config.port, () => {
  console.log(`UTM attribution running on http://localhost:${config.port}`);
  console.log(`  dashboard  http://localhost:${config.port}/dashboard/`);
  console.log(`  builder    http://localhost:${config.port}/builder/`);
  if (config.demoStore) console.log(`  demo store http://localhost:${config.port}/store/`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
