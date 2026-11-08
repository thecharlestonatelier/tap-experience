/* Lead 1: patient-controlled state renders unescaped in Card Studio. */
import { chromium } from 'playwright';
import { startPortal, session, mint, call, guard, sleep } from './lib.mjs';

guard('xss-state', async () => {
  const p = await startPortal({ STUDIO_PASSPHRASE: 'testpassphrase' });
  try {
    const cookie = await session(p.base);
    await mint(p.base, cookie, { slug: 'xsst.t', name: 'XSS State', status: 'active', pens: [{ template: 'glow' }] });

    const marker = '<img src=x onerror=window.__xss=1>';
    const posted = await call(p.base, '/api/state/xsst.t', {
      method: 'POST',
      body: {
        today: [{ pen: marker, template: 'glow', phase: 'p', units: 1, mg: 1, at: '08:00' }],
        times: { Morning: '08:00' },
      },
    });

    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    await ctx.request.post(`${p.base}/api/session`, { data: { passphrase: 'testpassphrase' } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${p.base}/studio/`);
    await page.waitForSelector('tr[data-slug="xsst.t"]', { timeout: 15000 });
    await page.click('tr[data-slug="xsst.t"]');
    await sleep(800);

    const executed = await page.evaluate(() => window.__xss === 1);
    const html = await page.evaluate(() => document.getElementById('seen')?.innerHTML || '');
    const text = await page.evaluate(() => document.getElementById('seen')?.textContent || '');
    await browser.close();

    const rendered = text.includes(marker);
    const expect = process.env.EXPECT || 'vulnerable';
    return {
      ok: expect === 'blocked' ? (!executed && rendered) : executed,
      executed,
      rendered_as_text: rendered,
      marker_in_dom: html.includes(marker),
      state_post_status: posted.status,
      page_errors: errors,
    };
  } finally {
    p.stop();
  }
});
