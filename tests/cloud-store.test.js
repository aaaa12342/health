import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthStore, mergeHealthData, publicConfig, cloudError } from '../cloud-store.js';
import { emptyState, emptyDay, STORAGE_KEY, foodEntry } from '../domain.js';
const memory = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
};
const userA = { id: 'account-a' }, userB = { id: 'account-b' };
function database() {
  const rows = new Map();
  return { rows, client(owner) {
    return {
      from() { return { select() { return this; }, eq(_key, id) { this.id = id; return this; }, async maybeSingle() {
        assert.equal(this.id, owner.id); return { data: structuredClone(rows.get(this.id) ?? null), error: null };
      } }; },
      async rpc(name, params) {
        assert.equal(name, 'save_health_journal');
        assert.equal(params.p_expected_user, owner.id);
        const current = rows.get(owner.id), revision = current?.revision || 0;
        if (revision !== params.p_expected_revision) return { data: null, error: { message: 'HEALTH_CONFLICT' } };
        const row = { payload: structuredClone(params.p_payload), revision: revision + 1 };
        rows.set(owner.id, row); return { data: [row], error: null };
      }
    };
  } };
}
const food = () => ({ id: 'f1', name: '燕麦', baseQuantity: 100, unit: '克', nutrients: { energy: 1600, protein: 12, fat: 8, carbs: 60, fiber: null, sodium: 0 } });
test('云端保存独立于本机记录，退出切回原始本机记录', async () => {
  const storage = memory(), local = emptyState(); local.foods.push(food()); storage.setItem(STORAGE_KEY, JSON.stringify(local));
  const db = database(), store = new HealthStore({ storage, client: db.client(userA) });
  await store.load(); assert.equal(store.state.foods.length, 1);
  store.useUser(userA); await store.load(); assert.equal(store.state.foods.length, 0);
  const cloud = emptyState(); cloud.targets.protein = 90; await store.save(cloud);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).foods.length, 1);
  assert.equal(db.rows.get(userA.id).payload.targets.protein, 90);
  store.useUser(null); await store.load(); assert.equal(store.state.foods[0].name, '燕麦');
});
test('两个设备首次创建和后续保存均检查版本，冲突不覆盖', async () => {
  const db = database();
  const a = new HealthStore({ storage: memory(), client: db.client(userA) }), b = new HealthStore({ storage: memory(), client: db.client(userA) });
  for (const store of [a, b]) { store.useUser(userA); await store.load(); }
  const first = emptyState(); first.targets.protein = 100; await a.save(first);
  const other = emptyState(); other.targets.protein = 50;
  await assert.rejects(() => b.save(other), error => error.message === 'HEALTH_CONFLICT');
  assert.equal(db.rows.get(userA.id).payload.targets.protein, 100); assert.equal(b.ready, false);
  await b.load(); await b.save(other); assert.equal(b.revision, 2);
  await assert.rejects(() => a.save(first), error => error.message === 'HEALTH_CONFLICT');
  assert.equal(db.rows.get(userA.id).payload.targets.protein, 50);
});
test('读取失败或初始化未完成时禁止写入，防止空状态覆盖', async () => {
  let writes = 0;
  const client = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { error: { code: 'PGRST205' } }; } }; }, rpc() { writes++; } };
  const store = new HealthStore({ storage: memory(), client }); store.useUser(userA);
  await assert.rejects(() => store.load());
  assert.equal(store.ready, false); assert.match(store.error, /尚未初始化/);
  await assert.rejects(() => store.save(emptyState())); assert.equal(writes, 0);
});
test('云写入失败不回退本机或假成功，配额失败也不改当前状态', async () => {
  const storage = memory(), db = database(), client = db.client(userA);
  const store = new HealthStore({ storage, client }); store.useUser(userA); await store.load();
  client.rpc = async () => ({ error: new Error('Failed to fetch') });
  const next = emptyState(); next.targets.energy = 8000;
  await assert.rejects(() => store.save(next)); assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(store.state.targets.energy, undefined); assert.equal(store.ready, false);
  const local = new HealthStore({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } });
  await local.load(); await assert.rejects(() => local.save(next), /quota/); assert.equal(local.state.targets.energy, undefined);
});
test('账号切换后旧读取请求不能回填视图', async () => {
  let finish;
  const client = { from() { return { select() { return this; }, eq(_k, id) { this.id = id; return this; }, maybeSingle() {
    return this.id === userA.id ? new Promise(resolve => finish = resolve) : Promise.resolve({ data: null, error: null });
  } }; } };
  const store = new HealthStore({ storage: memory(), client });
  store.useUser(userA); const oldRequest = store.load();
  store.useUser(userB); await store.load();
  const payload = emptyState(); payload.targets.energy = 9999; finish({ data: { payload, revision: 3 } });
  assert.equal(await oldRequest, false); assert.equal(store.user.id, userB.id); assert.equal(store.state.targets.energy, undefined);
});
test('账号切换后旧写入响应不能进入新账号状态', async () => {
  const db = database(), client = db.client(userA); let finish;
  const store = new HealthStore({ storage: memory(), client }); store.useUser(userA); await store.load();
  client.rpc = () => new Promise(resolve => finish = resolve);
  const next = emptyState(); next.targets.protein = 100; const oldSave = store.save(next);
  store.useUser(userB); finish({ data: [{ payload: next, revision: 1 }] });
  await assert.rejects(() => oldSave, /账号已切换/); assert.equal(store.state.targets.protein, undefined);
});
test('本机迁移可重复执行，保留云端和本地的独立条目', () => {
  const cloud = emptyState(), local = emptyState(); local.foods.push(food()); local.days['2026-10-20'] = emptyDay();
  local.days['2026-10-20'].meals.breakfast.push(foodEntry(food())); local.days['2026-10-20'].body.weight = 60;
  cloud.days['2026-10-20'] = emptyDay(); cloud.days['2026-10-20'].body.waist = 75; cloud.targets.protein = 80;
  const merged = mergeHealthData(cloud, local), again = mergeHealthData(merged, local);
  assert.deepEqual(merged, again); assert.equal(merged.days['2026-10-20'].body.waist, 75); assert.equal(merged.days['2026-10-20'].body.weight, 60);
  assert.equal(merged.days['2026-10-20'].meals.breakfast.length, 1); assert.equal(local.days['2026-10-20'].body.waist, undefined);
});
test('同 ID 不同内容、同日体重、备注或标准冲突均取消迁移', () => {
  const cloud = emptyState(), local = emptyState(); cloud.foods.push(food()); local.foods.push({ ...food(), name: '冲突名称' });
  assert.throws(() => mergeHealthData(cloud, local), /已取消/);
  for (const field of ['weight', 'note', 'target']) {
    const a = emptyState(), b = emptyState(); a.days['2026-10-20'] = emptyDay(); b.days['2026-10-20'] = emptyDay();
    if (field === 'weight') { a.days['2026-10-20'].body.weight = 60; b.days['2026-10-20'].body.weight = 61; }
    if (field === 'note') { a.days['2026-10-20'].dietNote = 'A'; b.days['2026-10-20'].dietNote = 'B'; }
    if (field === 'target') { a.targets.protein = 80; b.targets.protein = 100; }
    assert.throws(() => mergeHealthData(a, b), /已取消/);
  }
});
test('公开连接只接收 Supabase URL 与 publishable/anon key', () => {
  assert.equal(publicConfig({ supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_publishable_abcdefghijklmno' }).url, 'https://example.supabase.co');
  for (const config of [
    { supabaseUrl: 'https://example.supabase.co.attacker.com', supabaseKey: 'sb_publishable_abcdefghijklmno' },
    { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_secret_123' },
    { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'x.' + btoa(JSON.stringify({ role: 'service_role' })) + '.x' }
  ]) assert.throws(() => publicConfig(config));
  assert.match(cloudError({ message: 'HEALTH_CONFLICT' }), /另一台设备/);
});
