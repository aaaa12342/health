import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, emptyDay, foodEntry, workoutEntry, validDate, dateKey, shiftDate, series, validateBackup, hasRecord } from '../domain.js';

const food = () => ({ id: 'food-1', name: '测试燕麦', unit: '克' });
const exercise = () => ({ id: 'exercise-1', name: '深蹲', sets: 3, reps: 12, unit: '个' });
test('记录保存快照，修改模板不会改动历史', () => {
  const f = food(), e = exercise(), meal = foodEntry(f, 150), workout = workoutEntry(e);
  f.unit = '份'; f.name = '新名称'; e.sets = 99;
  assert.equal(meal.food.name, '测试燕麦'); assert.equal(meal.food.unit, '克');
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
  assert.equal(restored.unexpected, undefined); assert.equal(restored.days['2026-10-19'].meals.breakfast[0].quantity, 150);
});
test('恶意或损坏备份不通过校验', () => {
  assert.throws(() => validateBackup({ version: 2 }));
  const badNumber = emptyState(); const f = food(); badNumber.days['2026-10-19'] = emptyDay(); badNumber.days['2026-10-19'].meals.lunch.push(foodEntry(f, 0)); assert.throws(() => validateBackup(badNumber));
  const badDate = emptyState(); badDate.days['2026-02-30'] = emptyDay(); assert.throws(() => validateBackup(badDate));
  const duplicate = emptyState(); duplicate.foods.push(food(), food()); assert.throws(() => validateBackup(duplicate));
  const badBody = emptyState(); badBody.days['2026-10-19'] = emptyDay(); badBody.days['2026-10-19'].body.weight = -1; assert.throws(() => validateBackup(badBody));
  const badSet = emptyState(); badSet.exercises.push({ ...exercise(), sets: 1.5 }); assert.throws(() => validateBackup(badSet));
  const proto = JSON.parse('{"version":1,"foods":[],"exercises":[],"days":{"__proto__":{}}}'); assert.throws(() => validateBackup(proto));
  const infinity = emptyState(); infinity.days['2026-10-19'] = emptyDay(); infinity.days['2026-10-19'].meals.lunch.push(foodEntry(food(), Infinity)); assert.throws(() => validateBackup(infinity));
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

test('旧版备份保留食物单位、食用数量和身体数据，忽略已移除字段', () => {
  const old = emptyState(), legacyFood = { ...food(), baseQuantity: 100, nutrients: { protein: 12 } };
  old.targets = { protein: 80 };
  old.foods.push(legacyFood);
  old.days['2026-10-19'] = emptyDay();
  old.days['2026-10-19'].meals.breakfast.push(foodEntry(legacyFood, 150));
  old.days['2026-10-19'].body.weight = 65;
  const result = validateBackup(old);
  assert.deepEqual(result.foods, [food()]);
  assert.deepEqual(result.days['2026-10-19'].meals.breakfast[0].food, food());
  assert.equal(result.days['2026-10-19'].meals.breakfast[0].quantity, 150);
  assert.equal(result.days['2026-10-19'].body.weight, 65);
  assert.ok(!Object.hasOwn(result, 'targets'));
});
