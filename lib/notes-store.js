/* 笔记文件仓库
 * 目录结构：
 *   notes/2026-11-17/笔记.md
 *   notes/2026-11-17/images/194212-1.png
 * 每点一次「手动保存」就在 笔记.md 末尾追加一个 ## 块（只有新截图的内容）；
 * 聊天修改只替换最后一个 ## 块，前面的块原样保留。 */

import fs from 'node:fs/promises';
import path from 'node:path';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}

export function assertDate(date) {
  if (!DATE_RE.test(String(date || ''))) throw httpError(400, '日期格式应为 YYYY-MM-DD');
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    throw httpError(400, `没有 ${date} 这一天`);
  }
  return date;
}

export function nowHHmm(now = new Date()) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestampName(now = new Date()) {
  return `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function detectImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

export class NotesStore {
  constructor(root) {
    this.root = path.resolve(root);
  }

  dayDir(date) {
    return path.join(this.root, assertDate(date));
  }

  notePath(date) {
    return path.join(this.dayDir(date), '笔记.md');
  }

  imagesDir(date) {
    return path.join(this.dayDir(date), 'images');
  }

  async ensureDay(date) {
    await fs.mkdir(this.imagesDir(date), { recursive: true });
  }

  async read(date) {
    try {
      return await fs.readFile(this.notePath(date), 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return '';
      throw e;
    }
  }

  async write(date, markdown) {
    await this.ensureDay(date);
    const file = this.notePath(date);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, markdown, 'utf8');
    await fs.rename(tmp, file);
  }

  /** 返回 [{ heading, body, start, end }]，start 是 ## 行号，end 是下一块之前 */
  parseBlocks(markdown) {
    const lines = String(markdown || '').split('\n');
    const starts = [];
    let inCode = false;
    lines.forEach((line, i) => {
      if (/^```/.test(line.trim())) { inCode = !inCode; return; }
      if (!inCode && /^##\s+/.test(line)) starts.push(i);
    });
    return starts.map((start, i) => {
      const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
      return {
        heading: lines[start],
        body: lines.slice(start + 1, end).join('\n').trim(),
        start,
        end,
      };
    });
  }

  /** 在末尾追加一块，返回新的完整 markdown */
  async appendBlock(date, heading, body) {
    const cleanBody = String(body || '').trim();
    if (!cleanBody) throw httpError(422, 'AI 没有生成内容，再点一次保存试试');

    await this.ensureDay(date);
    let md = await this.read(date);
    if (!md.trim()) md = `# ${date} · 学习笔记\n`;

    // 保证文件末尾是单个空行，再拼接新块
    md = md.replace(/[ \t]+$/gm, '').replace(/\n{3,}$/g, '\n\n').replace(/\s+$/, '');
    md += `\n\n## ${heading}\n\n${cleanBody}\n`;
    await this.write(date, md);
    return md;
  }

  /** 只替换最后一个 ## 块的内容，前面所有内容原样保留 */
  async replaceLastBlockBody(date, body) {
    const cleanBody = String(body || '').trim();
    if (!cleanBody) throw httpError(422, 'AI 没有返回修改后的内容，再试一次');

    const md = await this.read(date);
    const blocks = this.parseBlocks(md);
    if (!blocks.length) throw httpError(409, '这一天的笔记还是空的，先贴截图点「手动保存」');

    const last = blocks[blocks.length - 1];
    const lines = md.split('\n');
    const head = lines.slice(0, last.start + 1);
    const out = [...head, '', cleanBody, ''].join('\n').replace(/\s+$/, '') + '\n';
    await this.write(date, out);
    return { markdown: out, heading: last.heading };
  }

  async noteInfo(date) {
    const md = await this.read(date);
    const blocks = this.parseBlocks(md);
    const images = await this.imageFiles(date);
    let mtime = null;
    try {
      mtime = (await fs.stat(this.notePath(date))).mtime.toISOString();
    } catch { /* 还没有文件 */ }
    return {
      date,
      markdown: md,
      folder: path.relative(this.root, this.dayDir(date)),
      blocks: blocks.map(b => ({ heading: b.heading, preview: b.body.slice(0, 160) })),
      blockCount: blocks.length,
      images,
      imageCount: images.length,
      mtime,
    };
  }

  async imageFiles(date) {
    try {
      const names = await fs.readdir(this.imagesDir(date));
      return names.filter(n => IMAGE_EXT.has(path.extname(n).slice(1).toLowerCase())).sort();
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  /** items: [{ buffer, name? }]，返回 [{ file, bytes }] */
  async saveImages(date, items) {
    if (!Array.isArray(items) || !items.length) throw httpError(400, '至少放一张截图再保存');
    if (items.length > 10) throw httpError(400, '一次最多 10 张截图');

    await this.ensureDay(date);
    const stamp = timestampName();
    const saved = [];
    let index = 0;

    for (const item of items) {
      const ext = detectImage(item.buffer);
      if (!ext) throw httpError(400, '只支持 PNG / JPG / WebP / GIF 截图');
      index += 1;
      let name = `${stamp}-${index}.${ext}`;
      let n = 1;
      while (true) {
        try {
          await fs.access(path.join(this.imagesDir(date), name));
          n += 1;
          name = `${stamp}-${index}-${n}.${ext}`;
        } catch {
          break;
        }
      }
      await fs.writeFile(path.join(this.imagesDir(date), name), item.buffer);
      saved.push({ file: name, bytes: item.buffer.length });
    }
    return saved;
  }

  async removeImages(date, files) {
    await Promise.all(files.map(async f => {
      try { await fs.unlink(path.join(this.imagesDir(date), path.basename(f))); } catch { /* ignore */ }
    }));
  }

  async listDays() {
    let entries = [];
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const days = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !DATE_RE.test(entry.name)) continue;
      try {
        const stat = await fs.stat(this.notePath(entry.name));
        const md = await this.read(entry.name);
        const blocks = this.parseBlocks(md);
        const images = await this.imageFiles(entry.name);
        days.push({
          date: entry.name,
          blockCount: blocks.length,
          imageCount: images.length,
          mtime: stat.mtime.toISOString(),
          preview: blocks.length ? blocks[blocks.length - 1].body.replace(/[#>*`!\[\]()]/g, '').replace(/\s+/g, ' ').slice(0, 60) : '',
        });
      } catch { /* 没有 笔记.md 的日期目录跳过 */ }
    }
    return days.sort((a, b) => (a.date < b.date ? 1 : -1));
  }
}
