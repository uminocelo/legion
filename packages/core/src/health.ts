import { createServer, type Server } from 'node:http';

export interface HealthProbe {
  dbOk(): Promise<boolean>;
  discordReady(): boolean;
}

/** `GET /healthz`: 200 when the DB answers and the Discord client is ready, 503 otherwise. */
export function startHealthServer(port: number, probe: HealthProbe, host = '0.0.0.0'): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== '/healthz') {
      res.writeHead(404).end();
      return;
    }
    const db = await probe.dbOk().catch(() => false);
    const discord = probe.discordReady();
    const ok = db && discord;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'ok' : 'unavailable', db, discord }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
