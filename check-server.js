#!/usr/bin/env node
/**
 * Quick checks before starting the server. Run: node check-server.js
 */
import { readFileSync, existsSync } from 'fs';
import { createConnection } from 'net';

const projectRoot = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const envPath = `${projectRoot}/.env`;
const port = process.env.PORT || 3000;

console.log('Node version:', process.version);
console.log('PORT:', port);
console.log('.env exists:', existsSync(envPath));

if (existsSync(envPath)) {
  const env = readFileSync(envPath, 'utf8');
  const hasDb = /DATABASE_URL=.+/.test(env) && !/DATABASE_URL=\s*$/.test(env);
  const hasJwt = /JWT_SECRET=.+/.test(env) && !/JWT_SECRET=\s*$/.test(env);
  console.log('DATABASE_URL set:', hasDb);
  console.log('JWT_SECRET set:', hasJwt);
}

function isPortInUse(p) {
  return new Promise((resolve) => {
    const socket = createConnection(p, '127.0.0.1', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

const inUse = await isPortInUse(port);
console.log(`Port ${port} in use:`, inUse);
if (inUse) {
  console.log('\n→ Another process is using port', port);
  console.log('  Change PORT in .env (e.g. PORT=3001) or stop the other process.');
  process.exit(1);
}

console.log('\n✓ Checks passed. Start the server with: npm start');
process.exit(0);
