import { STORAGE_KEY, RECOVERY_KEY, NUTRIENTS, EXERCISE_UNITS, MEALS, BODY, emptyState, emptyDay, uid, dateKey, validDate, shiftDate, dayOf, scaleNutrients, totals, nutrientComparison, foodEntry, workoutEntry, series, hasRecord, validateBackup } from './domain.js?v=20261020-1';

const icons = {
  food: '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M16 3v8h4M20 3v18"/>',
  exercise: '<path d="m6 5-3 3m5-5-5 5m13 13 5-5M5 9l10 10M9 5l10 10M15 5l4 4M5 15l4 4m10-3 2 2M3 6l3-3"/>',
  overview: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  moon: '<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"/>',
  cup: '<path d="M4 8h13v8a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5ZM17 9h2a3 3 0 0 1 0 6h-2M8 2v3m5-3v3"/>',
  scale: '<rect x="4" y="3" width="16" height="18" rx="4"/><path d="M8 8a5 5 0 0 1 8 0m-4 3 2-4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  chart: '<path d="M3 3v18h18M6 15l4-5 5 3 5-7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.plus}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (value, decimals = 1) => value == null ? '—' : Number(value.toFixed(decimals)).toLocaleString('zh-CN', { maximumFractionDigits: decimals });
const main = document.querySelector('main');
const modal = document.querySelector('#modal');
let state = emptyState(), startupError = '', selectedDate = dateKey(), month = selectedDate.slice(0, 7), range = 7, circumference = 'waist';
let modalContext = null, pendingImport = null, toastTimer;
const pages = { diet: '饮食', exercise: '锻炼', overview: '总览' };
let page = 'overview';

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) state = validateBackup(JSON.parse(saved));
} catch {
  startupError = '本机记录读取失败。原始数据仍被保留，请先到「备份与恢复」导出原始数据，再恢复有效备份。';
}

function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}
function status(message, error = false) {
  const el = document.querySelector('#save-status');
  el.classList.toggle('error', error); el.innerHTML = `<i></i>${esc(message)}`;
}
function commit(change, message = '已保存') {
  if (startupError) { toast('请先导出原始数据并恢复有效备份，避免覆盖已有记录。'); return false; }
  try {
    const next = structuredClone(state); change(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    state = next; status('已在本机保存');
    if (message) toast(message);
    return true;
  } catch { status('保存失败', true); toast('保存失败：浏览器存储可能已满或被禁用。请先导出备份。'); return false; }
}
function changeDay(change, message) {
  return commit(next => { next.days[selectedDate] ??= emptyDay(); change(next.days[selectedDate]); }, message);
}
function empty(title, text, action = '', button = '', type = 'food') {
  return `<div class="empty"><span class="empty-icon">${icon(type)}</span><strong>${title}</strong><p>${text}</p>${action ? `<button data-action="${action}">${icon('plus')}${button}</button>` : ''}</div>`;
}
function dateControls() {
  return `<div class="date-control" aria-label="查看记录日期"><button class="icon-button" data-action="prev-day" aria-label="前一天">${icon('left')}</button><input type="date" aria-label="记录日期" id="record-date" min="1900-01-01" max="2200-12-31" value="${selectedDate}"><button class="icon-button" data-action="next-day" aria-label="后一天">${icon('right')}</button><button class="today" data-action="today">今天</button></div>`;
}
function heading(title, subtitle) {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${dateControls()}</div>`;
}
function targetComparison(day) {
  const t = totals(day), configured = Object.keys(NUTRIENTS).some(k => state.targets[k] != null);
  return `<div class="target-comparison"><div class="target-heading"><strong>每日营养标准</strong><button type="button" data-action="targets">${icon('edit')}${configured ? '修改标准' : '设置标准'}</button></div>${configured ? `<div class="target-grid">${Object.entries(NUTRIENTS).map(([key, [label, unit]]) => {
    const target = state.targets[key], comparison = nutrientComparison(t[key].value, target);
    if (!comparison) return `<div class="target-item"><div class="target-label">${label}</div><p class="target-unset">未设置标准</p></div>`;
    const { difference, percentage } = comparison;
    return `<div class="target-item${difference > 0 ? ' above' : ''}" data-target="${key}"><div class="target-label"><span>${label}${t[key].missing ? '（已知）' : ''}</span><span>${percentage == null ? '标准为 0' : `${fmt(percentage, 0)}%`}</span></div><div class="target-values">${fmt(t[key].value)} / ${fmt(target)} ${unit}</div><div class="target-track" aria-hidden="true"><span style="width:${percentage == null ? (difference > 0 ? 100 : 0) : Math.min(100, Math.max(0, percentage))}%"></span></div><div class="target-difference">${difference === 0 ? '与标准相同' : `${difference > 0 ? '高于' : '低于'}标准 ${fmt(Math.abs(difference))} ${unit}`}</div></div>`;
  }).join('')}</div><p class="target-caption">按已记录摄入对比；标准由你自行设定，适用于所有日期。${Object.values(t).some(n => n.missing) ? '存在未填写的营养值，比较结果可能不完整。' : ''}</p>` : '<p class="target-caption">自行填写每天的能量和营养标准，即可查看摄入比例及差额。未设置的项目不作比较。</p>'}</div>`;
}
function nutritionPanel(day) {
  const t = totals(day), count = t.energy.count;
  return `<section class="panel nutrition-panel"><div class="section-head"><h2>今日营养摄入</h2><span class="meta">${count} 条饮食记录</span></div><div class="nutrition-content"><div><div class="energy-number">${fmt(t.energy.value, 0)}<small>kJ</small></div><p class="energy-caption">摄入能量 · 约 ${fmt(t.energy.value / 4.184, 0)} kcal</p></div><div class="macro-grid">${['protein', 'fat', 'carbs'].map(k => `<div class="macro-item"><div class="macro-label"><span class="dot ${k}"></span>${NUTRIENTS[k][0]}</div><div class="macro-value">${fmt(t[k].value)}<small>g</small></div></div>`).join('')}</div></div><div class="nutrition-foot"><span>膳食纤维 ${fmt(t.fiber.value)} g　 ·　 钠 ${fmt(t.sodium.value, 0)} mg</span><span>按实际食用份量计算</span></div>${Object.values(t).some(n => n.missing) ? '<div class="warning">部分食物未填写完整营养；以上仅合计已填写的数值。</div>' : ''}${targetComparison(day)}</section>`;
}
function bodyPanel(day) {
  return `<section class="panel body-panel"><div class="section-head"><h2>${icon('scale')}身体记录</h2></div><div class="body-section-heading"><span>体重</span><button data-action="weight" aria-label="记录体重">${icon('edit')}记录体重</button></div><div class="body-weight">${fmt(day.body.weight)}<small>kg</small></div>${day.body.weight == null ? '<p class="body-empty">留下今天的体重，慢慢积累变化。</p>' : '<p class="body-empty">所选日期的体重</p>'}<div class="body-section-heading circumference-heading"><span>身体围度</span><button data-action="circumference" aria-label="记录围度">${icon('edit')}记录围度</button></div><div class="body-data">${Object.entries(BODY).filter(([k]) => k !== 'weight').map(([k, [label, unit]]) => `<div><span>${label}</span><strong>${fmt(day.body[k])}<small>${unit}</small></strong></div>`).join('')}</div></section>`;
}
function calendar() {
  const first = new Date(`${month}-01T12:00:00`), count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const padding = (first.getDay() + 6) % 7;
  return `<section class="panel calendar-panel"><div class="section-head"><h2>${icon('calendar')}记录日历</h2></div><div class="calendar-header"><button class="icon-button" data-action="prev-month" aria-label="上个月">${icon('left')}</button><strong>${first.getFullYear()} 年 ${first.getMonth() + 1} 月</strong><button class="icon-button" data-action="next-month" aria-label="下个月">${icon('right')}</button></div><div class="calendar-grid">${['一', '二', '三', '四', '五', '六', '日'].map(d => `<span class="weekday">${d}</span>`).join('')}${'<span></span>'.repeat(padding)}${Array.from({ length: count }, (_, i) => {
    const key = `${month}-${String(i + 1).padStart(2, '0')}`, recorded = state.days[key] && hasRecord(state.days[key]);
    return `<button class="calendar-day${key === selectedDate ? ' selected' : ''}${key === dateKey() ? ' today' : ''}${recorded ? ' recorded' : ''}" data-action="select-date" data-date="${key}" aria-label="${key}${recorded ? '，有记录' : ''}" aria-pressed="${key === selectedDate}">${i + 1}</button>`;
  }).join('')}</div><div class="calendar-legend"><span><i class="dot"></i>有记录的日子</span><span>点击日期查看</span></div></section>`;
}
function chart(field) {
  const points = series(state, selectedDate, range, field), actual = points.filter(p => p.value != null), [label, unit] = BODY[field];
  if (!actual.length) return `${empty('还没有这段时间的记录', `记录${label}后，这里会显示近 ${range} 天的变化。`, field === 'weight' ? 'weight' : 'circumference', field === 'weight' ? '记录体重' : '记录围度', 'chart')}`;
  const minValue = Math.min(...actual.map(p => p.value)), maxValue = Math.max(...actual.map(p => p.value));
  const margin = Math.max((maxValue - minValue) * .2, field === 'weight' ? .5 : 1), low = Math.max(0, minValue - margin), high = maxValue + margin;
  const x = i => 42 + i * 518 / (range - 1), y = v => 136 - (v - low) / (high - low) * 112;
  let path = '', open = false;
  points.forEach((p, i) => { if (p.value == null) { open = false; return; } path += `${open ? ' L' : ' M'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`; open = true; });
  const labels = [0, Math.floor((range - 1) / 2), range - 1];
  return `<div class="chart-wrap"><svg viewBox="0 0 580 170" role="img" aria-label="${label}近${range}天趋势，${actual.length}天有记录。下方可查看具体数据。">${[0, 1, 2].map(i => { const v = low + (high - low) * i / 2; return `<line x1="42" y1="${y(v)}" x2="560" y2="${y(v)}" stroke="#e7ece7" stroke-dasharray="3 5"/><text x="32" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`; }).join('')}<path d="${path}" fill="none" stroke="#3e7253" stroke-width="2.5"/>${points.map((p, i) => p.value == null ? '' : `<circle class="chart-point" cx="${x(i)}" cy="${y(p.value)}" r="4"><title>${p.date}：${fmt(p.value)} ${unit}</title></circle>`).join('')}${labels.map(i => `<text x="${x(i)}" y="160" text-anchor="middle">${points[i].date.slice(5).replace('-', '/')}</text>`).join('')}</svg></div><div class="chart-caption">已记录 ${actual.length} 天 · 缺失日期留空${actual.length > 1 ? ` · 首末变化 ${actual.at(-1).value - actual[0].value > 0 ? '+' : ''}${fmt(actual.at(-1).value - actual[0].value)} ${unit}` : ''}</div><details><summary>查看具体数据</summary><table><thead><tr><th>日期</th><th>${label}（${unit}）</th></tr></thead><tbody>${points.map(p => `<tr><td>${p.date}</td><td>${fmt(p.value)}</td></tr>`).join('')}</tbody></table></details>`;
}
function overview(day) {
  const workouts = day.workouts, knownDuration = workouts.reduce((sum, w) => sum + (w.duration || 0), 0);
  return `${heading('每一天，都值得记录', `${new Date(`${selectedDate}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}，看看这一天的饮食、运动与身体变化。`)}<div class="overview-layout"><div class="main-column">${nutritionPanel(day)}<div class="summary-grid"><section class="panel"><div class="section-head"><h2>三餐与加餐</h2><button class="text-button" data-action="go-diet">去记录${icon('right')}</button></div><div class="summary-list">${Object.entries(MEALS).map(([k, label]) => `<div class="summary-row"><span class="meal-tag">${label}</span><div class="summary-row-content"><strong>${day.meals[k].length ? day.meals[k].map(i => `${esc(i.food.name)} ${fmt(i.quantity)}${esc(i.food.unit)}`).join('、') : '还未记录'}</strong>${day.mealNotes[k] ? `<p class="preserve-text">${esc(day.mealNotes[k])}</p>` : ''}</div></div>`).join('')}</div>${day.dietNote ? `<div class="inline-note preserve-text">饮食备注：${esc(day.dietNote)}</div>` : ''}</section><section class="panel"><div class="section-head"><h2>今日锻炼</h2><button class="text-button" data-action="go-exercise">去记录${icon('right')}</button></div><div class="mini-stat"><span class="label">已记录训练时长</span><strong>${fmt(knownDuration)}<small>分钟 / ${workouts.length} 个动作</small></strong></div>${workouts.length ? `<div class="summary-list">${workouts.map(w => `<div class="summary-row"><span class="meal-tag">${icon('exercise')}</span><div class="summary-row-content"><strong>${esc(w.exercise.name)}</strong><p>${w.exercise.sets} 组 × ${fmt(w.exercise.reps)} ${w.exercise.unit}${w.duration == null ? ' · 未填时长' : ` · ${fmt(w.duration)} 分钟`}</p>${w.feeling ? `<p class="preserve-text">${esc(w.feeling)}</p>` : ''}</div></div>`).join('')}</div>` : empty('给身体一点活动时间', '散步、力量训练、拉伸，都可以记在这里。', 'go-exercise', '记录锻炼', 'exercise')}${day.workoutNote ? `<div class="inline-note preserve-text">锻炼感受：${esc(day.workoutNote)}</div>` : ''}</section></div><section class="panel"><div class="trend-head"><h2>身体变化趋势</h2><div class="segmented" aria-label="趋势时间范围">${[7, 30].map(n => `<button class="${range === n ? 'active' : ''}" data-action="range" data-value="${n}" aria-pressed="${range === n}">近 ${n} 天</button>`).join('')}</div></div><div class="chart-block"><div class="chart-head"><strong>体重 <span class="muted">/ kg</span></strong><span class="small muted">截至 ${selectedDate.slice(5).replace('-', '/')}</span></div>${chart('weight')}</div><div class="chart-block"><div class="chart-head"><strong>身体围度 <span class="muted">/ cm</span></strong><select id="circumference" aria-label="选择围度指标">${Object.entries(BODY).filter(([k]) => k !== 'weight').map(([k, [label]]) => `<option value="${k}" ${circumference === k ? 'selected' : ''}>${label}</option>`).join('')}</select></div>${chart(circumference)}</div></section></div><div class="side-column">${calendar()}${bodyPanel(day)}<div class="gentle-note"><strong>不用完美，只需真实。</strong>每天多留下一点记录，了解自己吃了什么、怎样运动，以及身体的变化。</div></div></div>`;
}
function nutrientStrip(day) {
  const t = totals(day);
  return `<section class="day-nutrition"><div class="day-summary-strip"><span class="strip-title">今日摄入</span><div class="strip-nutrients">${['energy', 'protein', 'fat', 'carbs'].map(k => `<div><span class="strip-label">${NUTRIENTS[k][0]}${t[k].missing ? '（已知）' : ''}</span><b>${fmt(t[k].value, k === 'energy' ? 0 : 1)}<small>${NUTRIENTS[k][1]}</small></b></div>`).join('')}</div></div>${targetComparison(day)}</section>`;
}
function library(type) {
  const food = type === 'food', items = food ? state.foods : state.exercises;
  return `<section class="panel library-panel"><div class="section-head"><h2>${food ? '我的食物库' : '我的动作库'}</h2><span class="meta">${items.length} 项</span></div><p class="library-intro">${food ? '把常吃的食物存下来，下次选择就好。营养值对应你填写的基准份量。' : '保存常用动作和组数，安排训练时直接调用；当天仍可单独调整。'}</p><button class="full-width" data-action="new-${type}">${icon('plus')}自定义${food ? '食物' : '动作'}</button>${items.length ? `<input id="${type}-library-search" type="search" placeholder="搜索${food ? '食物' : '动作'}库" aria-label="搜索${food ? '食物' : '动作'}库" style="margin:16px 0 4px"><div id="${type}-library-list">${libraryItems(type, items)}</div>` : `<div class="empty"><p>还没有自定义${food ? '食物' : '动作'}。<br>从你最常用的一项开始。</p></div>`}</section>`;
}
function libraryItems(type, items) {
  return items.map(i => `<div class="library-item"><div class="library-title"><strong>${esc(i.name)}</strong><small>${type === 'food' ? `每 ${fmt(i.baseQuantity)} ${esc(i.unit)} · ${i.nutrients.energy == null ? '能量待补充' : `${fmt(i.nutrients.energy, 0)} kJ`}` : `${i.sets} 组 × ${fmt(i.reps)} ${i.unit}`}</small></div><button class="icon-button" data-action="edit-${type}" data-id="${esc(i.id)}" aria-label="编辑${esc(i.name)}">${icon('edit')}</button><button class="icon-button" data-action="delete-${type}" data-id="${esc(i.id)}" aria-label="删除${esc(i.name)}">${icon('trash')}</button></div>`).join('') || '<p class="small muted">没有找到匹配内容。</p>';
}
function diet(day) {
  const mealIcons = { breakfast: 'sun', lunch: 'food', dinner: 'moon', snack: 'cup' };
  return `${heading('好好吃饭，从这一餐开始', '记录吃下的每一份食物，也留一点空间给用餐时的心情。')}${nutrientStrip(day)}<div class="diet-layout"><div>${Object.entries(MEALS).map(([k, label]) => `<section class="panel meal-panel"><div class="section-head"><div class="meal-heading"><span class="meal-icon">${icon(mealIcons[k])}</span><div><h2>${label}</h2><p>${day.meals[k].length} 项食物</p></div></div><div class="section-actions"><button class="text-button" data-action="oneoff-food" data-meal="${k}">临时添加</button><button data-action="pick-food" data-meal="${k}">${icon('plus')}从食物库选择</button></div></div>${day.meals[k].length ? day.meals[k].map(i => {
    const n = scaleNutrients(i.food, i.quantity);
    return `<div class="record-row"><div class="record-name"><strong>${esc(i.food.name)}</strong><p>${n.energy == null ? '能量未填写' : `${fmt(n.energy, 0)} kJ`} · 蛋白质 ${fmt(n.protein)} g · 脂肪 ${fmt(n.fat)} g · 碳水 ${fmt(n.carbs)} g</p></div><span class="quantity">${fmt(i.quantity)} ${esc(i.food.unit)}</span><div class="row-buttons"><button class="icon-button" data-action="edit-food-entry" data-meal="${k}" data-id="${esc(i.id)}" aria-label="编辑${esc(i.food.name)}的记录">${icon('edit')}</button><button class="icon-button" data-action="delete-food-entry" data-meal="${k}" data-id="${esc(i.id)}" aria-label="删除${esc(i.food.name)}的记录">${icon('trash')}</button></div></div>`;
  }).join('') : '<div class="empty"><p>这一餐吃了什么？从食物库选择，或临时添加。</p></div>'}<div class="meal-note"><label for="note-${k}">${label}备注</label><textarea id="note-${k}" maxlength="5000" rows="2" data-note="${k}" placeholder="比如：用餐时间、做法，或今天的胃口……">${esc(day.mealNotes[k])}</textarea></div></section>`).join('')}<section class="panel note-panel"><div class="section-head"><h2>饮食备注</h2><span class="meta">离开输入框后自动保存</span></div><textarea maxlength="5000" data-note="dietNote" aria-label="当日饮食备注" placeholder="还有什么想记下的？饮水、饱腹感、今天的小发现……">${esc(day.dietNote)}</textarea></section></div><div class="side-column">${library('food')}<div class="gentle-note"><strong>份量清楚，记录更准确。</strong>例如：填写 100 克的营养含量，实际吃 150 克时，系统会按 1.5 倍计算。杯、碗等单位以你定义的一份为准。</div></div></div>`;
}
function exercisePage(day) {
  return `${heading('动一动，找回自己的节奏', '记录每一次认真活动的身体，强度与感受一样重要。')}<div class="exercise-layout"><div><section class="panel"><div class="section-head"><h2>${icon('exercise')}今日训练<span class="meta">${day.workouts.length} 个动作</span></h2><div class="section-actions"><button class="text-button" data-action="oneoff-exercise">临时添加</button><button class="primary" data-action="pick-exercise">${icon('plus')}选择动作</button></div></div>${day.workouts.length ? day.workouts.map(w => `<article class="workout-row"><div class="workout-top"><div class="record-name"><strong>${esc(w.exercise.name)}</strong></div><button class="icon-button" data-action="edit-workout" data-id="${esc(w.id)}" aria-label="编辑${esc(w.exercise.name)}的训练">${icon('edit')}</button><button class="icon-button" data-action="delete-workout" data-id="${esc(w.id)}" aria-label="删除${esc(w.exercise.name)}的训练">${icon('trash')}</button></div><div class="workout-stats"><span><b>${w.exercise.sets}</b>组</span><span>每组 <b>${fmt(w.exercise.reps)}</b>${w.exercise.unit}</span><span><b>${fmt(w.duration)}</b>分钟</span></div>${w.feeling ? `<p class="workout-feeling">${esc(w.feeling)}</p>` : '<p class="workout-feeling">还没填写感受，点击编辑补充。</p>'}</article>`).join('') : empty('今天，想怎样动一动？', '从动作库多选训练内容，或临时添加一个新动作。', 'pick-exercise', '选择今天的动作', 'exercise')}</section><section class="panel note-panel"><div class="section-head"><h2>锻炼感受</h2><span class="meta">离开输入框后自动保存</span></div><textarea data-note="workoutNote" maxlength="5000" aria-label="当日锻炼感受" placeholder="今天的状态如何？哪里有进步，哪里需要休息……">${esc(day.workoutNote)}</textarea></section></div><div class="side-column"><section class="panel"><div class="section-head"><h2>${icon('scale')}当日体重</h2></div><form id="weight-form"><div class="daily-weight"><label class="field">体重 / kg<input type="number" name="weight" min="0.01" max="1000" step="0.01" value="${day.body.weight ?? ''}" placeholder="尚未记录"></label><button class="primary" type="submit">保存</button></div></form><p class="small muted" style="line-height:1.8;margin-bottom:0">与总览中的体重记录同步。留空保存可清除当天体重。</p></section>${library('exercise')}</div></div>`;
}
function render() {
  document.querySelectorAll('[data-nav]').forEach(a => { a.classList.toggle('active', a.dataset.nav === page); a.setAttribute('aria-current', a.dataset.nav === page ? 'page' : 'false'); });
  document.querySelector('#page-label').textContent = pages[page];
  document.title = `${pages[page]} · 日常 Health`;
  const day = dayOf(state, selectedDate);
  main.innerHTML = `${startupError ? `<div class="form-error" role="alert">${esc(startupError)} <button data-action="backup">备份与恢复</button></div>` : ''}${page === 'diet' ? diet(day) : page === 'exercise' ? exercisePage(day) : overview(day)}`;
  if (startupError) status('本机记录读取失败', true);
}
function switchDate(date) {
  if (!validDate(date)) { toast('请选择 1900 至 2200 年间的有效日期。'); return; }
  selectedDate = date; month = date.slice(0, 7); render();
}
function navigate() { page = pages[location.hash.slice(1)] ? location.hash.slice(1) : 'overview'; render(); }
function openModal(title, description, body, actions = '<button type="button" data-action="close">取消</button><button class="primary" type="submit">保存</button>', formId = 'modal-form') {
  modal.innerHTML = `<form id="${formId}"><div class="modal-head"><div><h2 id="modal-title">${title}</h2><p>${description}</p></div><button type="button" class="icon-button" data-action="close" aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><div class="form-error" id="form-error" role="alert"></div>${body}</div><div class="modal-actions">${actions}</div></form>`;
  if (!modal.open) modal.showModal();
}
function field(label, name, value = '', options = '') {
  return `<label class="field">${label}<input name="${name}" value="${esc(value)}" ${options}></label>`;
}
function foodForm(mode, item = null, meal = null) {
  modalContext = { type: 'food', mode, item, meal };
  const f = mode === 'entry' ? item.food : item;
  openModal(mode === 'entry' ? '编辑这条饮食记录' : mode === 'oneoff' ? '临时添加食物' : item ? '编辑自定义食物' : '添加自定义食物', mode === 'entry' ? '修改只影响这一条记录，不会改变食物库。' : '先定义一份食物的数量，再填写这一份对应的营养含量。', `<div class="form-grid">${field('食物名称', 'name', f?.name, 'required maxlength="100" placeholder="例如：燕麦、牛奶" class=""')}${field('基准数量', 'baseQuantity', f?.baseQuantity ?? 100, 'type="number" required min="0.001" max="1000000000" step="any"')}<label class="field">数量单位<input name="unit" value="${esc(f?.unit || '克')}" required maxlength="20" list="food-units"><datalist id="food-units">${['个', '杯', '碗', '条', '勺', '克', '毫升', '片', '份', '袋', '瓶'].map(u => `<option value="${u}"></option>`).join('')}</datalist></label>${mode === 'entry' || mode === 'oneoff' ? field('实际食用数量（同单位）', 'quantity', item?.quantity ?? f?.baseQuantity ?? 100, 'type="number" required min="0.001" max="1000000000" step="any"') : ''}</div><div class="form-divider"><strong>每基准份量的营养</strong><p>例如基准为 100 克，下面填写每 100 克的营养。能量单位为 kJ；若标签为 kcal，请乘以 4.184。未知可留空，0 代表明确为零。</p></div><div class="form-grid">${Object.entries(NUTRIENTS).map(([k, [label, unit]]) => field(`${label} / ${unit}`, k, f?.nutrients[k] ?? '', 'type="number" min="0" max="1000000000" step="any" placeholder="未填写"')).join('')}</div>${mode === 'oneoff' ? '<label class="check-label"><input type="checkbox" name="saveLibrary">同时保存到我的食物库</label>' : ''}`);
}
function exerciseForm(mode, item = null) {
  modalContext = { type: 'exercise', mode, item };
  const e = mode === 'entry' ? item.exercise : item;
  openModal(mode === 'entry' ? '编辑今天的训练' : mode === 'oneoff' ? '临时添加动作' : item ? '编辑自定义动作' : '添加自定义动作', mode === 'entry' ? '调整这次训练的数量、时长与感受，不会改变动作库。' : '设置常用组数和每组数量，记录当天锻炼时还可以调整。', `<div class="form-grid"><div class="span-2">${field('动作名称', 'name', e?.name, 'required maxlength="100" placeholder="例如：深蹲、平板支撑"')}</div>${field('组数', 'sets', e?.sets ?? 3, 'type="number" required min="1" max="1000000" step="1"')}${field('每组数量', 'reps', e?.reps ?? 12, 'type="number" required min="0.001" max="1000000" step="any"')}<label class="field">每组单位<select name="unit">${EXERCISE_UNITS.map(unit => `<option value="${unit}" ${(e?.unit || '个') === unit ? 'selected' : ''}>${unit}</option>`).join('')}</select></label>${['oneoff', 'entry'].includes(mode) ? `${field('本动作训练时长 / 分钟（可选）', 'duration', item?.duration ?? '', 'type="number" min="0" max="1440" step="any" placeholder="未填写"')}<label class="field span-2">这次训练的感受<textarea name="feeling" maxlength="5000" placeholder="例如：最后一组有点吃力，注意呼吸。">${esc(item?.feeling)}</textarea></label>` : ''}</div>${mode === 'oneoff' ? '<label class="check-label"><input type="checkbox" name="saveLibrary">同时保存到我的动作库</label>' : ''}`);
}
function openPicker(type, meal) {
  modalContext = { type: 'picker', kind: type, meal };
  const food = type === 'food', items = food ? state.foods : state.exercises;
  openModal(food ? `选择${MEALS[meal]}食物` : '选择今天的训练动作', food ? '支持多选，并填写每一项实际吃下的数量。单位与食物库一致。' : '支持多选。添加后点击动作旁的编辑按钮，补充时长、感受或调整组数。', `${items.length ? `<input type="search" id="picker-search" aria-label="搜索${food ? '食物' : '动作'}" placeholder="搜索${food ? '食物' : '动作'}名称"><div class="picker-list">${items.map(i => `<div class="picker-item" data-name="${esc(i.name.toLocaleLowerCase())}"><label><input type="checkbox" name="selected" value="${esc(i.id)}"><span class="picker-name"><strong>${esc(i.name)}</strong><small>${food ? `基准 ${fmt(i.baseQuantity)} ${esc(i.unit)}${i.nutrients.energy == null ? '' : ` · ${fmt(i.nutrients.energy, 0)} kJ`}` : `${i.sets} 组 × ${fmt(i.reps)} ${i.unit}`}</small></span></label>${food ? `<input class="picker-qty" type="number" min="0.001" max="1000000000" step="any" data-qty="${esc(i.id)}" value="${i.baseQuantity}" aria-label="${esc(i.name)}实际食用数量"><span class="picker-unit">${esc(i.unit)}</span>` : ''}</div>`).join('')}</div><p class="small muted" id="picker-count">已选 0 项</p>` : empty(`先添加一个${food ? '食物' : '动作'}`, `你的${food ? '食物' : '动作'}库还是空的，添加后就能在这里多选。`, '', '', type === 'food' ? 'food' : 'exercise')}`, `<button type="button" data-action="picker-new">${icon('plus')}新建${food ? '食物' : '动作'}</button><button type="button" data-action="close">取消</button><button class="primary" type="submit" ${items.length ? '' : 'disabled'}>添加所选</button>`);
}
function openBody(kind) {
  const fields = Object.keys(BODY).filter(key => kind === 'weight' ? key === 'weight' : key !== 'weight');
  modalContext = { type: 'body', fields };
  const body = dayOf(state, selectedDate).body;
  openModal(kind === 'weight' ? '记录体重' : '记录身体围度', `${selectedDate} · 按相近时间和相同方式测量，更便于观察变化。留空可清除该项。`, `<div class="form-grid">${fields.map(k => { const [label, unit] = BODY[k]; return field(`${label} / ${unit}`, k, body[k] ?? '', `type="number" min="0.01" max="${k === 'weight' ? 1000 : 10000}" step="0.01" placeholder="未记录"`); }).join('')}</div>`);
}
function openTargets() {
  modalContext = { type: 'targets' };
  openModal('每日营养摄入标准', '填写你自己的每日标准，适用于所有日期。留空则不比较该项，填写 0 表示标准为零。', `<div class="form-grid">${Object.entries(NUTRIENTS).map(([key, [label, unit]]) => field(`${label}标准 / ${unit}`, key, state.targets[key] ?? '', 'type="number" min="0" max="1000000000" step="any" placeholder="未设置"')).join('')}</div><p class="small muted" style="line-height:1.9;margin-bottom:0">能量使用 kJ。若你的标准以 kcal 表示，请乘以 4.184 后填写。标准会随备份一同导出。</p>`);
}
function downloadData(data, name) {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function backupDialog() {
  modalContext = { type: 'backup' };
  const count = Object.values(state.days).filter(hasRecord).length;
  let recovery = false; try { recovery = Boolean(localStorage.getItem(RECOVERY_KEY)); } catch { /* storage error displayed elsewhere */ }
  openModal('备份与恢复', '记录只保存在当前浏览器，不会上传到 GitHub，也不会自动同步到其他设备。', `<div class="backup-options"><div class="backup-option"><h3>导出完整备份</h3><p>包含 ${count} 天记录、${state.foods.length} 项食物、${state.exercises.length} 个动作。清理浏览器、更换设备前请先导出。</p><button data-action="export" type="button">${icon('download')}导出 JSON 备份</button>${startupError ? '<button data-action="export-raw" type="button">导出未解析的原始数据</button>' : ''}</div><div class="backup-option"><h3>从文件恢复</h3><p>选择此前导出的 JSON 文件。校验通过后会显示摘要，确认才会替换本机记录。恢复前会保留一份本机副本。</p><input class="file-input" id="import-file" type="file" accept=".json,application/json" aria-label="选择备份 JSON 文件"></div>${recovery ? '<div class="backup-option"><h3>恢复导入前的记录</h3><p>本机保留了上次导入前的副本，可撤销最近一次导入。</p><button data-action="recover" type="button">查看恢复副本</button></div>' : ''}<p class="small muted" style="line-height:1.9;margin:0">无痕模式关闭、浏览器数据清理或更换网址，都可能让本机记录不可用。备份文件含个人数据，请自行妥善保存。</p></div>`, '<button type="button" data-action="close">完成</button>');
}
function previewImport(data, recovery = false) {
  pendingImport = data;
  modalContext = { type: 'import', recovery };
  const dates = Object.entries(data.days).filter(([, day]) => hasRecord(day)).map(([date]) => date).sort();
  openModal(recovery ? '恢复导入前的记录' : '确认恢复备份', '此操作会替换当前浏览器中的全部记录和自定义库。', `<div class="backup-option"><h3>即将恢复的内容</h3><p>${dates.length} 天记录 · ${data.foods.length} 项食物 · ${data.exercises.length} 个动作</p><p>${dates.length ? `${dates[0]} 至 ${dates.at(-1)}` : '备份中没有每日记录'}</p></div><p class="small muted" style="line-height:1.9">建议先导出当前记录。替换时会自动保留当前数据作为下一次可恢复的副本。</p>`, '<button type="button" data-action="backup">返回备份</button><button type="submit" class="primary">确认替换并恢复</button>');
}
function deleteDialog(type, id, meal) {
  modalContext = { type: 'delete', kind: type, id, meal };
  const libraryDelete = type === 'food' || type === 'exercise';
  openModal('确认删除', libraryDelete ? '只从自定义库删除，过去的饮食或锻炼记录会保留。' : `只删除 ${selectedDate} 的这一条记录。`, '<p class="small muted">删除后可通过此前导出的备份恢复。</p>', '<button type="button" data-action="close">取消</button><button class="danger" type="submit">确认删除</button>');
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id, meal, value, date } = button.dataset;
  if (action === 'close') { modal.close(); return; }
  if (action === 'prev-day') switchDate(shiftDate(selectedDate, -1));
  else if (action === 'next-day') switchDate(shiftDate(selectedDate, 1));
  else if (action === 'today') switchDate(dateKey());
  else if (action === 'select-date') switchDate(date);
  else if (action === 'go-diet' || action === 'go-exercise') { if (page === action.slice(3)) render(); else location.hash = action.slice(3); }
  else if (action === 'range') { range = Number(value); render(); }
  else if (action === 'prev-month' || action === 'next-month') {
    const d = new Date(`${month}-01T12:00:00`); d.setMonth(d.getMonth() + (action === 'prev-month' ? -1 : 1));
    const key = dateKey(d); if (validDate(key)) { month = key.slice(0, 7); render(); }
  }
  else if (action === 'weight' || action === 'circumference') openBody(action);
  else if (action === 'targets') openTargets();
  else if (action === 'new-food') foodForm('library');
  else if (action === 'edit-food') foodForm('library', state.foods.find(f => f.id === id));
  else if (action === 'oneoff-food') foodForm('oneoff', null, meal);
  else if (action === 'edit-food-entry') foodForm('entry', dayOf(state, selectedDate).meals[meal].find(i => i.id === id), meal);
  else if (action === 'new-exercise') exerciseForm('library');
  else if (action === 'edit-exercise') exerciseForm('library', state.exercises.find(e => e.id === id));
  else if (action === 'oneoff-exercise') exerciseForm('oneoff');
  else if (action === 'edit-workout') exerciseForm('entry', dayOf(state, selectedDate).workouts.find(w => w.id === id));
  else if (action === 'pick-food') openPicker('food', meal);
  else if (action === 'pick-exercise') openPicker('exercise');
  else if (action === 'picker-new') {
    const ctx = modalContext;
    if (ctx.kind === 'food') foodForm('library', null, ctx.meal); else exerciseForm('library');
    modalContext.returnPicker = { type: ctx.kind, meal: ctx.meal };
  }
  else if (action.startsWith('delete-')) deleteDialog(action.slice(7), id, meal);
  else if (action === 'backup') backupDialog();
  else if (action === 'export') { downloadData({ ...state, exportedAt: new Date().toISOString() }, `日常-health-${dateKey()}.json`); toast('备份已导出'); }
  else if (action === 'export-raw') {
    try { downloadData(localStorage.getItem(STORAGE_KEY) || '{}', `日常-health-原始数据-${dateKey()}.json`); } catch { toast('浏览器存储不可读取。'); }
  }
  else if (action === 'recover') {
    try { previewImport(validateBackup(JSON.parse(localStorage.getItem(RECOVERY_KEY))), true); } catch (error) { toast(error.message); }
  }
});

document.addEventListener('input', event => {
  const el = event.target;
  if (el.id === 'picker-search') {
    const query = el.value.trim().toLocaleLowerCase();
    modal.querySelectorAll('.picker-item').forEach(row => { row.hidden = !row.dataset.name.includes(query); row.style.display = row.hidden ? 'none' : ''; });
  }
  if (el.id === 'food-library-search' || el.id === 'exercise-library-search') {
    const type = el.id.startsWith('food') ? 'food' : 'exercise', list = type === 'food' ? state.foods : state.exercises;
    document.querySelector(`#${type}-library-list`).innerHTML = libraryItems(type, list.filter(i => i.name.toLocaleLowerCase().includes(el.value.trim().toLocaleLowerCase())));
  }
  if (el.name === 'selected') {
    document.querySelector('#picker-count').textContent = `已选 ${modal.querySelectorAll('[name="selected"]:checked').length} 项`;
  }
});
document.addEventListener('change', async event => {
  const el = event.target;
  if (el.id === 'record-date') { if (el.value) switchDate(el.value); }
  else if (el.id === 'circumference') { circumference = el.value; render(); }
  else if (el.dataset.note) {
    const key = el.dataset.note;
    changeDay(day => { if (key in MEALS) day.mealNotes[key] = el.value; else day[key] = el.value; }, '备注已保存');
  }
  else if (el.id === 'import-file' && el.files[0]) {
    const file = el.files[0];
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请选择有效的 JSON 备份。');
      previewImport(validateBackup(JSON.parse(await file.text())));
    } catch (error) { modal.querySelector('#form-error').textContent = error instanceof SyntaxError ? '文件不是有效的 JSON，请选择从日常导出的备份。' : error.message; el.value = ''; }
  }
});
document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  if (!form.reportValidity()) return;
  if (form.id === 'weight-form') {
    const raw = new FormData(form).get('weight'), n = raw === '' ? null : Number(raw);
    if (changeDay(day => { day.body.weight = n; }, n == null ? '当日体重已清除' : '体重已保存')) render();
    return;
  }
  if (form.id !== 'modal-form' || !modalContext) return;
  const data = new FormData(form), ctx = modalContext;
  const num = k => data.get(k) === '' ? null : Number(data.get(k));
  const str = k => String(data.get(k) || '').trim();
  let ok = false;
  try {
    if (ctx.type === 'food') {
      if (!str('name') || !str('unit')) throw new Error('请填写食物名称和数量单位。');
      const food = { id: ctx.mode === 'entry' ? ctx.item.food.id : ctx.item?.id || uid(), name: str('name'), baseQuantity: num('baseQuantity'), unit: str('unit'), nutrients: Object.fromEntries(Object.keys(NUTRIENTS).map(k => [k, num(k)])) };
      if (ctx.mode === 'library') ok = commit(next => { const i = next.foods.findIndex(f => f.id === food.id); if (i === -1) next.foods.push(food); else next.foods[i] = food; }, '食物库已保存');
      else ok = commit(next => {
        next.days[selectedDate] ??= emptyDay();
        const items = next.days[selectedDate].meals[ctx.meal], entry = { id: ctx.item?.id || uid(), food, quantity: num('quantity') };
        if (ctx.mode === 'entry') items[items.findIndex(i => i.id === entry.id)] = entry; else items.push(entry);
        if (data.has('saveLibrary')) next.foods.push(structuredClone(food));
      }, '饮食记录已保存');
    }
    else if (ctx.type === 'exercise') {
      if (!str('name')) throw new Error('请填写动作名称。');
      const exercise = { id: ctx.mode === 'entry' ? ctx.item.exercise.id : ctx.item?.id || uid(), name: str('name'), sets: num('sets'), reps: num('reps'), unit: str('unit') };
      if (ctx.mode === 'library') ok = commit(next => { const i = next.exercises.findIndex(e => e.id === exercise.id); if (i === -1) next.exercises.push(exercise); else next.exercises[i] = exercise; }, '动作库已保存');
      else ok = commit(next => {
        next.days[selectedDate] ??= emptyDay();
        const items = next.days[selectedDate].workouts, entry = { id: ctx.item?.id || uid(), exercise, duration: num('duration'), feeling: str('feeling') };
        if (ctx.mode === 'entry') items[items.findIndex(i => i.id === entry.id)] = entry; else items.push(entry);
        if (data.has('saveLibrary')) next.exercises.push(structuredClone(exercise));
      }, '训练记录已保存');
    }
    else if (ctx.type === 'picker') {
      const ids = data.getAll('selected');
      if (!ids.length) throw new Error('请至少选择一项。');
      const quantities = new Map([...form.querySelectorAll('[data-qty]')].map(el => [el.dataset.qty, Number(el.value)]));
      if (ctx.kind === 'food' && ids.some(id => !Number.isFinite(quantities.get(id)) || quantities.get(id) <= 0)) throw new Error('请为所选食物填写大于 0 的实际数量。');
      ok = changeDay(day => {
        if (ctx.kind === 'food') for (const id of ids) day.meals[ctx.meal].push(foodEntry(state.foods.find(f => f.id === id), quantities.get(id)));
        else for (const id of ids) day.workouts.push(workoutEntry(state.exercises.find(e => e.id === id)));
      }, `已添加 ${ids.length} 项${ctx.kind === 'food' ? '食物' : '动作'}`);
    }
    else if (ctx.type === 'body') ok = changeDay(day => { for (const key of ctx.fields) day.body[key] = num(key); }, ctx.fields.includes('weight') ? '体重已保存' : '围度已保存');
    else if (ctx.type === 'targets') ok = commit(next => { next.targets = Object.fromEntries(Object.keys(NUTRIENTS).map(key => [key, num(key)])); }, '每日营养标准已保存');
    else if (ctx.type === 'delete') ok = commit(next => {
      if (ctx.kind === 'food') next.foods = next.foods.filter(f => f.id !== ctx.id);
      else if (ctx.kind === 'exercise') next.exercises = next.exercises.filter(e => e.id !== ctx.id);
      else if (ctx.kind === 'food-entry') next.days[selectedDate].meals[ctx.meal] = next.days[selectedDate].meals[ctx.meal].filter(i => i.id !== ctx.id);
      else if (ctx.kind === 'workout') next.days[selectedDate].workouts = next.days[selectedDate].workouts.filter(w => w.id !== ctx.id);
    }, '已删除');
    else if (ctx.type === 'import') {
      const normalized = validateBackup(pendingImport);
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) localStorage.setItem(RECOVERY_KEY, raw);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        state = normalized; startupError = ''; pendingImport = null; status('已在本机保存'); toast('备份已恢复'); ok = true;
      } catch { throw new Error('恢复失败：存储空间不足或不可用。原记录未被替换，请先导出备份。'); }
    }
    if (ok) {
      // Remove the modal/backdrop before replacing the journal it overlays.
      // The meal list, intake totals and standard comparisons then repaint together.
      modal.close();
      render();
      if (ctx.returnPicker) openPicker(ctx.returnPicker.type, ctx.returnPicker.meal);
    }
  } catch (error) { form.querySelector('#form-error').textContent = error.message; }
});
window.addEventListener('hashchange', navigate);
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  try {
    state = event.newValue ? validateBackup(JSON.parse(event.newValue)) : emptyState();
    startupError = ''; if (modal.open) modal.close(); render(); toast('记录已从另一个标签页更新');
  } catch { status('另一标签页的记录无效', true); }
});
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
navigate();
