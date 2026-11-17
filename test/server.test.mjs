import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';
import { makeRoot, rmRoot, listen, close, req, raw, TINY_PNG } from './helpers.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await makeRoot('server');
const app = createApp({
  appRoot,
  notesRoot: path.join(root, 'notes'),
  configPath: path.join(root, 'config.local.json'),
  mock: true,
});
const port = await listen(app.server);
const base = `http://127.0.0.1:${port}`;

test.after(async () => {
  await close(app.server);
  await rmRoot(root);
});

const day = '2026-11-17';

test('状态接口：没填 Key 时也能启动，当前是模拟模式', async () => {
  const r = await req(base, '/api/status');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.hasKey, false);
  assert.equal(r.data.mock, true);
  assert.equal(r.data.model, 'deepseek-flash');
  assert.equal(r.data.today, new Date().toISOString().slice(0, 10));
});

test('静态看板能打开，笔记页的 DOM 在', async () => {
  const r = await req(base, '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.data, /id="view-notes"/);
  assert.match(r.data, /id="saveNote"/);
  assert.match(r.data, /data-quick="更简短"/);
  assert.match(r.data, /data-quick="换一句"/);
  assert.match(r.data, /data-quick="高亮语句"/);
});

test('保存截图：写图、写 md、只追加一块', async () => {
  const r = await req(base, `/api/notes/${day}/save`, {
    method: 'POST',
    body: { images: [TINY_PNG], hint: '这页讲多态' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.note.date, day);
  assert.equal(r.data.note.blockCount, 1);
  assert.match(r.data.note.markdown, new RegExp(`^# ${day} · 学习笔记`));
  assert.match(r.data.note.markdown, /## \d{2}:\d{2} · 截图笔记/);
  assert.match(r.data.heading, /^\d{2}:\d{2} · 截图笔记$/);

  const file = r.data.images[0].file;
  assert.match(file, /^\d{6}-1\.png$/);

  const img = await req(base, `/notes/${day}/images/${file}`);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/png/);

  const md = await req(base, `/notes/${day}/笔记.md`);
  assert.equal(md.status, 200);
  assert.match(md.headers.get('content-type'), /text\/markdown/);
  assert.match(md.data, /截图笔记/);

  const onDisk = await fs.readFile(path.join(app.notesRoot, day, '笔记.md'), 'utf8');
  assert.match(onDisk, /^# 2026-11-17 · 学习笔记/);
});

test('第二次保存只追加，第一块一个字都不动', async () => {
  const before = app.store.parseBlocks(await app.store.read(day));
  const firstBody = before[0].body;

  const r = await req(base, `/api/notes/${day}/save`, {
    method: 'POST',
    body: { images: [TINY_PNG, TINY_PNG] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.note.blockCount, 2);

  const after = app.store.parseBlocks(await app.store.read(day));
  assert.equal(after.length, 2);
  assert.equal(after[0].body, firstBody);
  assert.notEqual(after[1].body, firstBody);
  const refs = after[1].body.match(/!\[截图\]\(images\/[^)]+\.png\)/g) || [];
  assert.equal(refs.length, 2);
  refs.forEach(ref => assert.match(ref, /images\/\d{6}-[^)]+\.png/));

  const files = await fs.readdir(path.join(app.notesRoot, day, 'images'));
  assert.equal(files.length, 3);
});

test('聊天只改最后一块，前面的块保持不变', async () => {
  const before = app.store.parseBlocks(await app.store.read(day));
  const first = before[0].body;
  const second = before[1].body;

  const r = await req(base, `/api/notes/${day}/chat`, {
    method: 'POST',
    body: { request: '更简短' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.note.blockCount, 2);
  assert.match(r.data.body, /理解/);
  assert.notEqual(r.data.body, second);

  const after = app.store.parseBlocks(await app.store.read(day));
  assert.equal(after.length, 2);
  assert.equal(after[0].body, first);
  assert.equal(after[1].body, r.data.body);
  assert.equal(after[1].heading, before[1].heading);
});

test('没有笔记的日期不能聊天，先保存', async () => {
  const r = await req(base, '/api/notes/2026-11-18/chat', {
    method: 'POST',
    body: { request: '高亮语句' },
  });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /先贴截图/);
});

test('非法图片、空图片、超过 10 张都拒绝', async () => {
  const bad = await req(base, `/api/notes/${day}/save`, {
    method: 'POST',
    body: { images: ['data:image/png;base64,aGVsbG8='] },
  });
  assert.equal(bad.status, 400);

  const empty = await req(base, `/api/notes/${day}/save`, {
    method: 'POST',
    body: { images: [] },
  });
  assert.equal(empty.status, 400);

  const many = await req(base, `/api/notes/${day}/save`, {
    method: 'POST',
    body: { images: Array.from({ length: 11 }, () => TINY_PNG) },
  });
  assert.equal(many.status, 400);
  assert.match(many.data.error, /最多 10 张/);
});

test('日期校验和路径穿越都挡住', async () => {
  const invalid = await req(base, '/api/notes/2026-02-30');
  assert.equal(invalid.status, 400);

  const traversal = await req(base, `/notes/${day}/images/..%2F..%2Fconfig.local.json`);
  assert.equal(traversal.status, 404);

  const missing = await req(base, `/notes/${day}/images/nope.png`);
  assert.equal(missing.status, 404);
});

test('只允许本机 Host 访问', async () => {
  const r = await raw(base, '/api/status', { Host: 'evil.example.com' });
  assert.equal(r.status, 403);
});

test('设置：Key 写入 0600，不回传明文，配置文件不能被静态访问', async () => {
  const save = await req(base, '/api/config', {
    method: 'POST',
    body: { apiKey: 'sk-test-123456', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' },
  });
  assert.equal(save.status, 200);
  assert.equal(save.data.hasKey, true);
  assert.ok(save.data.keyMasked.includes('…'));

  const status = await req(base, '/api/status');
  assert.equal(status.data.hasKey, true);
  assert.equal(status.data.keyMasked, save.data.keyMasked);

  const cfg = await req(base, '/api/config');
  assert.equal(cfg.data.keyMasked, save.data.keyMasked);
  assert.equal(JSON.stringify(cfg.data).includes('sk-test-123456'), false);

  const mode = (await fs.stat(app.configPath)).mode & 0o777;
  assert.equal(mode, 0o600);

  const blocked = await req(base, '/config.local.json');
  assert.equal(blocked.status, 404);
});
