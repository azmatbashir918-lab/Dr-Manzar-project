import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || '';
const database = process.env.MONGODB_DB || '';
let client;
// SRV DNS resolution can outlast driver server-selection timeouts.
const deadline = setTimeout(() => {
  console.error('MongoDB connection check timed out. Check DNS/network access and the Atlas IP access list.');
  process.exit(1);
}, 20000);
try {
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) throw Object.assign(new Error(), { safeMessage: 'Set a valid MONGODB_URI in backend/.env.' });
  if (/[<>\s]/.test(uri)) throw Object.assign(new Error(), { safeMessage: 'Remove placeholder brackets/whitespace from MONGODB_URI.' });
  if (!database || /[\/\\. "$*<>:|?\x00]/.test(database)) throw Object.assign(new Error(), { safeMessage: 'Set MONGODB_DB to a valid database name, for example dr_manzar.' });
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000,
    socketTimeoutMS: 10000, maxPoolSize: 2, appName: 'DrManzarConnectionCheck' });
  await client.connect();
  await client.db(database).command({ ping: 1 });
  console.log('MongoDB connection and authentication succeeded. No records were written.');
  console.log('The API is configured for MongoDB.');
} catch (error) {
  // Driver messages may contain addresses or URI fragments. Never print the raw error.
  const text = error.safeMessage || (error.code === 18 || error.code === 8000 ? 'MongoDB authentication failed. Check the database username/password and URI encoding.'
    : error.name === 'MongoParseError' ? 'MongoDB URI could not be parsed. Check separators and percent-encode special characters in credentials.'
    : 'MongoDB connection failed. Check cluster availability, DNS/network access and the Atlas IP access list.');
  console.error(text);
  process.exitCode = 1;
} finally { clearTimeout(deadline); await client?.close().catch(() => {}); }
