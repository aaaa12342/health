import { emptyState, emptyDay, validateBackup, STORAGE_KEY, NUTRIENTS, MEALS, BODY } from './domain.js?v=20261020-cloud1';

export function publicConfig(config) {
  const url = new URL(config?.supabaseUrl || '');
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.pathname !== '/' || url.search || url.hash) throw new Error('云连接地址无效');
  const key = String(config?.supabaseKey || '').trim();
  if (key.startsWith('sb_publishable_') && key.length > 20) return { url: url.origin, key };
  try { const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (payload.role === 'anon') return { url: url.origin, key }; } catch {}
  throw new Error('只能使用公开 Publishable / anon key，禁止管理员密钥');
}
export function cloudError(error) {
  if (['PGRST205', 'PGRST202', '42P01', '42883'].includes(error?.code)) return '健康数据库尚未初始化，请在 Supabase SQL Editor 运行 supabase/health-sync.sql。';
  if (error?.message?.includes('HEALTH_ACCOUNT_CHANGED')) return '账号已变化，已拒绝写入，请重新同步当前账号。';
  if (error?.message?.includes('HEALTH_CONFLICT')) return '记录已在另一台设备修改。此次更改未确认保存，请保留表单内容，关闭表单后重新同步再操作。';
  if (error?.message === 'Failed to fetch' || error?.name === 'AbortError') return '连接失败或超时，请检查网络后重新同步；本次更改未确认保存。';
  return error?.message || '云端操作失败，请重新同步后再试';
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function mergeItems(left, right, label) {
  const result = structuredClone(left), index = new Map(result.map(v => [v.id, v]));
  for (const item of right) {
    if (!index.has(item.id)) { const copy = structuredClone(item); result.push(copy); index.set(item.id, copy); }
    else if (!same(index.get(item.id), item)) throw new Error(label + '存在同一标识的不同内容，已取消迁移；请先导出备份处理冲突。');
  }
  return result;
}
function combineValue(oldValue, value, label) {
  if (value == null || value === '') return oldValue;
  if (oldValue == null || oldValue === '') return value;
  if (oldValue !== value) throw new Error(label + '与云端已有值不同，已取消迁移，未覆盖云端。');
  return oldValue;
}
export function mergeHealthData(current, incoming) {
  const result = validateBackup(current), local = validateBackup(incoming);
  result.foods = mergeItems(result.foods, local.foods, '食物库');
  result.exercises = mergeItems(result.exercises, local.exercises, '动作库');
  for (const key of Object.keys(NUTRIENTS)) result.targets[key] = combineValue(result.targets[key], local.targets[key], '营养标准');
  for (const [date, source] of Object.entries(local.days)) {
    const day = result.days[date] ||= emptyDay();
    for (const key of Object.keys(MEALS)) {
      day.meals[key] = mergeItems(day.meals[key], source.meals[key], date + '餐食');
      day.mealNotes[key] = combineValue(day.mealNotes[key], source.mealNotes[key], date + '餐食备注');
    }
    day.workouts = mergeItems(day.workouts, source.workouts, date + '训练');
    day.dietNote = combineValue(day.dietNote, source.dietNote, date + '饮食备注');
    day.workoutNote = combineValue(day.workoutNote, source.workoutNote, date + '锻炼感受');
    for (const key of Object.keys(BODY)) day.body[key] = combineValue(day.body[key], source.body[key], date + BODY[key][0]);
  }
  return validateBackup(result);
}
export class HealthStore {
  constructor({ storage, client = null }) {
    this.storage = storage; this.client = client; this.user = null; this.state = emptyState();
    this.revision = 0; this.generation = 0; this.request = 0;
    this.ready = false; this.loading = false; this.writing = false; this.error = '';
  }
  readLocal() { const raw = this.storage.getItem(STORAGE_KEY); return raw ? validateBackup(JSON.parse(raw)) : emptyState(); }
  useUser(user) {
    this.generation++; this.request++; this.user = user; this.revision = 0;
    this.state = emptyState(); this.ready = false; this.loading = false; this.writing = false; this.error = '';
  }
  async load() {
    if (this.writing) throw new Error('正在保存，请稍后同步');
    const generation = this.generation, request = ++this.request, user = this.user;
    this.loading = true;
    try {
      let state, revision = 0;
      if (user) {
        const { data, error } = await this.client.from('health_journals').select('payload,revision').eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        state = data ? validateBackup(data.payload) : emptyState(); revision = data ? Number(data.revision) : 0;
        if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('云端数据版本无效');
      } else state = this.readLocal();
      if (generation !== this.generation || request !== this.request) return false;
      this.state = state; this.revision = revision; this.ready = true; this.error = '';
      return true;
    } catch (error) {
      if (generation === this.generation && request === this.request) { this.ready = false; this.error = cloudError(error); }
      throw error;
    } finally { if (generation === this.generation && request === this.request) this.loading = false; }
  }
  async save(candidate) {
    if (!this.ready || this.loading || this.writing) throw new Error(this.error || '正在读取或保存，请稍后操作');
    const state = validateBackup(candidate), generation = this.generation, user = this.user;
    this.writing = true;
    try {
      if (user) {
        const { data, error } = await this.client.rpc('save_health_journal', { p_payload: state, p_expected_revision: this.revision, p_expected_user: user.id });
        if (error) throw error;
        if (generation !== this.generation) throw new Error('账号已切换，未将旧请求显示到当前账号');
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || Number(row.revision) !== this.revision + 1) throw new Error('云端未返回有效保存版本，请重新同步确认');
        this.state = validateBackup(row.payload); this.revision = Number(row.revision);
      } else { this.storage.setItem(STORAGE_KEY, JSON.stringify(state)); this.state = state; }
      this.error = ''; return this.state;
    } catch (error) {
      if (user && generation === this.generation) { this.ready = false; this.error = cloudError(error); }
      throw error;
    } finally { if (generation === this.generation) this.writing = false; }
  }
}
