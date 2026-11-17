import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NotesStore, assertDate, nowHHmm } from '../lib/notes-store.js';
import { makeRoot, rmRoot } from './helpers.mjs';

const root = await makeRoot('store');
const store = new NotesStore(root);

test.after(async () => {
  await rmRoot(root);
});

test('日期校验只认真实存在的 YYYY-MM-DD', () => {
  assert.equal(assertDate('2026-11-17'), '2026-11-17');
  assert.throws(() => assertDate('2026-13-01'), /没有 2026-13-01 这一天/);
  assert.throws(() => assertDate('2026-02-30'), /没有 2026-02-30 这一天/);
  assert.throws(() => assertDate('2026-1-1'), /日期格式/);
  assert.throws(() => assertDate('../etc'), /日期格式/);
});

test('第一次追加会自动写顶层标题，第二次追加不动第一块', async () => {
  await store.appendBlock('2026-11-17', '09:30 · 截图笔记', '**第一块**\n\n- 内容一');
  let md = await store.read('2026-11-17');
  assert.match(md, /^# 2026-11-17 · 学习笔记/);
  assert.match(md, /## 09:30 · 截图笔记/);

  const first = store.parseBlocks(md)[0].body;

  await store.appendBlock('2026-11-17', '10:05 · 截图笔记', '**第二块**\n\n- 内容二');
  md = await store.read('2026-11-17');
  const blocks = store.parseBlocks(md);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].body, first);
  assert.equal(blocks[1].body, '**第二块**\n\n- 内容二');
  assert.equal(blocks[1].heading, '## 10:05 · 截图笔记');
});

test('代码块里的 ## 不算新块', () => {
  const blocks = store.parseBlocks('# 2026-11-17 · 学习笔记\n\n## A\n\n```bash\n## 这不是标题\necho hi\n```\n\n## B\nx');
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].body, /## 这不是标题/);
  assert.equal(blocks[1].heading, '## B');
});

test('替换最后一块时，前面的块和最后一个标题都不变', async () => {
  const before = store.parseBlocks(await store.read('2026-11-17'));
  const res = await store.replaceLastBlockBody('2026-11-17', '**第二块改**\n\n- 改过了\n\n**理解**：只改了这里');
  assert.equal(res.heading, '## 10:05 · 截图笔记');

  const after = store.parseBlocks(await store.read('2026-11-17'));
  assert.equal(after.length, 2);
  assert.equal(after[0].body, before[0].body);
  assert.equal(after[1].heading, before[1].heading);
  assert.equal(after[1].body, '**第二块改**\n\n- 改过了\n\n**理解**：只改了这里');
  assert.match(await store.read('2026-11-17'), /^# 2026-11-17 · 学习笔记/);
});

test('没有块时不能替换，空内容也不能写', async () => {
  await assert.rejects(() => store.replaceLastBlockBody('2026-11-20', 'x'), /还是空的/);
  await assert.rejects(() => store.appendBlock('2026-11-20', 'x', '   '), /没有生成内容/);
});

test('截图按时间命名，同一秒内也不会覆盖', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const a = await store.saveImages('2026-11-17', [{ buffer: png }, { buffer: png }]);
  const b = await store.saveImages('2026-11-17', [{ buffer: png }]);
  assert.equal(a.length, 2);
  assert.equal(b.length, 1);
  const names = [...a, ...b].map(x => x.file);
  assert.equal(new Set(names).size, 3);
  names.forEach(n => assert.match(n, /^\d{6}-\d+(?:-\d+)?\.png$/));

  const files = await store.imageFiles('2026-11-17');
  assert.equal(files.length, 3);

  const info = await store.noteInfo('2026-11-17');
  assert.equal(info.imageCount, 3);
  assert.equal(info.blockCount, 2);
  assert.ok(info.mtime);
});

test('非图片内容会被拒绝', async () => {
  await assert.rejects(
    () => store.saveImages('2026-11-17', [{ buffer: Buffer.from('hello world, not an image') }]),
    /只支持/
  );
});

test('日期列表按倒序返回', async () => {
  await store.appendBlock('2026-11-18', '20:00 · 截图笔记', '**新的一天**');
  const days = await store.listDays();
  assert.deepEqual(days.map(d => d.date).slice(0, 2), ['2026-11-18', '2026-11-17']);
  assert.ok(days[0].blockCount >= 1);
  assert.ok(nowHHmm().match(/^\d{2}:\d{2}$/));
});

test('删除截图只删指定文件', async () => {
  const files = await store.imageFiles('2026-11-17');
  await store.removeImages('2026-11-17', [files[0]]);
  const left = await store.imageFiles('2026-11-17');
  assert.equal(left.length, files.length - 1);
  assert.equal(left.includes(files[0]), false);

  const onDisk = await fs.readdir(path.join(root, '2026-11-17', 'images'));
  assert.equal(onDisk.length, files.length - 1);
});

test('手动编辑中间一块，标题和前后块都不动', async () => {
  await store.appendBlock('2026-11-22', '09:00 · 截图笔记', '**第一块**\n- a');
  await store.appendBlock('2026-11-22', '10:00 · 截图笔记', '**第二块**\n- b');
  await store.appendBlock('2026-11-22', '11:00 · 截图笔记', '**第三块**\n- c');

  const before = store.parseBlocks(await store.read('2026-11-22'));
  const res = await store.replaceBlockBody('2026-11-22', 1, '**第二块手动改**\n- 改过了');
  assert.equal(res.heading, '## 10:00 · 截图笔记');

  const after = store.parseBlocks(await store.read('2026-11-22'));
  assert.equal(after.length, 3);
  assert.equal(after[0].body, before[0].body);
  assert.equal(after[1].body, '**第二块手动改**\n- 改过了');
  assert.equal(after[1].heading, before[1].heading);
  assert.equal(after[2].body, before[2].body);
  await assert.rejects(() => store.replaceBlockBody('2026-11-22', 9, 'x'), /不存在/);
  await assert.rejects(() => store.replaceBlockBody('2026-11-22', 0, '  '), /不能是空/);
});
