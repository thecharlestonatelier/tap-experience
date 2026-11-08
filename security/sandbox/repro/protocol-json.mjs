/* Lead 5: the deployed web root serves the legacy patient protocol with no
   credential. Records predicates only; the response body is never written
   to evidence. After the fix, the direct identifiers (phone, prescriber
   name) are gone from the served config. */
import { startPortal, call, guard } from './lib.mjs';

guard('protocol-json', async () => {
  const p = await startPortal();
  try {
    const proto = await call(p.base, '/protocol.json');
    const tpl = await call(p.base, '/templates.json');
    const phone = /\d{3}-\d{3}-\d{4}/;
    const prescriber = /Phelps-Polirer/;

    const containsPhone = phone.test(proto.text) || phone.test(tpl.text);
    const containsPrescriber = prescriber.test(proto.text) || prescriber.test(tpl.text);
    const expect = process.env.EXPECT || 'vulnerable';

    return {
      ok: expect === 'blocked'
        ? (proto.status === 200 && tpl.status === 200 && !containsPhone && !containsPrescriber)
        : (proto.status === 200 && containsPhone),
      expectation: expect,
      protocol_status: proto.status,
      templates_status: tpl.status,
      bytes: Buffer.byteLength(proto.text, 'utf8'),
      contains_patient_object: /"patient"\s*:/.test(proto.text),
      contains_phone_pattern: containsPhone,
      contains_prescriber_name: containsPrescriber,
      contains_regimen: /"protocol"\s*:/.test(proto.text),
      layout: 'sandbox /app/public mirrors Dockerfile COPY patients/jessica ./public',
      // Never emit the fields themselves.
      redacted: true,
    };
  } finally {
    p.stop();
  }
});
