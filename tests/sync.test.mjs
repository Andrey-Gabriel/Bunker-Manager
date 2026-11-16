import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { test } from 'node:test';

test('serviço só aceita contas autorizadas e preserva a versão contra gravações concorrentes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'abrigo-sync-'));
  const token = randomBytes(32).toString('hex');
  const server = spawn(process.execPath, [fileURLToPath(new URL('../sync-server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0', ABRIGO_SYNC_HOST: '127.0.0.1',
      ABRIGO_SYNC_DIR: directory, ABRIGO_SYNC_ORIGIN: 'null', ABRIGO_SYNC_ACCOUNTS: token },
    windowsHide: true
  });
  t.after(async () => {
    if (server.exitCode === null) {
      const ended = once(server, 'exit');
      server.kill();
      await ended;
    }
    const filename = createHash('sha256').update(token).digest('hex') + '.json';
    await rm(join(directory, filename), { force: true });
    await rm(join(directory, filename + '.tmp'), { force: true });
    await rmdir(directory);
  });
  const [ready] = await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(([code]) => { throw new Error('Servidor encerrou antes de iniciar · código ' + code); })
  ]);
  const port = /porta (\d+)/.exec(String(ready))?.[1];
  assert(port);
  const url = 'http://127.0.0.1:' + port + '/save';
  const request = (method, body, credential = token, origin = 'null') => fetch(url, {
    method, headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json', Origin: origin },
    body: body ? JSON.stringify(body) : undefined
  });
  assert.equal((await request('GET', null, 'a'.repeat(64))).status, 403);
  assert.equal((await request('GET', null, token, 'https://outro.invalid')).status, 403);
  assert.equal((await request('GET').then(response => response.json())).revision, 0);
  const updates = await Promise.all([
    request('PUT', { revision: 0, snapshot: '{"clock":48}' }),
    request('PUT', { revision: 0, snapshot: '{"clock":144}' })
  ]);
  assert.deepEqual(updates.map(response => response.status).sort(), [200, 409]);
  const cloud = await request('GET').then(response => response.json());
  assert.equal(cloud.revision, 1);
  assert(['{"clock":48}', '{"clock":144}'].includes(cloud.snapshot));
  assert.equal((await request('PUT', { revision: 1, snapshot: '{"clock":172}' })).status, 200);
  assert.equal((await request('GET').then(response => response.json())).snapshot, '{"clock":172}');
});
