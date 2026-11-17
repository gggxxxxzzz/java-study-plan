/* 本地服务：托管看板静态页 + 笔记 API + DeepSeek 视觉调用
 * 只监听 127.0.0.1，零依赖。启动：node server.js 或双击「启动.command」。 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDeepSeek, DeepSeekError, DEFAULT_BASE, DEFAULT_MODEL } from './lib/deepseek.js';
import { NotesStore, assertDate, httpError, nowHHmm } from './lib/notes-store.js';
import { createPromptBook, cleanNoteBody, coerceBlockBody, extractImageRefs } from './lib/prompts.js';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.JAVA_NOTES_PORT || 5271);
const HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024 * 1024;
const MAX_IMAGES = 10;

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/plan.js', ['plan.js', 'text/javascript; charset=utf-8']],
  ['/plan.en.js', ['plan.en.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/markdown.js', ['markdown.js', 'text/javascript; charset=utf-8']],
  ['/hyalite.js', ['hyalite.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/wallpaper.png', ['wallpaper.png', 'image/png']],
  ['/wallpaper-blur.jpg', ['wallpaper-blur.jpg', 'image/jpeg']],
  ['/preview.png', ['preview.png', 'image/png']],
]);

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.md': 'text/markdown; charset=utf-8',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, e) {
  const status = Number(e?.status) || 500;
  const message = e?.expose || status < 500 ? e.message : '服务器内部错误，看下启动服务的终端窗口。';
  if (status >= 500) console.error('[notes]', e);
  json(res, status, { error: message });
}

function readJson(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, '一次放的截图太多或太大，分两次保存吧'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, '请求内容不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function decodeDataUrl(value) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value || ''));
  if (!m) throw httpError(400, '截图格式不支持，只收 PNG / JPG / WebP / GIF');
  const buffer = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (buffer.length < 32) throw httpError(400, '有一张截图是空的');
  if (buffer.length > 12 * 1024 * 1024) throw httpError(400, '单张截图超过 12MB，压缩一下再放');
  return { buffer, mime: m[1] };
}

function dataUrlFor(buffer, ext) {
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext] || 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function extFor(file) {
  return path.extname(file).slice(1).toLowerCase();
}

async function readConfig(configPath) {
  let raw = {};
  try {
    raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch { /* 没有配置文件就等用户填 */ }
  const envKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  const apiKey = envKey || String(raw.apiKey || '').trim();
  return {
    apiKey,
    hasKey: Boolean(apiKey),
    fromEnv: Boolean(envKey),
    baseUrl: String(raw.baseUrl || DEFAULT_BASE).trim() || DEFAULT_BASE,
    model: String(raw.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
  };
}

async function writeConfig(configPath, patch) {
  const current = await readConfig(configPath);
  const next = {
    apiKey: patch.apiKey === undefined ? current.apiKey : String(patch.apiKey).trim(),
    baseUrl: patch.baseUrl === undefined ? current.baseUrl : String(patch.baseUrl).trim(),
    model: patch.model === undefined ? current.model : String(patch.model).trim(),
  };
  if (!/^https?:\/\/\S+$/i.test(next.baseUrl)) throw httpError(400, 'API 地址要以 http:// 或 https:// 开头');
  if (!next.model) throw httpError(400, '模型名不能为空');
  if (next.apiKey && !/^[A-Za-z0-9_\-.]+$/.test(next.apiKey)) throw httpError(400, 'API Key 看起来不对，只应有字母数字和 - _ .');
  await fs.writeFile(configPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(configPath, 0o600).catch(() => {});
  return next;
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 10) return key.slice(0, 2) + '…' + key.slice(-2);
  return key.slice(0, 4) + '…' + key.slice(-4);
}

function openFolder(dir) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  return new Promise((resolve, reject) => {
    execFile(cmd, [dir], err => (err ? reject(err) : resolve()));
  });
}

function mockSaveBody(images) {
  const refs = images.map(i => `![截图](images/${i.file})`).join('\n');
  return [
    refs,
    '',
    '**模拟模式**',
    '- 现在没有调用 DeepSeek，这是本地测试内容。',
    '- 在「设置」里填 Key 后重新保存，就会换成真实笔记。',
    '',
    '**理解**：先把流程跑通，再换真模型。',
  ].join('\n');
}

function mockChatBody(request, lastBody) {
  if (/更简短/.test(request)) {
    return String(lastBody).split('\n').slice(0, 4).join('\n') + '\n\n**理解**：测试模式下只留了开头几行。';
  }
  if (/高亮/.test(request)) {
    return String(lastBody).replace(/^([^#\n].+)$/m, '==$1==') + '\n\n**理解**：测试模式给第一行加了高亮。';
  }
  return [
    '**模拟修改**',
    '',
    `- 收到要求：${request}`,
    '- 这是测试环境的固定回复，没有真的调用 DeepSeek。',
    '',
    '**理解**：聊天链路是通的，旧块没有被改动。',
  ].join('\n');
}

export function createApp(options = {}) {
  const appRoot = path.resolve(options.appRoot || APP_ROOT);
  const notesRoot = path.resolve(options.notesRoot || process.env.JAVA_NOTES_ROOT || path.join(appRoot, 'notes'));
  const configPath = path.resolve(options.configPath || process.env.JAVA_NOTES_CONFIG || path.join(appRoot, 'config.local.json'));
  const mock = options.mock ?? process.env.JAVA_NOTES_MOCK === '1';
  const store = new NotesStore(notesRoot);
  const prompts = createPromptBook(path.join(appRoot, 'agent'));

  // 同一天的保存/聊天排队执行，避免两个请求同时改同一个 md
  const lanes = new Map();
  function withLock(date, fn) {
    const prev = lanes.get(date) || Promise.resolve();
    const run = prev.then(fn, fn);
    lanes.set(date, run.catch(() => {}));
    return run;
  }

  async function aiClient() {
    const cfg = await readConfig(configPath);
    if (!cfg.hasKey) throw httpError(409, '还没有填 DeepSeek API Key，先点右上角「设置」填一个。');
    return { client: createDeepSeek(cfg), cfg };
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (origin === 'null' || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return true;
    }
    return false;
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || HOST}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // ---------- 状态与设置 ----------
    if (pathname === '/api/status' && req.method === 'GET') {
      const cfg = await readConfig(configPath);
      return json(res, 200, {
        ok: true,
        hasKey: cfg.hasKey,
        keyMasked: maskKey(cfg.apiKey),
        fromEnv: cfg.fromEnv,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        mock,
        notesDir: path.relative(appRoot, notesRoot) || 'notes',
        today: new Date().toISOString().slice(0, 10),
      });
    }

    if (pathname === '/api/config' && req.method === 'GET') {
      const cfg = await readConfig(configPath);
      return json(res, 200, {
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        hasKey: cfg.hasKey,
        keyMasked: maskKey(cfg.apiKey),
        fromEnv: cfg.fromEnv,
      });
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      const body = await readJson(req);
      const patch = {};
      if (typeof body.apiKey === 'string' && !body.apiKey.includes('…')) patch.apiKey = body.apiKey;
      if (typeof body.baseUrl === 'string') patch.baseUrl = body.baseUrl;
      if (typeof body.model === 'string') patch.model = body.model;
      if (!Object.keys(patch).length) throw httpError(400, '没有要保存的设置');
      const next = await writeConfig(configPath, patch);
      return json(res, 200, { ok: true, hasKey: Boolean(next.apiKey), keyMasked: maskKey(next.apiKey), baseUrl: next.baseUrl, model: next.model });
    }

    if (pathname === '/api/config/test' && req.method === 'POST') {
      const body = await readJson(req);
      const cfg = await readConfig(configPath);
      const key = typeof body.apiKey === 'string' && body.apiKey && !body.apiKey.includes('…') ? body.apiKey : cfg.apiKey;
      if (!key) return json(res, 200, { ok: false, error: '先填一个 API Key 再测试' });
      try {
        const client = createDeepSeek({ apiKey: key, baseUrl: body.baseUrl || cfg.baseUrl, model: body.model || cfg.model });
        const models = await client.listModels();
        return json(res, 200, { ok: true, models, model: client.model });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message || '连接失败' });
      }
    }

    // ---------- 笔记列表 ----------
    if (pathname === '/api/notes/days' && req.method === 'GET') {
      const days = await store.listDays();
      return json(res, 200, { ok: true, days });
    }

    // ---------- 单天笔记 ----------
    const noteMatch = pathname.match(/^\/api\/notes\/(\d{4}-\d{2}-\d{2})(?:\/(save|chat|block|open))?$/);
    if (noteMatch) {
      const date = assertDate(noteMatch[1]);
      const action = noteMatch[2] || '';

      if (!action && req.method === 'GET') {
        const info = await store.noteInfo(date);
        return json(res, 200, { ok: true, note: info });
      }

      if (action === 'save' && req.method === 'POST') {
        const body = await readJson(req);
        const rawImages = Array.isArray(body.images) ? body.images : [];
        if (!rawImages.length) throw httpError(400, '先放截图再点保存');
        if (rawImages.length > MAX_IMAGES) throw httpError(400, `一次最多 ${MAX_IMAGES} 张截图`);
        const decoded = rawImages.map(decodeDataUrl);
        const hint = String(body.hint || '').trim().slice(0, 2000);

        return withLock(date, async () => {
          const saved = await store.saveImages(date, decoded.map(d => ({ buffer: d.buffer })));
          try {
            const time = nowHHmm();
            let text;
            if (mock) {
              text = mockSaveBody(saved);
            } else {
              const { client } = await aiClient();
              const messages = await prompts.generateMessages({
                date,
                time,
                hint,
                images: saved.map((s, i) => ({ name: s.file, dataUrl: dataUrlFor(decoded[i].buffer, extFor(s.file)) })),
              });
              text = await client.chat(messages, { maxTokens: 4096, temperature: 0.25 });
            }
            const clean = cleanNoteBody(text);
            if (!clean) throw httpError(422, 'AI 没有生成有效内容，再点一次保存试试');
            await store.appendBlock(date, `${time} · 截图笔记`, clean);
            const info = await store.noteInfo(date);
            return json(res, 200, {
              ok: true,
              date,
              heading: `${time} · 截图笔记`,
              body: clean,
              images: saved,
              note: { ...info, markdown: info.markdown },
            });
          } catch (e) {
            // 笔记没写成，把刚存的图删掉，避免留下孤儿截图
            await store.removeImages(date, saved.map(s => s.file));
            throw e;
          }
        });
      }

      if (action === 'block' && req.method === 'POST') {
        const body = await readJson(req);
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 0) throw httpError(400, '要改哪一块没指定');
        const text = String(body.body || '').trim();
        if (!text) throw httpError(400, '这一块不能是空的');
        if (text.length > 20000) throw httpError(413, '这一块太长了，删减一点再存');
        assertNoBlockHeading(text);

        return withLock(date, async () => {
          const saved = await store.replaceBlockBody(date, index, text);
          const info = await store.noteInfo(date);
          return json(res, 200, {
            ok: true,
            date,
            index,
            heading: saved.heading,
            note: info,
          });
        });
      }

      if (action === 'chat' && req.method === 'POST') {
        const body = await readJson(req);
        const request = String(body.request || '').trim().slice(0, 2000);
        if (!request) throw httpError(400, '先说要改什么');

        return withLock(date, async () => {
          const markdown = await store.read(date);
          const blocks = store.parseBlocks(markdown);
          if (!blocks.length) throw httpError(409, '这一天的笔记还是空的，先贴截图点「手动保存」');
          const last = blocks[blocks.length - 1];

          // 把最后一块引用的截图重新喂给模型，方便它看着图改
          const images = [];
          for (const ref of extractImageRefs(last.body).slice(0, 6)) {
            const file = path.basename(ref);
            try {
              const buffer = await fs.readFile(path.join(store.imagesDir(date), file));
              images.push({ name: file, dataUrl: dataUrlFor(buffer, extFor(file)) });
            } catch { /* 图被删了就不带 */ }
          }

          let text;
          if (mock) {
            text = mockChatBody(request, last.body);
          } else {
            const { client } = await aiClient();
            const messages = await prompts.chatMessages({
              request,
              markdown,
              lastHeading: last.heading,
              lastBody: last.body,
              images,
            });
            text = await client.chat(messages, { maxTokens: 4096, temperature: 0.3 });
          }
          const clean = coerceBlockBody(text);
          if (!clean) throw httpError(422, 'AI 没有返回修改后的内容，再试一次');
          await store.replaceLastBlockBody(date, clean);
          const info = await store.noteInfo(date);
          return json(res, 200, {
            ok: true,
            date,
            heading: last.heading,
            body: clean,
            note: info,
          });
        });
      }

      if (action === 'open' && req.method === 'POST') {
        await openFolder(store.dayDir(date));
        return json(res, 200, { ok: true });
      }

      throw httpError(405, '这个操作不支持');
    }

    // ---------- 静态：笔记文件夹里的 md 和截图 ----------
    const fileMatch = pathname.match(/^\/notes\/(\d{4}-\d{2}-\d{2})\/(.+)$/);
    if (fileMatch) {
      const date = assertDate(fileMatch[1]);
      const rest = fileMatch[2];
      let target;
      if (rest === '笔记.md') target = store.notePath(date);
      else if (/^images\/[A-Za-z0-9._\-]+$/.test(rest)) target = path.join(store.imagesDir(date), path.basename(rest));
      if (!target) throw httpError(404, '文件不存在');
      let content;
      try {
        content = await fs.readFile(target);
      } catch {
        throw httpError(404, '文件不存在');
      }
      res.writeHead(200, {
        'Content-Type': MIME_BY_EXT[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': rest === '笔记.md' ? 'no-store' : 'public, max-age=3600',
      });
      return res.end(content);
    }

    // ---------- 静态：看板本身 ----------
    if (req.method === 'GET') {
      const entry = STATIC_FILES.get(pathname);
      if (entry) {
        const [file, type] = entry;
        try {
          const content = await fs.readFile(path.join(appRoot, file));
          res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
          return res.end(content);
        } catch {
          throw httpError(404, '文件不存在');
        }
      }
      throw httpError(404, '页面不存在');
    }

    throw httpError(405, '这个操作不支持');
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      const host = String(req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '');
      if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
        throw httpError(403, '只允许本机访问');
      }
      if (!applyCors(req, res)) {
        throw httpError(403, '不允许其他网页调用这个接口');
      }
      await handle(req, res);
    } catch (e) {
      if (!res.headersSent) sendError(res, e);
      else res.end();
    } finally {
      if (process.env.JAVA_NOTES_LOG === '1') {
        console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      }
    }
  });

  return { server, store, configPath, notesRoot, appRoot, mock };
}

export async function start() {
  const app = createApp();
  await fs.mkdir(app.notesRoot, { recursive: true });

  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(PORT, HOST, resolve);
  }).catch(e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n端口 ${PORT} 被占用了，可能已经启动过。`);
      console.error(`直接打开 http://${HOST}:${PORT} 试试；要重启就先关掉旧的终端窗口。\n`);
    } else {
      console.error('启动失败：', e);
    }
    process.exit(1);
  });

  const cfg = await readConfig(app.configPath);
  console.log('');
  console.log('  Java 学习笔记已启动');
  console.log(`  打开：http://${HOST}:${PORT}`);
  console.log(`  笔记保存在：${app.notesRoot}`);
  console.log(`  DeepSeek：${app.mock ? '模拟模式（不调用 API）' : cfg.hasKey ? `已配置 Key（${cfg.model}）` : '还没填 Key，点页面右上角「设置」'}`);
  console.log('');
  console.log('  关掉这个窗口或按 Ctrl+C 停止服务。');
  console.log('');

  const shutdown = () => {
    console.log('\n正在关闭…');
    app.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return app;
}

function assertNoBlockHeading(text) {
  let inCode = false;
  for (const line of String(text || '').split('\n')) {
    if (/^```/.test(line.trim())) { inCode = !inCode; continue; }
    if (!inCode && /^##\s+/.test(line)) {
      throw httpError(400, '块里不能再写 ## 标题，用 **加粗小标题** 代替');
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) start();

export { APP_ROOT, PORT, HOST, STATIC_FILES, readConfig, writeConfig };
