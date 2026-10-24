import { networkInterfaces } from 'node:os';
import { createGameServer } from './app.js';

const server = await createGameServer();
const port = await server.listen();
console.log(`ALIBI is running at http://localhost:${port}`);
for (const addresses of Object.values(networkInterfaces())) for (const address of addresses ?? []) {
  if (!address.internal && address.family === 'IPv4' && !address.address.startsWith('169.254.')) console.log(`Phones on the same Wi-Fi: http://${address.address}:${port}`);
}
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await server.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
