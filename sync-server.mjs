import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const maxBytes = 2 * 1024 * 1024;
const directory = resolve(process.env.ABRIGO_SYNC_DIR || 'sync-data');
const origin = process.env.ABRIGO_SYNC_ORIGIN || 'https://andrey-gabriel.github.io';
const port = Number(process.env.PORT || 8787);
const permitted = new Set((process.env.ABRIGO_SYNC_ACCOUNTS || '').split(',').map(value => value.trim())
  .filter(value => /^[0-9a-f]{64}$/.test(value))
  .map(value => createHash('sha256').update(value).digest('hex')));
if (!permitted.size) throw new Error('Configure ABRIGO_SYNC_ACCOUNTS com pelo menos um código de conta.');
mkdirSync(directory, { recursive: true, mode: 0o700 });

const server = createServer({ requestTimeout: 15000 }, async (request, response) => {
  const reply = (status, value) => {
    response.writeHead(status, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin'
    });
    response.end(value === undefined ? undefined : JSON.stringify(value));
  };
  if (request.headers.origin && request.headers.origin !== origin) return reply(403, { error: 'origin' });
  if (request.url !== '/save') return reply(404, { error: 'path' });
  if (request.method === 'OPTIONS') return reply(204);
  if (!['GET', 'PUT'].includes(request.method)) return reply(405, { error: 'method' });
  const token = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.authorization || '')?.[1];
  if (!token) return reply(401, { error: 'account' });
  const account = createHash('sha256').update(token).digest('hex');
  if (!permitted.has(account)) return reply(403, { error: 'account' });
  const filename = resolve(directory, account + '.json');
  try {
    let body;
    if (request.method === 'PUT') {
      if (Number(request.headers['content-length']) > maxBytes) return reply(413, { error: 'size' });
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes <= maxBytes) chunks.push(chunk);
      }
      if (bytes > maxBytes) return reply(413, { error: 'size' });
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(400, { error: 'json' });
      }
      if (!Number.isSafeInteger(body?.revision) || body.revision < 0 ||
          typeof body.snapshot !== 'string' || !body.snapshot.length) return reply(400, { error: 'save' });
    }
    let current = { revision: 0, snapshot: null, updatedAt: null };
    try {
      current = JSON.parse(readFileSync(filename, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (request.method === 'GET') return reply(200, current);
    if (body.revision !== current.revision) return reply(409, { error: 'conflict' });
    const next = { revision: current.revision + 1, snapshot: body.snapshot, updatedAt: new Date().toISOString() };
    // Serialize the compare and swap in one process, then replace the account file atomically.
    writeFileSync(filename + '.tmp', JSON.stringify(next), { mode: 0o600 });
    renameSync(filename + '.tmp', filename);
    return reply(200, { revision: next.revision, updatedAt: next.updatedAt });
  } catch {
    if (!response.headersSent) reply(500, { error: 'storage' });
  }
});
server.listen(port, process.env.ABRIGO_SYNC_HOST || '0.0.0.0', () =>
  process.stdout.write('ABRIGO Sync na porta ' + server.address().port + '\n'));
