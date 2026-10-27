// Entry point: `npm start` (node src/index.ts). PORT env, default 8787.
import { startServer } from './server.ts';

const port = Number(process.env.PORT ?? 8787);
const server = await startServer({ port, host: '0.0.0.0' });
console.log(`BattleCore server listening on :${server.port}`);

let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 5000).unref();
  server.close().then(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
