import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, emptyDay, foodEntry, workoutEntry, scaleNutrients, totals, nutrientComparison, validDate, dateKey, shiftDate, series, validateBackup, hasRecord } from '../domain.js';

const food = () => ({ id: 'food-1', name: '测试燕麦', baseQuantity: 100, unit: '克', nutrients: { energy: 1600, protein: 12, fat: 8, carbs: 60, fiber: null, sodium: 0 } });
const exercise = () => ({ id: 'exercise-1', name: '深蹲', sets: 3, reps: 12, unit: '个' });
test('营养标准比较处理未设置、低于、超过及零标准', () => {
  assert.equal(nutrientComparison(100, null), null);
  assert.deepEqual(nutrientComparison(1600, 8000), { difference: -6400, percentage: 20 });
  assert.deepEqual(nutrientComparison(120, 100), { difference: 20, percentage: 120 });
  assert.deepEqual(nutrientComparison(100, 100), { difference: 0, percentage: 100 });
  assert.deepEqual(nutrientComparison(10, 0), { difference: 10, percentage: null });
  assert.deepEqual(nutrientComparison(0, 0), { difference: 0, percentage: null });
});
test('标准随备份往返；旧备份无标准时仍兼容；负数和非数值被拒绝', () => {
  const state = emptyState(); state.targets = { energy: 8000, protein: 100, sodium: 0 };
  const restored = validateBackup(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.targets.energy, 8000); assert.equal(restored.targets.sodium, 0); assert.equal(restored.targets.fat, null);
  delete state.targets; assert.equal(validateBackup(state).targets.protein, null);
  state.targets = { energy: -1 }; assert.throws(() => validateBackup(state));
  state.targets = { energy: '8000' }; assert.throws(() => validateBackup(state));
  state.targets = []; assert.throws(() => validateBackup(state));
});
test('按基准份量折算营养，保留未知和明确零', () => {
  assert.deepEqual(scaleNutrients(food(), 150), { energy: 2400, protein: 18, fat: 12, carbs: 90, fiber: null, sodium: 0 });
});
test('总览跨餐合计，未知数据单独计数', () => {
  const day = emptyDay(), unknown = food(); unknown.nutrients.protein = null;
  day.meals.breakfast.push(foodEntry(food(), 50)); day.meals.dinner.push(foodEntry(unknown, 200));
  assert.deepEqual(totals(day).energy, { value: 4000, missing: 0, count: 2 });
  assert.deepEqual(totals(day).protein, { value: 6, missing: 1, count: 2 });
  assert.deepEqual(totals(emptyDay()).energy, { value: 0, missing: 0, count: 0 });
});
test('记录保存快照，修改模板不会改动历史', () => {
  const f = food(), e = exercise(), meal = foodEntry(f, 150), workout = workoutEntry(e);
  f.nutrients.energy = 1; f.name = '新名称'; e.sets = 99;
  assert.equal(meal.food.name, '测试燕麦'); assert.equal(meal.food.nutrients.energy, 1600);
  assert.equal(workout.exercise.sets, 3);
});
test('日期严格校验，支持闰年和跨月跨年', () => {
  assert.equal(validDate('2024-02-29'), true); assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2026-13-01'), false); assert.equal(validDate('2026-2-01'), false);
  assert.equal(validDate('__proto__'), false); assert.equal(validDate('1899-12-31'), false);
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31'); assert.equal(shiftDate('2024-02-28', 1), '2024-02-29');
  assert.equal(dateKey(new Date(2026, 9, 19, 0, 1)), '2026-10-19');
});
test('趋势截至选定日，缺失日期保留 null，支持 7/30 天', () => {
  const state = emptyState(); state.days['2026-10-17'] = emptyDay(); state.days['2026-10-17'].body.weight = 60;
  const points = series(state, '2026-10-19', 7, 'weight');
  assert.equal(points[0].date, '2026-10-13'); assert.equal(points[4].value, 60); assert.equal(points[5].value, null); assert.equal(points[6].date, '2026-10-19');
  assert.equal(series(state, '2026-10-19', 30, 'waist').length, 30);
});
test('全量备份往返，未知字段不会被载入', () => {
  const state = emptyState(); state.foods.push(food()); state.exercises.push(exercise());
  const day = emptyDay(); day.meals.breakfast.push(foodEntry(food(), 150)); day.workouts.push(workoutEntry(exercise())); day.body.weight = 60; day.body.waist = 72;
  state.days['2026-10-19'] = day;
  const restored = validateBackup(JSON.parse(JSON.stringify({ ...state, unexpected: 'ignored' })));
  assert.equal(restored.days['2026-10-19'].body.weight, 60); assert.equal(restored.days['2026-10-19'].body.arm, null);
  assert.equal(restored.unexpected, undefined); assert.equal(totals(restored.days['2026-10-19']).energy.value, 2400);
});
test('恶意或损坏备份不通过校验', () => {
  assert.throws(() => validateBackup({ version: 2 }));
  const badNumber = emptyState(); const f = food(); f.baseQuantity = 0; badNumber.foods.push(f); assert.throws(() => validateBackup(badNumber));
  const badDate = emptyState(); badDate.days['2026-02-30'] = emptyDay(); assert.throws(() => validateBackup(badDate));
  const duplicate = emptyState(); duplicate.foods.push(food(), food()); assert.throws(() => validateBackup(duplicate));
  const badBody = emptyState(); badBody.days['2026-10-19'] = emptyDay(); badBody.days['2026-10-19'].body.weight = -1; assert.throws(() => validateBackup(badBody));
  const badSet = emptyState(); badSet.exercises.push({ ...exercise(), sets: 1.5 }); assert.throws(() => validateBackup(badSet));
  const proto = JSON.parse('{"version":1,"foods":[],"exercises":[],"days":{"__proto__":{}}}'); assert.throws(() => validateBackup(proto));
  const infinity = emptyState(); infinity.foods.push({ ...food(), baseQuantity: Infinity }); assert.throws(() => validateBackup(infinity));
});
test('空日不标记记录，备注、体重、动作、围度均会标记', () => {
  assert.equal(Boolean(hasRecord(emptyDay())), false);
  for (const edit of [d => d.dietNote = '备注', d => d.body.weight = 60, d => d.body.waist = 70, d => d.workouts.push(workoutEntry(exercise())), d => d.mealNotes.lunch = '午餐备注']) {
    const day = emptyDay(); edit(day); assert.equal(Boolean(hasRecord(day)), true);
  }
});


test('分钟动作在动作库和每日训练备份中往返保留，旧单位兼容', () => {
  for (const unit of ['个', '秒', '分钟']) {
    const state = emptyState();
    const action = { ...exercise(), unit, reps: 10 };
    state.exercises.push(action);
    state.days['2026-10-20'] = emptyDay();
    state.days['2026-10-20'].workouts.push(workoutEntry(action));
    const result = validateBackup(JSON.parse(JSON.stringify(state)));
    assert.equal(result.exercises[0].unit, unit);
    assert.equal(result.days['2026-10-20'].workouts[0].exercise.unit, unit);
  }
});
