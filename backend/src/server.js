import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createMailer } from './mail.js';
const config = loadConfig();
let db;
try { db = await openDatabase({uri:config.mongoUri,name:config.mongoDb}); }
catch(error) {
  console.error(error.code === 18 || error.code === 8000 ? 'MongoDB authentication failed. Update the Atlas database credentials in backend/.env.' : 'MongoDB startup failed. Check database configuration, replica-set support and Atlas network access.');
  process.exit(1);
}
const app = createApp({ db, config, sendMail: createMailer(config) });
const port = Number(process.env.PORT || 8000);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Dr Manzar API: http://${process.env.HOST || '127.0.0.1'}:${port}/api/v1/health`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await db.close(); process.exit(0); }));
