const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const mockSDK = String.raw`
window.supabase = { createClient() {
  let listener = null;
  const read = () => JSON.parse(localStorage.getItem('health-test-auth') || 'null');
  return {
    auth: {
      async getSession() { const user = read(); return { data: { session: user ? { user } : null }, error: null }; },
      onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email }) {
        const user = { id: email.startsWith('b') ? 'b' : 'a', email };
        localStorage.setItem('health-test-auth', JSON.stringify(user));
        if (listener) listener('SIGNED_IN', { user });
        return { data: { user, session: { user } }, error: null };
      },
      async signOut() { localStorage.removeItem('health-test-auth'); if (listener) listener('SIGNED_OUT', null); return { error: null }; }
    },
    from() { return { select() { return this; }, eq(_key, value) { this.id = value; return this; },
      async maybeSingle() { return fetch('/_health_mock?owner=' + this.id + '&auth=' + read()?.id).then(r => r.json()); }
    }; },
    async rpc(name, params) { return fetch('/_health_mock', { method: 'POST', body: JSON.stringify({ owner: read()?.id, name, params }) }).then(r => r.json()); }
  };
} };
`;
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const rows = new Map(), errors = []; let failSave = false;
  const context = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.route('**/vendor/supabase.js', r => r.fulfill({ contentType: 'text/javascript', body: mockSDK }));
    await ctx.route('**/_health_mock**', async r => {
      const req = r.request(); let result;
      if (req.method() === 'GET') {
        const url = new URL(req.url()), owner = url.searchParams.get('owner');
        assert.equal(owner, url.searchParams.get('auth')); result = { data: rows.get(owner) || null, error: null };
      } else {
        const { owner, params, name } = req.postDataJSON(); assert.equal(name, 'save_health_journal');
        assert.equal(params.p_expected_user, owner);
        const old = rows.get(owner);
        if (failSave) { failSave = false; result = { error: { message: 'Failed to fetch' } }; }
        else if ((old?.revision || 0) !== params.p_expected_revision) result = { error: { message: 'HEALTH_CONFLICT' } };
        else { const row = { payload: params.p_payload, revision: (old?.revision || 0) + 1 }; rows.set(owner, row); result = { data: [row], error: null }; }
      }
      await r.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:4173/');
    await page.waitForFunction(() => document.querySelector('main').inert === false);
    return page;
  };
  const a = await context();
  await a.evaluate(async () => {
    const d = await import('./domain.js'); const state = d.emptyState();
    const day = d.emptyDay(); day.body.weight = 65; day.dietNote = '本地原件';
    state.days[d.dateKey()] = day; localStorage.setItem(d.STORAGE_KEY, JSON.stringify(state));
  });
  await a.reload(); await a.waitForFunction(() => !document.querySelector('main').inert);
  const originalLocal = await a.evaluate(() => localStorage.getItem('daily-health:v1'));
  const login = async (page, email) => {
    await page.locator('[data-action="account"]').first().click();
    await page.locator('dialog').getByLabel('邮箱', { exact: true }).fill(email);
    await page.locator('dialog').getByLabel('密码', { exact: true }).fill('fake-test-password');
    await page.locator('dialog').getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('main').inert && document.querySelector('#save-status').textContent.includes('云端已同步'));
  };
  const saveWeight = async (page, weight) => {
    await page.locator('[aria-label="记录体重"]').click();
    await page.locator('dialog').getByLabel('体重 / kg', { exact: true }).fill(String(weight));
    await page.locator('dialog').getByRole('button', { name: '保存', exact: true }).click();
  };
  await login(a, 'a@example.test'); assert.match(await a.locator('.body-weight').textContent(), /—/);
  await a.locator('[data-action="account"]').first().click();
  await a.locator('[data-action="migrate"]').click();
  await a.locator('dialog').getByRole('button', { name: '确认合并到云端' }).click();
  await a.waitForFunction(() => document.querySelector('.body-weight').textContent.includes('65'));
  assert.equal(await a.evaluate(() => localStorage.getItem('daily-health:v1')), originalLocal);
  assert.equal(rows.get('a').payload.days[Object.keys(rows.get('a').payload.days)[0]].body.weight, 65);
  const b = await context(); await login(b, 'a@example.test');
  assert.match(await b.locator('.body-weight').textContent(), /65/);
  await saveWeight(b, 66); await b.locator('dialog').waitFor({ state: 'hidden' });
  await saveWeight(a, 67);
  await a.locator('dialog #form-error').waitFor({ state: 'visible' });
  assert.match(await a.locator('dialog #form-error').textContent(), /另一台设备/);
  assert.equal(await a.locator('dialog [name="weight"]').inputValue(), '67');
  assert.equal(rows.get('a').payload.days[Object.keys(rows.get('a').payload.days)[0]].body.weight, 66);
  await a.locator('dialog [data-action="close"]').first().click();
  await a.locator('[data-action="account"]').first().click(); await a.locator('[data-action="sync-now"]').click();
  await a.locator('dialog [data-action="close"]').first().click();
  assert.match(await a.locator('.body-weight').textContent(), /66/);
  await saveWeight(a, 67); await a.locator('dialog').waitFor({ state: 'hidden' });
  failSave = true; await saveWeight(a, 68); await a.locator('dialog #form-error').waitFor({ state: 'visible' });
  assert.equal(await a.locator('dialog [name="weight"]').inputValue(), '68');
  assert.equal(await a.evaluate(() => localStorage.getItem('daily-health:v1')), originalLocal);
  await a.locator('dialog [data-action="close"]').first().click();
  await a.locator('[data-action="account"]').first().click(); await a.locator('[data-action="sign-out"]').click();
  await a.waitForFunction(() => document.querySelector('#save-status').textContent.includes('已在本机保存'));
  assert.match(await a.locator('.body-weight').textContent(), /65/);
  await a.locator('dialog [data-action="close"]').first().click();
  await login(a, 'b@example.test'); assert.match(await a.locator('.body-weight').textContent(), /—/);
  assert.doesNotMatch(await a.locator('main').textContent(), /本地原件/);
  await a.screenshot({ path: '.qa/cloud-account.png', fullPage: true });
  for (const width of [375, 390, 768]) {
    await a.setViewportSize({ width, height: 900 });
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  assert.deepEqual(errors, []);
  console.log('PASS MOCK CLOUD: shared login, explicit migration, two-device load/conflict/reload, failed-save draft retention, local preservation, logout and account switch, responsive.');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
