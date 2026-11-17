/* 提示词装配：每次请求都从 agent/ 目录现读，用户改 md 后不用重启服务 */

import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_BODY = 20000;

/** 模型偶尔会在块里再写 ## 小标题；转成加粗，保证它仍是一块 */
function demoteHeadings(body) {
  let inCode = false;
  return String(body || '').split('\n').map(line => {
    if (/^```/.test(line.trim())) { inCode = !inCode; return line; }
    if (!inCode && /^#{1,6}\s+\S/.test(line)) {
      return '**' + line.replace(/^#{1,6}\s+/, '').trim() + '**';
    }
    return line;
  }).join('\n');
}

export function stripFence(text) {
  let s = String(text || '').trim();
  const m = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(s);
  if (m) s = m[1].trim();
  return s;
}

/** 保存时：模型只能给「块正文」，把误加的标题/整篇笔记切掉 */
export function cleanNoteBody(text) {
  let s = stripFence(text);
  s = s.replace(/^#\s+.*\n+/, '');
  s = s.replace(/^##\s+.*\n+/, '');
  s = demoteHeadings(s);
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  if (!s) return '';
  return s.slice(0, MAX_BODY);
}

/** 聊天时：万一把整篇笔记吐回来，只取最后一个 ## 块 */
export function coerceBlockBody(text) {
  let s = stripFence(text);
  if (/^#\s+/.test(s) || /^##\s+/.test(s)) {
    const parts = s.split(/\n(?=##\s+)/);
    if (parts.length > 1) s = parts[parts.length - 1].replace(/^##\s+.*\n+/, '');
  }
  s = s.replace(/^##\s+.*\n+/, '');
  s = demoteHeadings(s);
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s.slice(0, MAX_BODY);
}

export function extractImageRefs(body) {
  const out = [];
  const re = /!\[[^\]]*\]\((images\/[A-Za-z0-9._\-]+)\)/g;
  let m;
  while ((m = re.exec(String(body || '')))) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export function createPromptBook(agentDir) {
  async function readSkill(name, fallback) {
    try {
      const text = await fs.readFile(path.join(agentDir, name), 'utf8');
      return text.trim() || fallback;
    } catch {
      return fallback;
    }
  }

  async function generateMessages({ date, time, hint, images }) {
    const system = await readSkill('笔记生成.md', '把截图里的知识点整理成简洁的 Markdown 笔记。');
    const lines = [
      `日期：${date}，现在时间：${time}。`,
      hint ? `我这次的补充说明：${hint}` : '我这次没有额外说明，按截图内容整理。',
      `本次共 ${images.length} 张截图，按顺序是：${images.map(i => i.name).join('、')}。`,
      '请只输出这一块笔记的正文，不要写 ## 标题，不要重复之前的笔记。',
    ];
    const content = [{ type: 'text', text: lines.join('\n') }];
    for (const img of images) {
      content.push({ type: 'image_url', image_url: { url: img.dataUrl, detail: 'original' } });
    }
    return [
      { role: 'system', content: system },
      { role: 'user', content },
    ];
  }

  async function chatMessages({ request, markdown, lastHeading, lastBody, images = [] }) {
    const system = await readSkill('笔记修改.md', '只修改最后一块笔记，前面的内容保持原样。');
    const text = [
      '这是这一天完整的笔记：',
      '<<<',
      String(markdown || '').trim(),
      '>>>',
      '',
      `你要修改的是最后一块：${lastHeading || '(最后一块)'}`,
      '最后一块现在的内容：',
      '<<<',
      String(lastBody || '').trim(),
      '>>>',
      '',
      `我的要求：${request}`,
      '只输出修改后的最后一块正文，不要输出整篇笔记，也不要自己加 ## 标题。',
    ].join('\n');
    const content = [{ type: 'text', text }];
    for (const img of images) {
      content.push({ type: 'image_url', image_url: { url: img.dataUrl, detail: 'original' } });
    }
    return [
      { role: 'system', content: system },
      { role: 'user', content },
    ];
  }

  return { generateMessages, chatMessages };
}
