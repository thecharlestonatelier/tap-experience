/* The Studio's treatment picker reads /api/services, which reads
   portal/services.json at runtime. The image must carry that file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

test('the image carries the services catalogue', () => {
  assert.match(dockerfile, /^COPY portal\/services\.json \.\/services\.json$/m);
  assert.ok(fs.existsSync(path.join(root, 'portal/services.json')));
});
