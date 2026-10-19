export const STORAGE_KEY = 'daily-health:v1';
export const RECOVERY_KEY = 'daily-health:before-import';
export const NUTRIENTS = { energy: ['能量', 'kJ'], protein: ['蛋白质', 'g'], fat: ['脂肪', 'g'], carbs: ['碳水化合物', 'g'], fiber: ['膳食纤维', 'g'], sodium: ['钠', 'mg'] };
export const EXERCISE_UNITS = ['个', '秒', '分钟'];
export const MEALS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
export const BODY = { weight: ['体重', 'kg'], waist: ['腰围', 'cm'], hip: ['臀围', 'cm'], chest: ['胸围', 'cm'], thigh: ['大腿围', 'cm'], arm: ['上臂围', 'cm'] };
export const emptyState = () => ({ version: 1, foods: [], exercises: [], days: {}, targets: {} });
export const emptyDay = () => ({ meals: { breakfast: [], lunch: [], dinner: [], snack: [] }, mealNotes: { breakfast: '', lunch: '', dinner: '', snack: '' }, dietNote: '', workouts: [], workoutNote: '', body: {} });
export const uid = () => globalThis.crypto.randomUUID();
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const d = new Date(`${key}T12:00:00`);
  return !Number.isNaN(d.getTime()) && dateKey(d) === key && key >= '1900-01-01' && key <= '2200-12-31';
}
export function shiftDate(key, offset) {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + offset);
  return dateKey(d);
}
export function dayOf(state, key) { return state.days[key] || emptyDay(); }
export function scaleNutrients(food, quantity) {
  return Object.fromEntries(Object.keys(NUTRIENTS).map(k => [k, food.nutrients[k] == null ? null : food.nutrients[k] * quantity / food.baseQuantity]));
}
export function totals(day) {
  const items = Object.values(day.meals).flat();
  return Object.fromEntries(Object.keys(NUTRIENTS).map(k => {
    let value = 0, missing = 0;
    for (const item of items) {
      const n = scaleNutrients(item.food, item.quantity)[k];
      if (n == null) missing++; else value += n;
    }
    return [k, { value, missing, count: items.length }];
  }));
}
export function nutrientComparison(actual, target) {
  if (target == null) return null;
  return { difference: actual - target, percentage: target > 0 ? actual / target * 100 : null };
}
export function foodEntry(food, quantity = food.baseQuantity) { return { id: uid(), food: structuredClone(food), quantity }; }
export function workoutEntry(exercise) { return { id: uid(), exercise: structuredClone(exercise), duration: null, feeling: '' }; }
export function series(state, end, count, field) {
  return Array.from({ length: count }, (_, i) => {
    const date = shiftDate(end, i - count + 1);
    return { date, value: state.days[date]?.body[field] ?? null };
  });
}
export function hasRecord(day) {
  return Object.values(day.meals).some(a => a.length) || day.workouts.length > 0 || Object.values(day.body).some(v => v != null) || day.dietNote || day.workoutNote || Object.values(day.mealNotes).some(Boolean);
}

// Normalize a complete backup to an allowlisted shape before anything reaches storage.
export function validateBackup(input) {
  const fail = message => { throw new Error(`备份格式不正确：${message}`); };
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const string = (v, max, name, required = false) => {
    if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(name);
    return v;
  };
  const number = (v, name, positive = false, optional = false, integer = false) => {
    if (optional && v == null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || v > 1e9 || (positive ? v <= 0 : v < 0) || (integer && !Number.isInteger(v))) fail(name);
    return v;
  };
  const array = (v, max, name) => { if (!Array.isArray(v) || v.length > max) fail(name); return v; };
  const id = v => string(v, 100, '条目标识', true);
  const unique = (items, name) => { if (new Set(items.map(x => x.id)).size !== items.length) fail(`${name}标识重复`); return items; };
  const food = v => {
    if (!obj(v) || !obj(v.nutrients)) fail('食物');
    return { id: id(v.id), name: string(v.name, 100, '食物名称', true), baseQuantity: number(v.baseQuantity, '食物基准数量', true), unit: string(v.unit, 20, '食物单位', true), nutrients: Object.fromEntries(Object.keys(NUTRIENTS).map(k => [k, number(v.nutrients[k], NUTRIENTS[k][0], false, true)])) };
  };
  const exercise = v => {
    if (!obj(v)) fail('动作');
    if (!EXERCISE_UNITS.includes(v.unit)) fail('动作单位');
    return { id: id(v.id), name: string(v.name, 100, '动作名称', true), sets: number(v.sets, '组数', true, false, true), reps: number(v.reps, '每组数量', true), unit: v.unit };
  };
  if (!obj(input) || input.version !== 1 || !obj(input.days)) fail('版本或日期记录');
  const state = emptyState();
  // Older version-1 backups did not contain standards. Keep those usable.
  if (input.targets != null && !obj(input.targets)) fail('每日营养标准');
  for (const key of Object.keys(NUTRIENTS)) state.targets[key] = number(input.targets?.[key], '每日' + NUTRIENTS[key][0] + '标准', false, true);
  state.foods = unique(array(input.foods, 5000, '食物库').map(food), '食物库');
  state.exercises = unique(array(input.exercises, 5000, '动作库').map(exercise), '动作库');
  if (Object.keys(input.days).length > 30000) fail('日期数量过多');
  for (const [date, raw] of Object.entries(input.days)) {
    if (!validDate(date) || !obj(raw) || !obj(raw.meals) || !obj(raw.mealNotes) || !obj(raw.body)) fail('日期或日记录');
    const day = emptyDay();
    for (const key of Object.keys(MEALS)) {
      day.meals[key] = unique(array(raw.meals[key], 1000, '餐食').map(v => {
        if (!obj(v)) fail('餐食');
        return { id: id(v.id), food: food(v.food), quantity: number(v.quantity, '食用数量', true) };
      }), '餐食');
      day.mealNotes[key] = string(raw.mealNotes[key], 5000, '餐食备注');
    }
    day.dietNote = string(raw.dietNote, 5000, '饮食备注');
    day.workoutNote = string(raw.workoutNote, 5000, '锻炼备注');
    day.workouts = unique(array(raw.workouts, 1000, '训练').map(v => {
      if (!obj(v)) fail('训练');
      return { id: id(v.id), exercise: exercise(v.exercise), duration: number(v.duration, '时长', false, true), feeling: string(v.feeling, 5000, '感受') };
    }), '训练');
    for (const key of Object.keys(BODY)) day.body[key] = number(raw.body[key], BODY[key][0], true, true);
    state.days[date] = day;
  }
  return state;
}
