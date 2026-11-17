/* 极简 Markdown 渲染器（只给笔记用）
   支持：标题、段落、粗体/斜体/删除线/==高亮==、行内代码、代码块、列表、
   任务列表、引用、表格、分割线、图片、链接。所有原文先转义，避免 XSS。 */
(function () {
  'use strict';

  const escapeHtml = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  function safeUrl(url, { image = false, base = '' } = {}) {
    let u = String(url || '').trim();
    if (!u) return '';
    if (image && base && /^images\//.test(u)) u = base.replace(/\/?$/, '/') + u;
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    if (image && /^data:image\//i.test(u)) return u;
    if (/^[./#]/.test(u)) return u;
    return '';
  }

  function inline(text, opts) {
    const codes = [];
    let s = String(text || '').replace(/(`+)([\s\S]*?)\1/g, (_, __, code) => {
      codes.push(code);
      return `\u0000C${codes.length - 1}\u0000`;
    });

    s = escapeHtml(s);

    // 图片
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (all, alt, src) => {
      const url = safeUrl(src, { image: true, base: opts.imageBase });
      if (!url) return all;
      const a = alt || '截图';
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(a)}" loading="lazy" decoding="async">`;
    });

    // 链接
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (all, label, href) => {
      const url = safeUrl(href);
      if (!url) return all;
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    // 粗斜体 → 粗体 → 斜体 → 删除线 → 高亮
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

    s = s.replace(/\u0000C(\d+)\u0000/g, (_, n) => `<code>${escapeHtml(codes[Number(n)])}</code>`);
    return s;
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  }

  const isTableSep = line => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

  function render(markdown, options) {
    const opts = Object.assign({ imageBase: '' }, options || {});
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null;
    let i = 0;

    const flushPara = () => {
      if (!para.length) return;
      out.push(`<p>${para.map(l => inline(l, opts)).join('<br>')}</p>`);
      para = [];
    };
    const flushList = () => {
      if (!list) return;
      const tag = list.type === 'ol' ? 'ol' : 'ul';
      const cls = list.type === 'task' ? ' class="md-tasks"' : '';
      out.push(`<${tag}${cls}>${list.items.join('')}</${tag}>`);
      list = null;
    };
    const flushAll = () => { flushPara(); flushList(); };

    while (i < lines.length) {
      const line = lines[i];

      // 代码块
      const fence = /^```([\w+-]*)\s*$/.exec(line);
      if (fence) {
        flushAll();
        const lang = fence[1];
        const code = [];
        i += 1;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1;
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }

      // 空行
      if (!line.trim()) {
        flushAll();
        i += 1;
        continue;
      }

      // 标题
      const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) {
        flushAll();
        const n = h[1].length;
        out.push(`<h${n}>${inline(h[2], opts)}</h${n}>`);
        i += 1;
        continue;
      }

      // 分割线
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushAll();
        out.push('<hr>');
        i += 1;
        continue;
      }

      // 表格
      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushAll();
        const head = splitRow(line);
        const sep = splitRow(lines[i + 1]);
        const align = sep.map(c => {
          const l = c.startsWith(':');
          const r = c.endsWith(':');
          if (l && r) return 'center';
          if (r) return 'right';
          if (l) return 'left';
          return '';
        });
        const cell = (tag, text, idx) => {
          const a = align[idx] ? ` style="text-align:${align[idx]}"` : '';
          return `<${tag}${a}>${inline(text, opts)}</${tag}>`;
        };
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i += 1;
        }
        out.push('<div class="md-table-wrap"><table><thead><tr>' +
          head.map((c, n) => cell('th', c, n)).join('') +
          '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + head.map((_, n) => cell('td', r[n] || '', n)).join('') + '</tr>').join('') +
          '</tbody></table></div>');
        continue;
      }

      // 引用
      if (/^>\s?/.test(line)) {
        flushAll();
        const quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ''));
          i += 1;
        }
        out.push(`<blockquote>${quote.map(q => inline(q, opts)).join('<br>')}</blockquote>`);
        continue;
      }

      // 列表
      const li = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
      if (li) {
        flushPara();
        const ordered = /\d/.test(li[2]);
        const task = /^\[([ xX])\]\s+(.*)$/.exec(li[3]);
        const type = task ? 'task' : ordered ? 'ol' : 'ul';
        if (!list || list.type !== type) {
          flushList();
          list = { type, items: [] };
        }
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          list.items.push(
            `<li class="md-task${checked ? ' is-done' : ''}">` +
            `<span class="md-check">${checked ? '✓' : ''}</span>` +
            `<span>${inline(task[2], opts)}</span></li>`
          );
        } else {
          list.items.push(`<li>${inline(li[3], opts)}</li>`);
        }
        i += 1;
        continue;
      }

      // 段落
      flushList();
      para.push(line);
      i += 1;
    }

    flushAll();
    return out.join('\n');
  }

  window.Markdown = { render, escapeHtml };
})();
