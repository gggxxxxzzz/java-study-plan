/* 交互逻辑：勾任务、环形进度、日历、截图笔记、底部网站栏、实时时钟
   任务勾选仍存 localStorage（javaplan.tasks.v1）。
   笔记不走 localStorage：截图和 笔记.md 落在本地 notes/YYYY-MM-DD/ 文件夹，
   由本地 Node 服务（server.js）调用 DeepSeek 生成。 */
(() => {
  'use strict';

  const PLAN_ZH = window.PLAN;
  const SITES_ZH = window.STUDY_SITES;
  const LS_TASKS = 'javaplan.tasks.v1';
  const RING_LEN = 2 * Math.PI * 38;          // 238.76
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function dateLabel(d) {
    const zh = `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEK[d.getDay()]}`;
    return (window.I18N && I18N.lang === 'en') ? I18N.t(zh) : zh;
  }
  const MAX_SHOTS = 10;
  const MAX_SHOT_BYTES = 26 * 1024 * 1024;

  /* ---------------- 小工具 ---------------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayStr = () => ymd(new Date());
  const fmtCn = s => { const d = parse(s); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`; };
  const fmtFull = s => { const d = parse(s); return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${WEEK[d.getDay()]}`; };
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function loadLS(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function saveLS(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function stripMd(text) {
    return String(text || '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/[*_`>#=~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const PLAN_DATES = Object.keys(PLAN.days).sort();
  const LAST_DATE = PLAN_DATES[PLAN_DATES.length - 1];

  /* ---------------- 状态 ---------------- */
  const state = {
    view: 'today',
    miniMonth: null,   // {y, m}
    calMonth: null,
    calSel: null,
    tasks: loadLS(LS_TASKS, {}),   // { 'YYYY-MM-DD': {0:1, 2:1} }
    ver: 0,                        // 数据版本号：变了才重渲染
    viewVer: null                  // 各视图已渲染到的版本
  };

  const notes = {
    date: todayStr(),
    days: [],
    note: null,
    shots: [],
    chats: {},          // date -> [{ role, text, time }]
    status: null,       // /api/status 的结果
    loadSeq: 0,
    busy: false,
    chatBusy: false,
    editIndex: null,
    editBusy: false,
    saveMsg: { text: '', type: '' }
  };

  /* ---------------- 进度工具 ---------------- */
  const doneMap = date => state.tasks[date] || {};
  const isDone = (date, i) => !!doneMap(date)[i];

  function doneCount(date) {
    const p = PLAN.days[date];
    if (!p) return 0;
    return p.tasks.reduce((n, _, i) => n + (isDone(date, i) ? 1 : 0), 0);
  }
  function statusOf(date) {
    const p = PLAN.days[date];
    if (!p) return 'rest';
    const c = doneCount(date);
    if (c === 0) return 'plan';
    return c === p.tasks.length ? 'done' : 'part';
  }

  function toggleTask(date, i) {
    touchData();
    if (!PLAN.days[date]) return;
    const rec = state.tasks[date] || (state.tasks[date] = {});
    if (rec[i]) delete rec[i]; else rec[i] = 1;
    if (!Object.keys(rec).length) delete state.tasks[date];
    saveLS(LS_TASKS, state.tasks);
    if (state.view === 'today') renderToday();
    renderMini();
    if (state.view === 'calendar') { renderCalendar(); renderDetail(state.calSel); }
    const p = PLAN.days[date];
    if (p && doneCount(date) === p.tasks.length) toast('今天的任务全部完成了');
  }

  /* ---------------- 本地服务 API ---------------- */
  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      throw new Error('连不上本地服务');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* 空响应 */ }
    if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
    return data;
  }

  function setServer(ok, status) {
    const dot = $('#serverDot');
    if (!dot) return;
    dot.classList.toggle('is-on', !!ok);
    dot.classList.toggle('is-off', !ok);
    if (!ok) { dot.title = '本地服务没启动'; return; }
    const s = status || notes.status;
    dot.title = s && s.mock
      ? '本地服务已连接 · 模拟模式'
      : s && s.hasKey ? `本地服务已连接 · DeepSeek ${s.model}` : '本地服务已连接 · 还没填 API Key';
  }

  async function loadStatus() {
    try {
      const s = await api('/api/status');
      notes.status = s;
      setServer(true, s);
      return s;
    } catch (e) {
      notes.status = null;
      setServer(false);
      return null;
    }
  }

  async function ensureServer() {
    if (notes.status) return true;
    const s = await loadStatus();
    if (!s) {
      toast('本地服务没启动：双击「启动.command」，或运行 node server.js');
      return false;
    }
    return true;
  }

  /* ---------------- 渲染：任务列表 ---------------- */
  function taskNode(date, task, i) {
    const li = document.createElement('li');
    li.className = 'task' + (isDone(date, i) ? ' done' : '');

    const box = document.createElement('button');
    box.className = 'check';
    box.type = 'button';
    box.setAttribute('aria-label', isDone(date, i) ? '取消完成' : '标记完成');
    box.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.6 9.4 17.5 19.5 7"/></svg>';
    box.addEventListener('click', () => toggleTask(date, i));

    const body = document.createElement('div');
    body.className = 'task-body';
    const txt = document.createElement('p');
    txt.className = 'task-text';
    txt.textContent = task.t;
    const min = document.createElement('span');
    min.className = 'task-min';
    min.textContent = `约 ${task.m} 分钟`;
    body.append(txt, min);

    li.append(box, body);
    return li;
  }

  function renderTasks(list, date, p) {
    list.textContent = '';
    if (!p) return;
    p.tasks.forEach((task, i) => list.append(taskNode(date, task, i)));
  }

  function renderLinks(box, links) {
    box.textContent = '';
    (links || []).forEach(l => {
      const a = document.createElement('a');
      a.className = 'link-chip';
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.3 1.3"/><path d="M13.4 10.6a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.3-1.3"/></svg>';
      a.append(document.createTextNode(l.name));
      box.append(a);
    });
  }

  /* ---------------- 渲染：今天 ---------------- */
  function renderToday() {
    const ds = todayStr();
    const p = PLAN.days[ds];
    const now = new Date();

    $('#todayEyebrow').textContent = `${(window.I18N && I18N.lang === 'en') ? 'Today' : '今天'} · ${dateLabel(now)}`;

    const ringFg = $('.ring-fg');
    const ringNum = $('#todayRingNum');
    const tasks = $('#todayTasks');
    const tip = $('#todayTip');

    if (p) {
      $('#todayTopic').textContent = p.topic;
      $('#todayFocus').textContent = p.focus;
      const done = doneCount(ds);
      const total = p.tasks.length;
      const pct = Math.round(done / total * 100);

      ringFg.style.strokeDasharray = RING_LEN;
      ringFg.style.strokeDashoffset = RING_LEN * (1 - done / total);
      ringNum.textContent = pct + '%';

      $('#pillStage').textContent = p.stage || '';
      $('#pillStage').style.display = p.stage ? '' : 'none';
      $('#pillDay').textContent = `第 ${p.n} / ${PLAN_DATES.length} 天`;
      $('#pillCount').textContent = `${done} / ${total} 项`;
      const totalMin = p.tasks.reduce((n, t) => n + t.m, 0);
      $('#pillTime').textContent = `约 ${totalMin} 分钟`;

      renderTasks(tasks, ds, p);
      tip.textContent = p.tip || '';
      tip.style.display = p.tip ? '' : 'none';
    } else {
      const next = PLAN_DATES.find(d => d > ds);
      const after = ds > LAST_DATE;

      $('#todayTopic').textContent = after ? '这一轮计划走完了' : '今天没有排任务';
      $('#todayFocus').textContent = after
        ? `${PLAN_DATES.length} 天已经全部过完。可以回头把没勾完的任务补上，或者直接开下一轮：并发、JVM 或 Spring。`
        : `自由安排也行：复习错题、补笔记，或者提前看下一节「${PLAN.days[next].topic}」（${fmtCn(next)}）。`;

      ringFg.style.strokeDashoffset = RING_LEN;
      ringNum.textContent = '0%';
      $('#pillStage').style.display = 'none';
      $('#pillDay').textContent = after ? `共 ${PLAN_DATES.length} 天` : '计划外';
      $('#pillCount').textContent = '0 项';
      $('#pillTime').textContent = '自由安排';

      tasks.textContent = '';
      tip.style.display = 'none';
    }
  }

  /* ---------------- 渲染：小日历 ---------------- */
  function monthCells(y, m) {
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7;          // 周一为一周起点
    const days = new Date(y, m + 1, 0).getDate();
    const total = Math.ceil((offset + days) / 7) * 7;
    const cells = [];
    for (let i = 0; i < total; i++) {
      const d = new Date(y, m, i - offset + 1);
      cells.push({
        date: ymd(d),
        day: d.getDate(),
        mute: d.getMonth() !== m
      });
    }
    return cells;
  }

  function renderMini() {
    const base = state.miniMonth || (() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; })();
    state.miniMonth = base;
    $('#miniMonth').textContent = `${base.y} 年 ${base.m + 1} 月`;

    const grid = $('#miniGrid');
    grid.textContent = '';
    const today = todayStr();

    monthCells(base.y, base.m).forEach(c => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'mini-cell';
      el.textContent = c.day;
      if (c.mute) el.classList.add('mute');
      if (PLAN.days[c.date]) el.classList.add('has-plan');
      if (statusOf(c.date) === 'done') el.classList.add('done');
      if (c.date === today) el.classList.add('today');
      el.addEventListener('click', () => openCalendar(c.date));
      grid.append(el);
    });
  }

  /* ---------------- 渲染：完整日历 ---------------- */
  function renderCalendar() {
    const base = state.calMonth || (() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; })();
    state.calMonth = base;
    $('#calMonth').textContent = `${base.y} 年 ${base.m + 1} 月`;

    const wrap = $('#calDays');
    wrap.textContent = '';
    const today = todayStr();

    monthCells(base.y, base.m).forEach(c => {
      const p = PLAN.days[c.date];
      const status = statusOf(c.date);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cal-cell';
      if (c.mute) el.classList.add('mute');
      if (c.date === today) el.classList.add('today');
      if (c.date === state.calSel) el.classList.add('sel');

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = c.day;
      el.append(num);

      if (p) {
        const done = doneCount(c.date);
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = p.topic;
        el.append(tag);

        if (done > 0) {
          const bar = document.createElement('div');
          bar.className = 'bar';
          const fill = document.createElement('i');
          fill.style.width = Math.round(done / p.tasks.length * 100) + '%';
          bar.append(fill);
          el.append(bar);
        }
        if (status === 'done') el.style.background = 'linear-gradient(165deg,rgba(47,191,113,.16),rgba(47,191,113,.06))';
      }

      el.addEventListener('click', () => {
        state.calSel = c.date;
        renderCalendar();
        renderDetail(c.date);
      });
      wrap.append(el);
    });
  }

  /* ---------------- 渲染：日历右侧详情 ---------------- */
  function renderDetail(date) {
    const box = $('#calDetail');
    box.textContent = '';
    if (!date) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '点左边任意一天，这里显示当天要做什么。';
      box.append(p);
      return;
    }

    const d = parse(date);
    const p = PLAN.days[date];

    const head = document.createElement('div');
    head.className = 'detail-date';
    const num = document.createElement('strong');
    num.textContent = d.getDate();
    const meta = document.createElement('span');
    meta.textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 · ${WEEK[d.getDay()]}`;
    head.append(num, meta);
    box.append(head);

    if (!p) {
      const rest = document.createElement('div');
      rest.className = 'rest-box';
      rest.textContent = '这天没有排任务，自由安排。想复习、补笔记、刷两道题都可以，右下角可以直接打开这天的笔记。';
      box.append(rest);
      box.append(noteJump(date));
      return;
    }

    const topic = document.createElement('p');
    topic.className = 'detail-topic';
    topic.textContent = `第 ${p.n} 天 · ${p.topic}`;
    box.append(topic);

    if (p.stage) {
      const stage = document.createElement('p');
      stage.className = 'detail-stage';
      stage.textContent = p.stage;
      box.append(stage);
    }

    const focus = document.createElement('p');
    focus.className = 'detail-focus';
    focus.textContent = p.focus;
    box.append(focus);

    const ul = document.createElement('ul');
    ul.className = 'task-list';
    renderTasks(ul, date, p);
    box.append(ul);

    const done = doneCount(date);
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = `${done} / ${p.tasks.length} 项完成`;
    box.append(pill);

    if (p.tip) {
      const tip = document.createElement('p');
      tip.className = 'tip';
      tip.textContent = p.tip;
      box.append(tip);
    }

    box.append(noteJump(date));
  }

  function noteJump(date) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn glass wide';
    btn.textContent = '打开这天的笔记';
    btn.addEventListener('click', () => {
      if (notes.busy || notes.chatBusy || notes.editBusy) { toast('等这次保存完再切'); return; }
      notes.date = date;
      notes.note = null;
      notes.shots = [];
      notes.saveMsg = { text: '', type: '' };
      setView('notes');
    });
    return btn;
  }

  /* ---------------- 笔记：侧栏 ---------------- */
  function renderNotesSide() {
    $('#notesSideSub').textContent = `notes/${notes.date}/`;
    const ul = $('#notesDays');
    ul.textContent = '';

    const days = notes.days.slice();
    if (!days.some(d => d.date === notes.date)) {
      days.unshift({ date: notes.date, blockCount: 0, imageCount: 0, preview: '' });
    }

    if (!days.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '还没有笔记。贴一张截图保存就会建当天的文件夹。';
      ul.append(li);
      return;
    }

    days.forEach(day => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'notes-day' + (day.date === notes.date ? ' is-active' : '');
      const d = parse(day.date);
      const top = document.createElement('span');
      top.className = 'nd-top';
      const date = document.createElement('strong');
      date.textContent = `${d.getMonth() + 1}-${d.getDate()}`;
      const week = document.createElement('span');
      week.textContent = WEEK[d.getDay()];
      top.append(date, week);
      const meta = document.createElement('span');
      meta.className = 'nd-meta';
      meta.textContent = day.blockCount || day.imageCount
        ? `${day.blockCount} 块 · ${day.imageCount} 张图`
        : '还没有内容';
      btn.append(top, meta);
      btn.addEventListener('click', () => selectNote(day.date));
      li.append(btn);
      ul.append(li);
    });
  }

  /* ---------------- 笔记：正文 ---------------- */
  function localizeNoteHeadings(md) {
    if (!window.I18N || I18N.lang !== 'en') return md;
    return md
      .replace(/^(# .+?) · 学习笔记\s*$/m, '$1 · Study notes')
      .replace(/^(## \d{1,2}:\d{2}) · 截图笔记\s*$/gm, '$1 · Screenshot notes');
  }

  function renderNotesMain() {
    const n = notes.note;
    const date = notes.date;
    $('#notesTitle').textContent = fmtFull(date);

    if (!n) {
      $('#notesMeta').textContent = '正在读取…';
      $('#notesPreview').innerHTML = '';
      $('#notesEmpty').hidden = false;
      return;
    }

    const count = n.blockCount || 0;
    const metaBits = [`${count} 块`, `${n.imageCount || 0} 张截图`];
    if (n.mtime) metaBits.push(`最后保存 ${hhmm(new Date(n.mtime))}`);
    $('#notesMeta').textContent = metaBits.join(' · ');

    $('#notesPreview').innerHTML = count
      ? window.Markdown.render(localizeNoteHeadings(n.markdown), { imageBase: `/notes/${date}/` })
      : '';
    decorateBlockEditors();
    $('#notesEmpty').hidden = count > 0;
  }

  /* 每块右上角的「编辑」按钮 + 手动编辑弹窗 */
  function splitNoteBlocks(md) {
    const lines = String(md || '').split('\n');
    const starts = [];
    let inCode = false;
    lines.forEach((line, i) => {
      if (/^```/.test(line.trim())) { inCode = !inCode; return; }
      if (!inCode && /^##\s+/.test(line)) starts.push(i);
    });
    return starts.map((start, i) => {
      const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
      return {
        heading: lines[start].replace(/^##\s+/, '').trim(),
        body: lines.slice(start + 1, end).join('\n').trim(),
      };
    });
  }

  function decorateBlockEditors() {
    const heads = $('#notesPreview').querySelectorAll('h2');
    heads.forEach((head, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'block-edit-btn';
      btn.dataset.index = String(index);
      btn.textContent = '编辑';
      btn.title = '手动编辑这一块';
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openBlockEditor(index);
      });
      head.append(btn);
    });
  }

  function openBlockEditor(index) {
    if (notes.busy || notes.chatBusy || notes.editBusy) { toast('稍等，正在处理中'); return; }
    const n = notes.note;
    if (!n) return;
    const blocks = splitNoteBlocks(n.markdown);
    const block = blocks[index];
    if (!block) { toast('这一块不存在，点「刷新」再试'); return; }

    notes.editIndex = index;
    const en = window.I18N && I18N.lang === 'en';
    const heading = en ? block.heading.replace('截图笔记', 'Screenshot notes') : block.heading;
    $('#blockEditorHeading').textContent = en ? `${heading} · Only this block` : `${heading} · 只改这一块`;
    $('#blockEditorText').value = block.body;
    $('#blockEditorState').textContent = en
      ? `Block ${index + 1} of ${blocks.length}. Saving replaces only this block's body.`
      : `第 ${index + 1} / ${blocks.length} 块，保存后只替换这一块的正文`;
    $('#blockEditorSave').disabled = false;
    $('#blockModal').hidden = false;
    setTimeout(() => $('#blockEditorText').focus(), 40);
  }

  function closeBlockEditor() {
    if (notes.editBusy) return;
    $('#blockModal').hidden = true;
    notes.editIndex = null;
  }

  async function saveBlockEditor() {
    const index = notes.editIndex;
    if (index === null || notes.editBusy) return;
    const body = $('#blockEditorText').value.trim();
    if (!body) {
      $('#blockEditorState').textContent = '这一块不能是空的。';
      return;
    }

    notes.editBusy = true;
    $('#blockEditorSave').disabled = true;
    $('#blockEditorState').textContent = '正在保存…';
    try {
      const data = await api(`/api/notes/${notes.date}/block`, {
        method: 'POST',
        body: { index, body },
      });
      notes.note = data.note;
      $('#blockModal').hidden = true;
      notes.editIndex = null;
      renderNotesMain();
      scrollToBlock(index);
      toast('已保存这一块');
      refreshDays();
      if (notes.date === todayStr()) refreshMiniNote();
    } catch (e) {
      $('#blockEditorState').textContent = e.message;
    } finally {
      notes.editBusy = false;
      $('#blockEditorSave').disabled = false;
    }
  }

  function scrollToBlock(index) {
    const heads = $('#notesPreview').querySelectorAll('h2');
    const head = heads[index];
    if (head) requestAnimationFrame(() => head.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  /* 保存/聊天后把最新那一块带到眼前（等图片把高度撑开再滚） */
  function scrollPreviewToEnd() {
    const preview = $('#notesPreview');
    const go = () => requestAnimationFrame(() => {
      const heads = preview.querySelectorAll('h2');
      const last = heads[heads.length - 1];
      if (last) last.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    const imgs = Array.from(preview.querySelectorAll('img')).filter(img => !img.complete);
    if (!imgs.length) { setTimeout(go, 30); return; }
    let left = imgs.length;
    const done = () => { if (--left <= 0) go(); };
    imgs.forEach(img => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
    setTimeout(go, 900);
  }

  /* ---------------- 笔记：截图区 ---------------- */
  function renderShotList() {
    const box = $('#shotList');
    box.textContent = '';
    notes.shots.forEach((shot, idx) => {
      const el = document.createElement('div');
      el.className = 'shot';

      const img = document.createElement('img');
      img.src = shot.dataUrl;
      img.alt = shot.name || '截图';
      img.title = '点开看大图';
      img.addEventListener('click', () => openLightbox(shot.dataUrl));

      const tag = document.createElement('span');
      tag.className = 'shot-tag';
      tag.textContent = `${shot.w}×${shot.h}`;

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'shot-rm';
      rm.textContent = '×';
      rm.title = '移除这张';
      rm.setAttribute('aria-label', '移除这张截图');
      rm.addEventListener('click', e => {
        e.stopPropagation();
        notes.shots.splice(idx, 1);
        renderShotList();
        renderCompose();
      });

      el.append(img, tag, rm);
      box.append(el);
    });
  }

  function renderCompose() {
    $('#shotCount').textContent = `${notes.shots.length} / ${MAX_SHOTS}`;
    const busy = notes.busy || notes.chatBusy;
    const btn = $('#saveNote');
    btn.disabled = busy || notes.shots.length === 0;
    btn.classList.toggle('is-busy', notes.busy);
    btn.querySelector('.btn-label').textContent = notes.busy ? 'AI 正在记…' : '手动保存';
    $('#saveStatus').textContent = notes.saveMsg.text || (notes.shots.length ? '放好了就点保存，AI 会马上整理并写进 md。' : '');
    $('#saveStatus').className = 'save-status' + (notes.saveMsg.type ? ' is-' + notes.saveMsg.type : '');

    $$('#quickRow button').forEach(b => { b.disabled = busy; });
    const send = $('#chatSend');
    send.disabled = busy;
    send.textContent = notes.chatBusy ? '…' : '发送';
    $('#chatInput').disabled = busy;
    $('#noteHint').disabled = notes.busy;
  }

  async function addFiles(fileList) {
    if (!(await ensureServer())) return;
    const files = Array.from(fileList).filter(f => /^image\//.test(f.type));
    if (!files.length) { toast('只支持图片文件'); return; }

    const before = notes.shots.length;
    for (const file of files) {
      if (notes.shots.length >= MAX_SHOTS) { toast(`一次最多 ${MAX_SHOTS} 张截图`); break; }
      try {
        const shot = await compressImage(file);
        const total = notes.shots.reduce((n, s) => n + s.bytes, 0) + shot.bytes;
        if (total > MAX_SHOT_BYTES) { toast('截图总量太大了，删掉一两张再放'); break; }
        notes.shots.push(shot);
      } catch (e) {
        toast(`「${file.name || '截图'}」读不出来`);
      }
    }
    const added = notes.shots.length - before;
    if (added > 0) {
      notes.saveMsg = { text: `已加 ${added} 张，点「手动保存」让 AI 开始整理`, type: '' };
      toast(`已加 ${added} 张截图`);
      if (window.innerWidth <= 1080) {
        document.querySelector('.notes-compose').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      notes.saveMsg = { text: '', type: '' };
    }
    renderShotList();
    renderCompose();
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const max = 1400;
          const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/png');
          URL.revokeObjectURL(url);
          resolve({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name || '截图',
            dataUrl,
            bytes: Math.round(dataUrl.length * 0.75),
            w, h,
          });
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  /* ---------------- 笔记：保存 ---------------- */
  async function saveNote() {
    if (notes.busy || notes.chatBusy) return;
    if (!notes.shots.length) { toast('先放一张截图'); return; }
    if (!(await ensureServer())) return;

    const date = notes.date;
    notes.busy = true;
    notes.saveMsg = { text: '正在上传截图，等 AI 看完图就写进来…', type: '' };
    renderCompose();

    try {
      const data = await api(`/api/notes/${date}/save`, {
        method: 'POST',
        body: {
          images: notes.shots.map(s => s.dataUrl),
          hint: $('#noteHint').value.trim(),
        },
      });

      if (notes.date === date) {
        notes.note = data.note;
        notes.shots = [];
        $('#noteHint').value = '';
        notes.saveMsg = { text: `已保存 ${data.heading}，前面的笔记没动`, type: 'ok' };
        renderNotesMain();
        scrollPreviewToEnd();
        renderShotList();
        addChat('sys', `已保存 ${data.heading}，前面的内容原样保留。`, date);
      } else {
        toast(`已保存到 ${date}`);
      }
      refreshDays();
      if (date === todayStr()) refreshMiniNote();
      toast('笔记已保存');
    } catch (e) {
      notes.saveMsg = { text: e.message, type: 'err' };
      toast(e.message);
      if (/API Key/.test(e.message)) openSettings();
    } finally {
      notes.busy = false;
      renderCompose();
    }
  }

  /* ---------------- 笔记：聊天 ---------------- */
  function chatFor(date) {
    if (!notes.chats[date]) notes.chats[date] = [];
    return notes.chats[date];
  }

  function addChat(role, text, date = notes.date) {
    const arr = chatFor(date);
    arr.push({ role, text, time: hhmm(new Date()) });
    if (arr.length > 40) arr.splice(0, arr.length - 40);
    if (notes.date === date) renderChatLog();
  }

  function renderChatLog() {
    const log = $('#chatLog');
    log.textContent = '';

    const tip = document.createElement('p');
    tip.className = 'chat-tip';
    tip.textContent = '下面四个按钮是快捷要求，也可以自己说。改的永远是最新保存的那一块，前面的笔记不会动。';
    log.append(tip);

    (notes.chats[notes.date] || []).forEach(msg => {
      if (msg.role === 'sys') {
        const p = document.createElement('p');
        p.className = 'chat-sys';
        p.textContent = msg.text;
        log.append(p);
        return;
      }
      const row = document.createElement('div');
      row.className = `chat-msg is-${msg.role}`;
      const who = document.createElement('span');
      who.className = 'chat-who';
      who.textContent = msg.role === 'user' ? '你' : msg.role === 'error' ? '出错' : 'AI';
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      if (msg.role === 'assistant') {
        bubble.classList.add('md-body');
        bubble.innerHTML = window.Markdown.render(msg.text, { imageBase: `/notes/${notes.date}/` });
      } else {
        bubble.textContent = msg.text;
      }
      const time = document.createElement('span');
      time.className = 'chat-time';
      time.textContent = msg.time;
      row.append(who, bubble, time);
      log.append(row);
    });

    log.scrollTop = log.scrollHeight;
  }

  async function sendChat(request) {
    request = String(request || '').trim();
    if (!request || notes.busy || notes.chatBusy) return;
    if (!(await ensureServer())) return;

    const n = notes.note;
    if (!n || !n.blockCount) {
      toast('先贴截图保存一次，AI 才知道要改哪一块');
      return;
    }

    const date = notes.date;
    addChat('user', request, date);
    notes.chatBusy = true;
    renderCompose();

    try {
      const data = await api(`/api/notes/${date}/chat`, {
        method: 'POST',
        body: { request },
      });
      if (notes.date === date) {
        notes.note = data.note;
        renderNotesMain();
        scrollPreviewToEnd();
      }
      addChat('assistant', data.body, date);
      addChat('sys', `只改了「${data.heading}」，前面的块没动。`, date);
      refreshDays();
      if (date === todayStr()) refreshMiniNote();
      toast('已修改最后一块');
    } catch (e) {
      addChat('error', e.message, date);
      toast(e.message);
      if (/API Key/.test(e.message)) openSettings();
    } finally {
      notes.chatBusy = false;
      renderCompose();
    }
  }

  /* ---------------- 笔记：日期切换与列表 ---------------- */
  async function loadNote(date) {
    const seq = ++notes.loadSeq;
    try {
      const data = await api(`/api/notes/${date}`);
      if (seq !== notes.loadSeq || notes.date !== date) return;
      notes.note = data.note;
    } catch (e) {
      if (seq !== notes.loadSeq || notes.date !== date) return;
      notes.note = null;
      if (/连不上本地服务/.test(e.message)) setServer(false);
    }
    renderNotesMain();
  }

  async function selectNote(date) {
    if (notes.busy || notes.chatBusy || notes.editBusy) { toast('等这次保存完再切'); return; }
    $('#blockModal').hidden = true;
    notes.editIndex = null;
    notes.date = date;
    notes.note = null;
    notes.shots = [];
    notes.saveMsg = { text: '', type: '' };
    $('#noteHint').value = '';
    renderNotesSide();
    renderNotesMain();
    renderCompose();
    renderShotList();
    renderChatLog();
    await loadNote(date);
  }

  async function refreshDays() {
    try {
      const data = await api('/api/notes/days');
      notes.days = data.days || [];
      renderNotesSide();
    } catch (e) {
      if (/连不上本地服务/.test(e.message)) setServer(false);
    }
  }

  async function refreshMiniNote() {
    const date = todayStr();
    $('#miniNoteFolder').textContent = `notes/${date}/`;
    try {
      const data = await api(`/api/notes/${date}`);
      const n = data.note;
      $('#miniNoteCount').textContent = `${n.blockCount} 块 · ${n.imageCount} 张截图`;
      const last = n.blocks[n.blocks.length - 1];
      $('#miniNotePreview').textContent = last
        ? stripMd(last.preview).slice(0, 80)
        : '还没有截图。去「笔记」页拖一张进来，点手动保存就自动整理。';
      const dot = $('#miniNoteState');
      dot.textContent = n.mtime ? `已保存 ${hhmm(new Date(n.mtime))}` : '还没有';
      dot.classList.toggle('is-saved', !!n.mtime);
    } catch (e) {
      $('#miniNoteCount').textContent = '0 块 · 0 张截图';
      $('#miniNotePreview').textContent = '本地服务没启动。双击「启动.command」后才能用 AI 笔记。';
      const dot = $('#miniNoteState');
      dot.textContent = '离线';
      dot.classList.remove('is-saved');
      setServer(false);
    }
  }

  function enterNotes() {
    renderNotesSide();
    renderNotesMain();
    renderCompose();
    renderShotList();
    renderChatLog();
    if (!notes.note || notes.note.date !== notes.date) loadNote(notes.date);
    if (!notes.days.length) refreshDays();
    if (!notes.status) loadStatus();
  }

  /* ---------------- 设置 ---------------- */
  async function openSettings() {
    $('#settingsModal').hidden = false;
    $('#setKey').value = '';
    $('#settingsState').textContent = '正在读取…';
    try {
      const s = await api('/api/status');
      notes.status = s;
      setServer(true, s);
      $('#setBase').value = s.baseUrl;
      $('#setModel').value = s.model;
      $('#setKey').placeholder = s.hasKey ? `已保存 ${s.keyMasked}（留空不改）` : 'sk-…';
      $('#settingsState').textContent = s.mock
        ? '当前是模拟模式（JAVA_NOTES_MOCK=1），不会真的调用 DeepSeek。'
        : s.hasKey
          ? `Key 已配置${s.fromEnv ? '（来自环境变量）' : ''}，模型 ${s.model}。`
          : '还没配置 Key。填好后点「保存」，再回笔记页保存一张截图试试。';
    } catch (e) {
      $('#settingsState').textContent = '本地服务没启动，先双击「启动.command」。';
    }
  }

  function closeSettings() {
    $('#settingsModal').hidden = true;
  }

  async function saveSettings() {
    const body = {
      baseUrl: $('#setBase').value.trim() || 'https://api.deepseek.com',
      model: $('#setModel').value.trim() || 'deepseek-flash',
    };
    const key = $('#setKey').value.trim();
    if (key) body.apiKey = key;

    $('#settingsState').textContent = '正在保存…';
    try {
      await api('/api/config', { method: 'POST', body });
      toast('设置已保存');
      closeSettings();
      await loadStatus();
      refreshMiniNote();
      if (!notes.note) loadNote(notes.date);
    } catch (e) {
      $('#settingsState').textContent = e.message;
    }
  }

  async function testKey() {
    const body = {
      baseUrl: $('#setBase').value.trim(),
      model: $('#setModel').value.trim(),
    };
    const key = $('#setKey').value.trim();
    if (key) body.apiKey = key;
    $('#settingsState').textContent = '正在连接 DeepSeek…';
    $('#testKey').disabled = true;
    try {
      const data = await api('/api/config/test', { method: 'POST', body });
      if (data.ok) {
        $('#settingsState').textContent = `连接成功，可用模型：${(data.models || []).slice(0, 5).join('、') || data.model}`;
      } else {
        $('#settingsState').textContent = `连接失败：${data.error}`;
      }
    } catch (e) {
      $('#settingsState').textContent = e.message;
    } finally {
      $('#testKey').disabled = false;
    }
  }

  /* ---------------- 看大图 ---------------- */
  function openLightbox(src) {
    $('#lightboxImg').src = src;
    $('#lightbox').hidden = false;
  }
  function closeLightbox() {
    $('#lightbox').hidden = true;
    $('#lightboxImg').src = '';
  }

  /* ---------------- 底部网站栏 ---------------- */
  function dockTag(url) {
    let host = '';
    try { host = new URL(url).hostname; } catch (e) { return '文档'; }
    if (/bilibili|youtube/.test(host)) return '视频';
    if (/leetcode|nowcoder/.test(host)) return '刷题';
    return '文档';
  }

  function renderDock() {
    const box = $('#dockLinks');
    box.textContent = '';
    const plan = PLAN.days[todayStr()];
    const items = [];
    const seen = {};
    const push = (name, url, tag) => {
      if (!url || seen[url]) return;
      seen[url] = 1;
      items.push({ name: name, url: url, tag: tag });
    };
    /* 底栏只放「大链接」：当天的视频 + 学习网站首页；细分的章节小链接不再塞进来 */
    const dayLinks = (plan && plan.links ? plan.links : []).slice();
    const video = dayLinks.find(l => dockTag(l.url) === '视频');
    if (video) push(video.name, video.url, '视频');
    STUDY_SITES.forEach(s => push(s.name, s.url, s.tag || '网站'));
    items.forEach(item => {
      const a = document.createElement('a');
      a.className = 'link-chip';
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.append(document.createTextNode(item.name));
      const em = document.createElement('em');
      em.textContent = item.tag;
      a.append(em);
      box.append(a);
    });
  }

  /* ---------------- 视图切换 ---------------- */
  /* 任务视图渲染一次就缓存，只有数据变了（state.ver 递增）才重建 DOM */
  function touchData() { state.ver = (state.ver || 0) + 1; }
  function viewFresh(name) { return state.viewVer && state.viewVer[name] === state.ver; }
  function markFresh(name) { state.viewVer = state.viewVer || {}; state.viewVer[name] = state.ver; }

  function renderView(name) {
    if (name === 'today') { renderToday(); markFresh('today'); }
    if (name === 'calendar') { renderCalendar(); renderDetail(state.calSel); markFresh('calendar'); }
    if (name === 'notes') enterNotes();
  }

  /* ---------------- 中英文切换 ---------------- */
  function applyPlanLang(lang) {
    const en = lang === 'en';
    window.PLAN = en && window.PLAN_EN ? window.PLAN_EN : PLAN_ZH;
    window.STUDY_SITES = en && window.STUDY_SITES_EN ? window.STUDY_SITES_EN : SITES_ZH;
    const brandTitle = $('#brandTitle');
    const brandSub = $('#brandSub');
    if (brandTitle) brandTitle.textContent = window.PLAN.title;
    if (brandSub) brandSub.textContent = window.PLAN.subtitle;
    document.title = en ? 'Backend Career Roadmap · Daily Plan' : '后端就业学习路线 · 每日计划';
  }

  function rerenderAll() {
    state.viewVer = {};
    renderDock();
    renderToday();
    renderMini();
    renderCalendar();
    renderDetail(state.calSel || todayStr());
    renderNotesSide();
    renderNotesMain();
    renderCompose();
    renderShotList();
    renderChatLog();
    state.viewVer = { today: state.ver, calendar: state.ver };
    if (state.view === 'notes') enterNotes();
    if (window.I18N) I18N.refresh();
  }

  function switchLanguage() {
    const next = (window.I18N && I18N.lang === 'en') ? 'zh' : 'en';
    applyPlanLang(next);
    if (window.I18N) I18N.setLang(next);
    rerenderAll();
    refreshMiniNote();
    if (!$('#settingsModal').hidden) openSettings();
    $('#blockModal').hidden = true;
    notes.editIndex = null;
    if (window.I18N) I18N.refresh();
    toast(next === 'en' ? 'English · switch back anytime' : '已切回中文');
  }

  function setView(name) {
    if (state.view === name) {
      if (name === 'notes') enterNotes();
      return;
    }
    state.view = name;
    document.body.dataset.view = name;

    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === name));
    $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));

    if (name === 'notes') { enterNotes(); return; }
    if (!viewFresh(name)) requestAnimationFrame(() => renderView(name));
  }

  function openCalendar(date) {
    const d = parse(date);
    state.calMonth = { y: d.getFullYear(), m: d.getMonth() };
    state.calSel = date;
    setView('calendar');
  }

  /* ---------------- 提示条 ---------------- */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------------- 时钟 + 跨天 ---------------- */
  let lastDay = todayStr();
  function tick() {
    const now = new Date();
    $('#clockTime').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    $('#clockDate').textContent = dateLabel(now);
    const ds = ymd(now);
    if (ds !== lastDay) {
      const prev = lastDay;
      lastDay = ds;
      renderToday();
      renderMini();
      if (state.view === 'calendar') renderCalendar();
      refreshMiniNote();
      if (notes.date === prev) {
        notes.date = ds;
        notes.note = null;
        notes.shots = [];
        renderNotesSide();
        renderNotesMain();
        renderCompose();
        renderShotList();
        renderChatLog();
        loadNote(ds);
      }
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
    const langBtn = $('#langToggle');
    if (langBtn) langBtn.addEventListener('click', switchLanguage);

    $('#miniPrev').addEventListener('click', () => { state.miniMonth.m--; if (state.miniMonth.m < 0) { state.miniMonth.m = 11; state.miniMonth.y--; } renderMini(); });
    $('#miniNext').addEventListener('click', () => { state.miniMonth.m++; if (state.miniMonth.m > 11) { state.miniMonth.m = 0; state.miniMonth.y++; } renderMini(); });
    $('#goCalendar').addEventListener('click', () => openCalendar(state.calSel || todayStr()));

    $('#calPrev').addEventListener('click', () => { state.calMonth.m--; if (state.calMonth.m < 0) { state.calMonth.m = 11; state.calMonth.y--; } renderCalendar(); markFresh('calendar'); });
    $('#calNext').addEventListener('click', () => { state.calMonth.m++; if (state.calMonth.m > 11) { state.calMonth.m = 0; state.calMonth.y++; } renderCalendar(); markFresh('calendar'); });
    $('#calToday').addEventListener('click', () => openCalendar(todayStr()));

    $('#openNotes').addEventListener('click', () => {
      notes.date = todayStr();
      notes.note = null;
      notes.shots = [];
      notes.saveMsg = { text: '', type: '' };
      setView('notes');
      setTimeout(() => $('#dropZone').focus(), 80);
    });

    /* 笔记：侧栏 */
    $('#notesTodayBtn').addEventListener('click', () => selectNote(todayStr()));
    $('#notesReload').addEventListener('click', async () => {
      await loadNote(notes.date);
      await refreshDays();
      toast('已从磁盘刷新');
    });
    $('#notesOpenFolder').addEventListener('click', async () => {
      if (!(await ensureServer())) return;
      try {
        await api(`/api/notes/${notes.date}/open`, { method: 'POST' });
      } catch (e) { toast(e.message); }
    });
    $('#notesExport').addEventListener('click', () => {
      const n = notes.note;
      if (!n || !n.markdown.trim()) { toast('这一天还没有笔记'); return; }
      const blob = new Blob([n.markdown], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${notes.date}-笔记.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast('已导出 md');
    });

    /* 笔记：加截图 */
    const zone = $('#dropZone');
    const input = $('#fileInput');
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', () => {
      addFiles(input.files);
      input.value = '';
    });

    /* 拖拽：整个笔记页都是投放区，拖到哪儿松手都算数 */
    const notesView = $('#view-notes');
    const hasFiles = e => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    let dragHideTimer = 0;
    function markDrag(on) {
      clearTimeout(dragHideTimer);
      if (on) {
        notesView.classList.add('is-dragging');
      } else {
        dragHideTimer = setTimeout(() => {
          notesView.classList.remove('is-dragging');
          zone.classList.remove('is-drag');
        }, 120);
      }
    }
    document.addEventListener('dragenter', e => {
      if (state.view !== 'notes' || !hasFiles(e)) return;
      e.preventDefault();
      markDrag(true);
    });
    document.addEventListener('dragover', e => {
      if (state.view !== 'notes' || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      markDrag(true);
      if (zone.contains(e.target)) zone.classList.add('is-drag');
    });
    document.addEventListener('dragleave', () => {
      if (state.view !== 'notes') return;
      markDrag(false);
    });
    document.addEventListener('drop', e => {
      if (state.view !== 'notes') return;
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files || []) : [];
      markDrag(false);
      zone.classList.remove('is-drag');
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    });
    document.addEventListener('paste', e => {
      if (state.view !== 'notes') return;
      const items = Array.from((e.clipboardData && e.clipboardData.items) || [])
        .filter(it => /^image\//.test(it.type));
      if (!items.length) return;
      const files = items.map(it => it.getAsFile()).filter(Boolean);
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    });

    /* 笔记：保存 */
    $('#saveNote').addEventListener('click', saveNote);
    $('#noteHint').addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveNote(); }
    });

    /* 笔记：聊天 */
    $('#quickRow').addEventListener('click', e => {
      const btn = e.target.closest('button[data-quick]');
      if (btn) sendChat(btn.dataset.quick);
    });
    $('#chatForm').addEventListener('submit', e => {
      e.preventDefault();
      const input = $('#chatInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      sendChat(text);
    });
    $('#chatInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = e.target.value.trim();
        if (!text) return;
        e.target.value = '';
        sendChat(text);
      }
    });

    /* 看大图 */
    $('#notesPreview').addEventListener('click', e => {
      const img = e.target.closest('img');
      if (img) openLightbox(img.src);
    });
    $('#chatLog').addEventListener('click', e => {
      const img = e.target.closest('img');
      if (img) openLightbox(img.src);
    });
    $('#lightbox').addEventListener('click', closeLightbox);

    /* 手动编辑某一块 */
    $('#blockEditorClose').addEventListener('click', closeBlockEditor);
    $('#blockEditorCancel').addEventListener('click', closeBlockEditor);
    $('#blockEditorSave').addEventListener('click', saveBlockEditor);
    $('#blockModal').addEventListener('click', e => {
      if (e.target === $('#blockModal')) closeBlockEditor();
    });

    /* 设置 */
    $('#openSettings').addEventListener('click', openSettings);
    $('#closeSettings').addEventListener('click', closeSettings);
    $('#saveSettings').addEventListener('click', saveSettings);
    $('#testKey').addEventListener('click', testKey);
    $('#settingsModal').addEventListener('click', e => {
      if (e.target === $('#settingsModal')) closeSettings();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!$('#lightbox').hidden) closeLightbox();
        else if (!$('#blockModal').hidden) closeBlockEditor();
        else if (!$('#settingsModal').hidden) closeSettings();
      }
    });

    window.addEventListener('storage', e => {
      if (e.key === LS_TASKS) { state.tasks = loadLS(LS_TASKS, {}); refreshAll(); }
    });

    window.addEventListener('hashchange', () => {
      const h = (location.hash || '').replace('#', '');
      if (h === 'calendar' || h === 'notes' || h === 'today') setView(h);
    });
  }

  function refreshAll() {
    touchData();
    renderToday();
    renderMini();
    if (state.view === 'calendar') { renderCalendar(); renderDetail(state.calSel); }
  }

  /* ---------------- 启动 ---------------- */
  /* ---------------- 玻璃层策略 ----------------
     顶栏 / 底栏：hyalite 真实折射（背后是静止壁纸，只算一次）
     卡片：预烘焙的模糊壁纸背景（wallpaper-blur.jpg），零运行时滤镜
     按钮 / 胶囊 / 勾选框：纯 CSS 半透明 + 描边，不套滤镜 */
  function initGlass() {
    if (!window.Hyalite) return;
    try {
      if (!Hyalite.supported()) return;
      const big = {
        bevel: 32, thickness: 48, slope: 1.15, shape: 'squircle', blur: 1.8,
        dispersion: 1.3, shade: .52, rim: 1.95, edgeW: 9, sat: .94, edge: .55,
        light: -125, smooth: 1, settle: 60, materialize: 260
      };
      $$('.topbar, .dock').forEach(el => Hyalite.attach(el, big));
    } catch (e) { /* 不支持时自动忽略 */ }
  }

  function init() {
    applyPlanLang(window.I18N ? I18N.lang : 'zh');
    const now = new Date();
    state.miniMonth = { y: now.getFullYear(), m: now.getMonth() };
    state.calMonth = { y: now.getFullYear(), m: now.getMonth() };
    state.calSel = todayStr();

    renderDock();
    renderToday();
    renderMini();
    renderCalendar();
    renderDetail(state.calSel);
    renderNotesSide();
    renderNotesMain();
    renderCompose();
    renderChatLog();
    state.viewVer = { today: state.ver, calendar: state.ver };
    initGlass();
    initScrollHint();
    bind();
    tick();
    setInterval(tick, 1000);

    const h = (location.hash || '').replace('#', '');
    if (h === 'calendar' || h === 'notes') setView(h);

    loadStatus().then(() => {
      refreshMiniNote();
      refreshDays();
      loadNote(notes.date);
    });

    if (window.I18N) I18N.refresh();
    const p = PLAN.days[todayStr()];
    setTimeout(() => toast(p ? `今天：${p.topic}` : '今天没有排任务，自由安排'), 400);
  }

  /* ---------------- 左侧滑动条：仅滑动时出现 ---------------- */
  function initScrollHint() {
    const main = document.querySelector('main');
    if (!main) return;
    const hint = document.createElement('div');
    hint.className = 'scroll-hint';
    document.body.appendChild(hint);

    let hideTimer = 0;

    function size() {
      const sh = main.scrollHeight;
      const ch = main.clientHeight;
      if (sh <= ch + 4) { hint.style.display = 'none'; return; }
      hint.style.display = 'block';
      const h = Math.max(36, Math.round(ch * (ch / sh)));
      hint.style.height = h + 'px';
      hint.dataset.max = String(ch - h);
    }

    function place() {
      const r = main.getBoundingClientRect();
      const h = hint.offsetHeight;
      const max = Math.max(1, main.scrollHeight - main.clientHeight);
      hint.style.top = Math.round(r.top + 8) + 'px';
      hint.style.transform = `translateY(${Math.round((r.height - h - 16) * (main.scrollTop / max))}px)`;
    }

    function onScroll() {
      place();
      hint.classList.add('is-on');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => hint.classList.remove('is-on'), 620);
    }

    size();
    place();
    main.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => { size(); place(); });
    /* 视图切换后内容高度会变 */
    $$('.tab').forEach(t => t.addEventListener('click', () => setTimeout(() => { size(); place(); }, 60)));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
