import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDeepSeek } from '../lib/deepseek.js';
import { listen, close } from './helpers.mjs';

function mockServer(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 空 body */ }
      handler(req, res, body);
    });
  });
  return server;
}

test('聊天请求带上图片块和 Bearer Key，能取回文本', async () => {
  let captured = null;
  let auth = '';
  const server = mockServer((req, res, body) => {
    captured = body;
    auth = req.headers.authorization;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '整理好的笔记' } }] }));
  });
  const port = await listen(server);
  try {
    const client = createDeepSeek({ apiKey: 'sk-abc', baseUrl: `http://127.0.0.1:${port}` });
    const text = await client.chat([
      { role: 'system', content: '规则' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '看这些图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'original' } },
        ],
      },
    ], { maxTokens: 1234, temperature: 0.2 });

    assert.equal(text, '整理好的笔记');
    assert.equal(auth, 'Bearer sk-abc');
    assert.equal(captured.model, 'deepseek-flash');
    assert.equal(captured.max_tokens, 1234);
    assert.equal(captured.temperature, 0.2);
    assert.equal(captured.messages[1].content[1].type, 'image_url');
    assert.equal(captured.messages[1].content[1].image_url.detail, 'original');
  } finally {
    await close(server);
  }
});

test('401 会翻译成中文 Key 提示', async () => {
  const server = mockServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Authentication Fails' } }));
  });
  const port = await listen(server);
  try {
    const client = createDeepSeek({ apiKey: 'bad', baseUrl: `http://127.0.0.1:${port}` });
    await assert.rejects(
      () => client.chat([{ role: 'user', content: 'hi' }], { retries: 0 }),
      e => e.status === 401 && /Key 无效/.test(e.message)
    );
  } finally {
    await close(server);
  }
});

test('402 提示余额不足', async () => {
  const server = mockServer((req, res) => {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Insufficient Balance' } }));
  });
  const port = await listen(server);
  try {
    const client = createDeepSeek({ apiKey: 'p', baseUrl: `http://127.0.0.1:${port}` });
    await assert.rejects(
      () => client.chat([{ role: 'user', content: 'hi' }], { retries: 0 }),
      /余额不足/
    );
  } finally {
    await close(server);
  }
});

test('模型列表用于测试连接', async () => {
  const server = mockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-chat' }] }));
  });
  const port = await listen(server);
  try {
    const client = createDeepSeek({ apiKey: 'p', baseUrl: `http://127.0.0.1:${port}` });
    assert.deepEqual(await client.listModels(), ['deepseek-flash', 'deepseek-chat']);
  } finally {
    await close(server);
  }
});

test('空回复会报错，不会写空笔记', async () => {
  const server = mockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '   ' } }] }));
  });
  const port = await listen(server);
  try {
    const client = createDeepSeek({ apiKey: 'p', baseUrl: `http://127.0.0.1:${port}` });
    await assert.rejects(
      () => client.chat([{ role: 'user', content: 'hi' }], { retries: 0 }),
      /空内容/
    );
  } finally {
    await close(server);
  }
});
