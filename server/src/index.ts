import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig, loadEnvFiles } from './config.js';
import { createServices } from './container.js';
import { startJobs } from './jobs.js';
import { attachWebSocket } from './ws.js';

loadEnvFiles();
const config = loadConfig();
const services = createServices(config);
const app = createApp(services);
const server = http.createServer(app);
const wss = attachWebSocket(server, services);
services.orchestrator.start();
const stopJobs = startJobs(services);

if (services.masterKeySource === 'generated') {
  console.warn(`[security] Generated a new master key at ${config.dataDir}/master.key – back it up; without it stored credentials cannot be decrypted.`);
}

server.listen(config.port, config.host, () => {
  console.log(`AI Multi-Agent Office API listening on http://${config.host}:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received – shutting down…`);
  stopJobs();
  wss.close();
  server.close();
  await services.dispose();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
