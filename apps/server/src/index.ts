import 'dotenv/config';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { makeApp } from './app.js';
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:5173';
const configuredViewers = Number(process.env.MAX_VIEWERS || 5);
const configuredIdle = Number(process.env.ROOM_IDLE_MINUTES || 60);
const server = makeApp({ origin, maxViewers: Number.isFinite(configuredViewers) ? Math.min(5, Math.max(1, Math.floor(configuredViewers))) : 5, idleMs: (Number.isFinite(configuredIdle) ? Math.max(5, configuredIdle) : 60) * 60_000 });
const webDist = path.resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) {
  const express = (await import('express')).default;
  server.app.use(express.static(webDist));
  server.app.get('*', (req, res, next) => req.path.startsWith('/api') ? next() : res.sendFile(path.join(webDist, 'index.html')));
}
server.httpServer.listen(port, host, () => console.log(`StreamHub running at http://${host}:${port}`));
let stopBot: (() => void) | undefined;
if (process.env.DISCORD_TOKEN && process.env.DISCORD_CLIENT_ID) {
  const { startDiscordBot } = await import('./discord.js');
  startDiscordBot(server.store, server.endRoom, origin, process.env.DISCORD_TOKEN, process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID || undefined).then(stop => { stopBot = stop; console.log('Discord bot connected'); }).catch(err => console.error('Discord bot unavailable:', err instanceof Error ? err.message : 'unknown error'));
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { stopBot?.(); await server.close(); process.exit(0); });
