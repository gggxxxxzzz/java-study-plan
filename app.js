/* 交互逻辑：勾任务、环形进度、日历、日记、底部网站栏、实时时钟
   数据存在 localStorage：勾选 javaplan.tasks.v1 / 日记 javaplan.diary.v1 */
(() => {
  'use strict';

  const LS_TASKS = 'javaplan.tasks.v1';
  const LS_DIARY = 'javaplan.diary.v1';
  const RING_LEN = 2 * Math.PI * 38;          // 238.76
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* ---------------- 小工具 ---------------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayStr = () => ymd(new Date());
  const fmtCn = s => { const d = parse(s); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`; };
  const $ = sel => document.querySelector(sel);

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

  const PLAN_DATES = Object.keys(PLAN.days).sort();
  const LAST_DATE = PLAN_DATES[PLAN_DATES.length - 1];

  /* ---------------- 状态 ---------------- */
  const state = {
    view: 'today',
    miniMonth: null,   // {y, m}
    calMonth: null,
    calSel: null,
    diaryDate: null,
    tasks: loadLS(LS_TASKS, {}),   // { 'YYYY-MM-DD': {0:1, 2:1} }
    diary: loadLS(LS_DIARY, {}),   // { 'YYYY-MM-DD': '文本' }
    ver: 0,                        // 数据版本号：变了才重渲染
    viewVer: null                  // 各视图已渲染到的版本
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

    $('#todayEyebrow').textContent = `今天 · ${now.getMonth() + 1} 月 ${now.getDate()} 日 ${WEEK[now.getDay()]}`;

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
        ? '28 天已经全部过完。可以回头把没勾完的任务补上，或者直接开下一轮：并发、JVM 或 Spring。'
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

    renderTodayDiary();
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
      rest.textContent = '这天没有排任务，自由安排。想复习、补笔记、刷两道题都可以，也可以直接在右下角去写日记。';
      box.append(rest);
      box.append(diaryJump(date));
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

    box.append(diaryJump(date));
  }

  function diaryJump(date) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn glass wide';
    btn.textContent = '写这天的日记';
    btn.addEventListener('click', () => {
      state.diaryDate = date;
      setView('diary');
    });
    return btn;
  }

  /* ---------------- 日记 ---------------- */
  function diaryText(date) { return state.diary[date] || ''; }

  function saveDiary(date, text) {
    touchData();
    if (text.trim()) state.diary[date] = text;
    else delete state.diary[date];
    saveLS(LS_DIARY, state.diary);
  }

  function renderTodayDiary() {
    const ds = todayStr();
    const ta = $('#todayDiary');
    ta.value = diaryText(ds);
    $('#todayDiaryCount').textContent = ta.value.trim().length + ' 字';
  }

  function renderDiaryEditor() {
    const date = state.diaryDate || todayStr();
    state.diaryDate = date;
    const ta = $('#diaryBig');
    ta.value = diaryText(date);
    $('#diaryCount').textContent = ta.value.trim().length + ' 字';
    $('#diaryDate').value = date;
    const p = PLAN.days[date];
    $('#diaryTitle').textContent = p ? `${fmtCn(date)} · ${p.topic}` : `${fmtCn(date)} · 日记`;
  }

  function renderDiaryList() {
    const ul = $('#diaryEntries');
    ul.textContent = '';
    const dates = Object.keys(state.diary)
      .filter(d => (state.diary[d] || '').trim())
      .sort()
      .reverse();

    $('#diaryTotal').textContent = dates.length + ' 篇';

    if (!dates.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '还没写过日记。上面写两句就会自动存下来。';
      ul.append(li);
      return;
    }

    dates.forEach(date => {
      const li = document.createElement('li');
      const head = document.createElement('div');
      head.className = 'ed-date';
      const d = parse(date);
      head.textContent = `${fmtCn(date)} · ${WEEK[d.getDay()]}`;
      const pre = document.createElement('div');
      pre.className = 'ed-pre';
      pre.textContent = state.diary[date].replace(/\s+/g, ' ').slice(0, 70);
      li.append(head, pre);
      li.addEventListener('click', () => {
        state.diaryDate = date;
        renderDiaryEditor();
        $('#diaryBig').focus();
      });
      ul.append(li);
    });
  }

  function exportDiary() {
    const dates = Object.keys(state.diary).filter(d => (state.diary[d] || '').trim()).sort();
    if (!dates.length) { toast('还没有可以导出的日记'); return; }
    const body = dates.map(d => {
      const w = WEEK[parse(d).getDay()];
      const topic = PLAN.days[d] ? `（${PLAN.days[d].topic}）` : '';
      return `${d} ${w}${topic}\n${state.diary[d].trim()}\n`;
    }).join('\n');
    const blob = new Blob(['Java 学习日记\n\n' + body], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Java学习日记-${todayStr()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast(`已导出 ${dates.length} 篇日记`);
  }

  /* ---------------- 底部网站栏：今日主线链接 + 学习网站 ---------------- */
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
  /* 每块大视图渲染一次就缓存，只有数据变了（state.ver 递增）才重建 DOM */
  function touchData() { state.ver = (state.ver || 0) + 1; }
  function viewFresh(name) { return state.viewVer && state.viewVer[name] === state.ver; }
  function markFresh(name) { state.viewVer = state.viewVer || {}; state.viewVer[name] = state.ver; }

  function renderView(name) {
    if (name === 'today') { renderToday(); markFresh('today'); }
    if (name === 'calendar') { renderCalendar(); renderDetail(state.calSel); markFresh('calendar'); }
    if (name === 'diary') { renderDiaryEditor(); renderDiaryList(); markFresh('diary'); }
  }

  function setView(name) {
    if (state.view === name) return;
    state.view = name;

    /* 先只做 class 切换：一帧内完成，绝不堆渲染 */
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));

    /* 已有缓存就不再重建，切换只剩一次 display 变化 */
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
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  /* ---------------- 时钟 + 跨天 ---------------- */
  let lastDay = todayStr();
  function tick() {
    const now = new Date();
    $('#clockTime').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    $('#clockDate').textContent = `${now.getMonth() + 1} 月 ${now.getDate()} 日 ${WEEK[now.getDay()]}`;
    const ds = ymd(now);
    if (ds !== lastDay) {
      lastDay = ds;
      state.diaryDate = ds;
      renderToday();
      renderMini();
      if (state.view === 'calendar') renderCalendar();
      if (state.view === 'diary') { renderDiaryEditor(); renderDiaryList(); }
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));

    $('#miniPrev').addEventListener('click', () => { state.miniMonth.m--; if (state.miniMonth.m < 0) { state.miniMonth.m = 11; state.miniMonth.y--; } renderMini(); });
    $('#miniNext').addEventListener('click', () => { state.miniMonth.m++; if (state.miniMonth.m > 11) { state.miniMonth.m = 0; state.miniMonth.y++; } renderMini(); });
    $('#goCalendar').addEventListener('click', () => openCalendar(state.calSel || todayStr()));

    $('#calPrev').addEventListener('click', () => { state.calMonth.m--; if (state.calMonth.m < 0) { state.calMonth.m = 11; state.calMonth.y--; } renderCalendar(); markFresh('calendar'); });
    $('#calNext').addEventListener('click', () => { state.calMonth.m++; if (state.calMonth.m > 11) { state.calMonth.m = 0; state.calMonth.y++; } renderCalendar(); markFresh('calendar'); });
    $('#calToday').addEventListener('click', () => openCalendar(todayStr()));

    $('#openDiary').addEventListener('click', () => { state.diaryDate = todayStr(); setView('diary'); $('#diaryBig').focus(); });
    $('#diaryToday').addEventListener('click', () => { state.diaryDate = todayStr(); renderDiaryEditor(); });
    $('#diaryExport').addEventListener('click', exportDiary);

    const saveTodayDiary = debounce(() => {
      saveDiary(todayStr(), $('#todayDiary').value);
      const dot = $('#miniSaved');
      dot.textContent = '已保存';
      dot.classList.add('is-saved');
    }, 450);

    $('#todayDiary').addEventListener('input', e => {
      $('#todayDiaryCount').textContent = e.target.value.trim().length + ' 字';
      const dot = $('#miniSaved');
      dot.textContent = '正在保存…';
      dot.classList.remove('is-saved');
      saveTodayDiary();
    });

    const saveBigDiary = debounce(() => {
      saveDiary(state.diaryDate, $('#diaryBig').value);
      const dot = $('#diarySaved');
      dot.textContent = '已保存';
      dot.classList.add('is-saved');
      renderDiaryList();
    }, 450);

    $('#diaryBig').addEventListener('input', e => {
      $('#diaryCount').textContent = e.target.value.trim().length + ' 字';
      const dot = $('#diarySaved');
      dot.textContent = '正在保存…';
      dot.classList.remove('is-saved');
      saveBigDiary();
    });

    $('#diaryDate').addEventListener('change', e => {
      state.diaryDate = e.target.value || todayStr();
      renderDiaryEditor();
    });

    window.addEventListener('storage', e => {
      if (e.key === LS_TASKS) { state.tasks = loadLS(LS_TASKS, {}); refreshAll(); }
      if (e.key === LS_DIARY) {
        state.diary = loadLS(LS_DIARY, {});
        renderTodayDiary();
        if (state.view === 'diary') { renderDiaryEditor(); renderDiaryList(); }
      }
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
      document.querySelectorAll('.topbar, .dock').forEach(el => Hyalite.attach(el, big));
    } catch (e) { /* 不支持时自动忽略 */ }
  }

  function init() {
    const now = new Date();
    state.miniMonth = { y: now.getFullYear(), m: now.getMonth() };
    state.calMonth = { y: now.getFullYear(), m: now.getMonth() };
    state.calSel = todayStr();
    state.diaryDate = todayStr();

    renderDock();
    renderToday();
    renderMini();
    renderCalendar();
    renderDetail(state.calSel);
    renderDiaryEditor();
    renderDiaryList();
    state.viewVer = { today: state.ver, calendar: state.ver, diary: state.ver };
    initGlass();
    initScrollHint();
    bind();
    tick();
    setInterval(tick, 1000);

    const h = (location.hash || '').replace('#', '');
    if (h === 'calendar' || h === 'diary') setView(h);

    const p = PLAN.days[todayStr()];
    toast(p ? `今天：${p.topic}` : '今天没有排任务，自由安排');
  }

  /* ---------------- 左侧滑动条：仅滑动时出现 ---------------- */
  function initScrollHint() {
    const main = document.querySelector('main');
    if (!main) return;
    const hint = document.createElement('div');
    hint.className = 'scroll-hint';
    document.body.appendChild(hint);

    let hideTimer = 0;
    let raf = 0;

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
      const y = r.top + 8 + (r.height - h - 16) * (main.scrollTop / max);
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
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setTimeout(() => { size(); place(); }, 60)));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
