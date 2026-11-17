import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

/* 测试中间文件也按全局规则放进 DSH_Workspace，结束后整目录删掉 */
const SCRATCH = process.env.JAVA_NOTES_TEST_ROOT || path.join(
  os.homedir(), 'Desktop', 'DSH_Workspace', 'Java学习之路', '2026-11-17', 'notes-agent', 'test'
);

export async function makeRoot(tag) {
  const dir = path.join(SCRATCH, `${tag}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function rmRoot(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

export function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

export function close(server) {
  return new Promise(resolve => server.close(resolve));
}

export async function req(base, pathname, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

/** 用原生 http 发请求，才能伪造 Host 头 */
export function raw(base, pathname, headers = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: u.hostname,
      port: u.port,
      path: pathname,
      method: 'GET',
      headers,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    r.on('error', reject);
    r.end();
  });
}

export const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
