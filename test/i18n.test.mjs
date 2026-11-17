import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runPlan = file => {
  const window = {};
  new Function('window', fs.readFileSync(path.join(ROOT, file), 'utf8'))(window);
  return window;
};
const zh = runPlan('plan.js');
const en = runPlan('plan.en.js');
const CJK = /[\u3400-\u9fff]/;

test('英文计划与中文计划天数、任务数、分钟数一一对应', () => {
  const zhDates = Object.keys(zh.PLAN.days);
  assert.equal(zhDates.length, 162);
  assert.deepEqual(Object.keys(en.PLAN_EN.days), zhDates);
  for (const date of zhDates) {
    const a = zh.PLAN.days[date];
    const b = en.PLAN_EN.days[date];
    assert.equal(b.tasks.length, a.tasks.length, `${date} 任务数不一致`);
    a.tasks.forEach((task, i) => assert.equal(b.tasks[i].m, task.m, `${date} 第 ${i + 1} 条时长不一致`));
    assert.equal(b.links.length, a.links.length, `${date} 链接数不一致`);
  }
});

test('英文计划正文不含中文字符', () => {
  for (const [date, day] of Object.entries(en.PLAN_EN.days)) {
    const texts = [day.stage, day.topic, day.focus, day.tip, ...day.tasks.map(t => t.t), ...day.links.map(l => l.name)];
    for (const text of texts) assert.ok(!CJK.test(text), `${date} 仍有中文：${text.slice(0, 40)}`);
  }
  for (const site of en.STUDY_SITES_EN) assert.ok(!CJK.test(site.name), `站点名仍有中文：${site.name}`);
  assert.ok(!CJK.test(en.PLAN_EN.title) && !CJK.test(en.PLAN_EN.subtitle));
});

test('中英文切换脚本导出 I18N 且词典包含润色', () => {
  const code = fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8');
  assert.match(code, /window\.I18N\s*=/);
  assert.match(code, /'润色': 'Polish'/);
  assert.match(code, /I18N\.refreshTitle\(\)/);
});
