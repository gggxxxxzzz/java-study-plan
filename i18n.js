/* UI 中英文切换：中文原文做 key，英文写在字典里。
   静态页面和 JS 动态生成的文字都靠同一个翻译层处理；
   用户笔记正文（#notesPreview / #chatLog / 笔记摘要）不翻译。 */
(() => {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKS = { 日: 'Sun', 一: 'Mon', 二: 'Tue', 三: 'Wed', 四: 'Thu', 五: 'Fri', 六: 'Sat' };
  const month = (m, short) => (short ? MONTHS_SHORT : MONTHS)[m - 1];

  /* ---- 整句 / 短标签 ---- */
  const DICT = {
    '今天': 'Today',
    '日历': 'Calendar',
    '笔记': 'Notes',
    '打开完整日历': 'Open full calendar',
    '打开笔记': 'Open notes',
    '今日笔记': "Today's notes",
    '今日链接': "Today's links",

    '全部完成': 'All done',
    '进行中': 'In progress',
    '有计划': 'Planned',
    '自由安排': 'Free',
    '一': 'M', '二': 'T', '三': 'W', '四': 'T', '五': 'F', '六': 'S', '日': 'S',

    '每天一个文件夹': 'One folder per day',
    '打开当天文件夹': "Open today's folder",
    '刷新': 'Refresh',
    '导出 md': 'Export md',
    '这一天还没有笔记': 'No notes for this day yet',
    '加截图': 'Add screenshots',
    '手动保存': 'Save now',
    '拖进来，或 ': 'Drop it here, or ',
    '选择截图': 'choose screenshots',
    '拖到框里就加进来 · 也可以直接粘贴': 'Drop it anywhere in the box, or paste directly',
    '补充一句（可选）：这页重点是…': 'Add a note (optional): the key point is…',
    '让 AI 改最后一块': 'Ask AI to revise the last block',
    '只动最新块': 'Latest block only',
    '更简短': 'Shorter',
    '换一句': 'Rephrase',
    '高亮语句': 'Highlight',
    '下面四个按钮是快捷要求，也可以自己说。改的永远是最新保存的那一块，前面的笔记不会动。':
      'The four buttons are quick requests. You can also type below. Only the latest saved block changes — earlier notes stay put.',
    '比如：第二个例子再短一点': 'e.g. make the second example shorter',
    '发送': 'Send',
    '松手，截图就加进来': 'Drop it — screenshots go in',
    '拖到笔记页任意位置都行 · 一次最多 10 张': 'Anywhere on the Notes page · up to 10 at a time',

    'DeepSeek 设置': 'DeepSeek settings',
    'API Key': 'API Key',
    'API 地址': 'API base URL',
    '模型': 'Model',
    '测试连接': 'Test connection',
    '保存': 'Save',
    '关闭': 'Close',
    '编辑这一块': 'Edit this block',
    '这一块的 Markdown 正文…': 'Markdown body of this block…',
    '取消': 'Cancel',
    '保存这一块': 'Save block',
    '编辑': 'Edit',
    '手动编辑这一块': 'Edit this block manually',
    '上个月': 'Previous month',
    '下个月': 'Next month',
    '设置': 'Settings',
    '添加截图': 'Add screenshots',
    '移除这张': 'Remove',
    '移除这张截图': 'Remove this screenshot',
    '点开看大图': 'Click to enlarge',
    '截图': 'Screenshot',

    '点左边任意一天，这里显示当天要做什么。': 'Click any day on the left to see what is planned.',
    '这天没有排任务，自由安排。想复习、补笔记、刷两道题都可以，右下角可以直接打开这天的笔记。':
      'No tasks scheduled — free time. Review, add notes, or solve a couple of problems; the button below opens the day\u2019s notes.',
    '打开这天的笔记': "Open this day's notes",
    '还没有笔记。贴一张截图保存就会建当天的文件夹。': 'No notes yet. Drop a screenshot and save to create this day\u2019s folder.',
    '还没有截图。去「笔记」页拖一张进来，点手动保存就自动整理。':
      'No screenshots yet. Drop one on the Notes page and hit Save — the AI will organize it.',
    '还没有内容': 'Nothing yet',
    '还没有': 'Not yet',
    '离线': 'Offline',
    '本地服务没启动。双击对应系统的启动文件后才能用 AI 笔记。':
      'Local server is off. Double-click the launcher for your OS to use AI notes.',
    '本地服务没启动，先双击对应系统的启动文件。': 'Local server is off. Double-click the launcher for your OS first.',
    '本地服务没启动：macOS 双击「启动.command」，Windows 双击「启动-Windows.bat」':
      'Local server is off: on macOS double-click 启动.command; on Windows double-click 启动-Windows.bat.',
    '本地服务没启动': 'Local server is off',
    '本地服务已连接 · 模拟模式': 'Local server connected · mock mode',
    '连不上本地服务': 'Cannot reach the local server',
    '今天的任务全部完成了': 'All of today\u2019s tasks are done',
    '取消完成': 'Mark as not done',
    '标记完成': 'Mark as done',
    '你': 'You',
    '出错': 'Error',
    'AI': 'AI',
    '正在读取…': 'Loading…',
    '正在保存…': 'Saving…',
    '正在连接 DeepSeek…': 'Connecting to DeepSeek…',
    '正在上传截图，等 AI 看完图就写进来…': 'Uploading screenshots; the AI will write once it reads them…',
    'AI 正在记…': 'AI is writing…',
    '稍等，正在处理中': 'One moment — still processing',
    '等这次保存完再切': 'Wait for this save to finish before switching',
    '笔记已保存': 'Notes saved',
    '设置已保存': 'Settings saved',
    '已从磁盘刷新': 'Reloaded from disk',
    '已保存这一块': 'Block saved',
    '已修改最后一块': 'Last block updated',
    '已导出 md': 'Exported md',
    '先放一张截图': 'Add a screenshot first',
    '先贴截图保存一次，AI 才知道要改哪一块': 'Save a screenshot first so the AI knows which block to edit',
    '只支持图片文件': 'Images only',
    '截图总量太大了，删掉一两张再放': 'Too much image data — remove a screenshot or two',
    '这一块不能是空的。': 'This block cannot be empty.',
    '这一块不存在，点「刷新」再试': 'Block not found — hit Refresh and try again',
    '放好了就点保存，AI 会马上整理并写进 md。': 'When ready, hit Save — the AI will organize it into the md file.',
    '当前是模拟模式（JAVA_NOTES_MOCK=1），不会真的调用 DeepSeek。':
      'Mock mode is on (JAVA_NOTES_MOCK=1); DeepSeek is not actually called.',
    '还没配置 Key。填好后点「保存」，再回笔记页保存一张截图试试。':
      'No API key yet. Enter one, hit Save, then try saving a screenshot on the Notes page.',
    '这一轮计划走完了': 'The plan is complete',
    '今天没有排任务': 'Nothing scheduled today',
    '计划外': 'Off plan',
    '视频': 'Video',
    '文档': 'Docs',
    '刷题': 'Practice',
    '网站': 'Site',
    '0 项': '0 tasks',
    '回到今天': 'Back to today',
    '润色': 'Polish',
    '关键点': 'Key point'
  };

  /* ---- 数字/日期等模板句 ---- */
  const PATTERNS = [
    [/^今天 · (\d{1,2}) 月 (\d{1,2}) 日 (周[日一二三四五六])$/, m => `Today · ${month(+m[1], true)} ${+m[2]}, ${WEEKS[m[3][1]]}`],
    [/^(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日 · (周[日一二三四五六])$/, m => `${month(+m[2])} ${+m[3]}, ${m[1]} · ${WEEKS[m[4][1]]}`],
    [/^(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日$/, m => `${month(+m[2])} ${+m[3]}, ${m[1]}`],
    [/^(\d{4}) 年 (\d{1,2}) 月$/, m => `${month(+m[2])} ${m[1]}`],
    [/^(\d{4}) 年 (\d{1,2}) 月 · (周[日一二三四五六])$/, m => `${month(+m[2])} ${m[1]} · ${WEEKS[m[3][1]]}`],
    [/^(\d{1,2}) 月 (\d{1,2}) 日 (周[日一二三四五六])$/, m => `${month(+m[1], true)} ${+m[2]}, ${WEEKS[m[3][1]]}`],
    [/^(\d{1,2}) 月 (\d{1,2}) 日$/, m => `${month(+m[1], true)} ${+m[2]}`],
    [/^(周[日一二三四五六])$/, m => WEEKS[m[1][1]]],

    [/^第 (\d+) \/ (\d+) 天$/, m => `Day ${m[1]} / ${m[2]}`],
    [/^第 (\d+) 天 · (.*)$/, m => `Day ${m[1]} · ${m[2]}`],
    [/^共 (\d+) 天$/, m => `${m[1]} days total`],
    [/^约 (\d+) 分钟$/, m => `~${m[1]} min`],
    [/^(\d+) \/ (\d+) 项完成$/, m => `${m[1]} / ${m[2]} done`],
    [/^(\d+) \/ (\d+) 项$/, m => `${m[1]} / ${m[2]} tasks`],

    [/^(\d+) 块 · (\d+) 张截图 · 最后保存 (\d{1,2}:\d{2})$/, m => `${m[1]} block${+m[1] === 1 ? '' : 's'} · ${m[2]} image${+m[2] === 1 ? '' : 's'} · last saved ${m[3]}`],
    [/^(\d+) 块 · (\d+) 张截图$/, m => `${m[1]} block${+m[1] === 1 ? '' : 's'} · ${m[2]} image${+m[2] === 1 ? '' : 's'}`],
    [/^(\d+) 块 · (\d+) 张图$/, m => `${m[1]} block${+m[1] === 1 ? '' : 's'} · ${m[2]} image${+m[2] === 1 ? '' : 's'}`],
    [/^最后保存 (\d{1,2}:\d{2})$/, m => `Last saved ${m[1]}`],
    [/^已保存 (\d{1,2}:\d{2})$/, m => `Saved ${m[1]}`],
    [/^已保存到 (.+)$/, m => `Saved to ${m[1]}`],
    [/^已保存 (.+)（留空不改）$/, m => `Saved ${m[1]} (leave blank to keep)`],

    [/^已加 (\d+) 张截图$/, m => `Added ${m[1]} screenshot${+m[1] === 1 ? '' : 's'}`],
    [/^已加 (\d+) 张，点「手动保存」让 AI 开始整理$/, m => `Added ${m[1]}. Hit Save and the AI will start.`],
    [/^一次最多 (\d+) 张截图$/, m => `Up to ${m[1]} screenshots at a time`],
    [/^「(.+)」读不出来$/, m => `Could not read “${m[1]}”`],

    [/^第 (\d+) \/ (\d+) 块，保存后只替换这一块的正文$/, m => `Block ${m[1]} / ${m[2]} — only this block\u2019s text is replaced`],
    [/^(.+) · 只改这一块$/, m => `${m[1]} · editing this block only`],

    [/^已保存 (.+)，前面的笔记没动$/, m => `Saved ${m[1]}. Earlier notes untouched.`],
    [/^已保存 (.+)，前面的内容原样保留。$/, m => `Saved ${m[1]}. Earlier content untouched.`],
    [/^只改了「(.+)」，前面的块没动。$/, m => `Only “${m[1]}” changed; earlier blocks untouched.`],

    [/^关键点 · (.+)$/, m => `Key point · ${translate(m[1]) || m[1]}`],
    [/^今天：(.+)$/, m => `Today: ${m[1]}`],
    [/^连接失败：(.+)$/, m => `Connection failed: ${m[1]}`],
    [/^连接成功，可用模型：(.+)$/, m => `Connected. Models: ${m[1]}`],
    [/^请求失败（(\d+)）$/, m => `Request failed (${m[1]})`],
    [/^Key 已配置（来自环境变量），模型 (.+)。$/, m => `Key configured (from environment), model ${m[1]}.`],
    [/^Key 已配置，模型 (.+)。$/, m => `Key configured, model ${m[1]}.`],
    [/^本地服务已连接 · DeepSeek (.+)$/, m => `Local server connected · DeepSeek ${m[1]}`],

    [/^(\d+) 天已经全部过完。可以回头把没勾完的任务补上，或者直接开下一轮：并发、JVM 或 Spring。$/,
      m => `All ${m[1]} days are done. Go back and finish unchecked tasks, or start the next round: concurrency, JVM, or Spring.`],
    [/^自由安排也行：复习错题、补笔记，或者提前看下一节「(.+)」（(.+)）。$/,
      m => `Free time: review mistakes, catch up on notes, or preview “${m[1]}” (${translate(m[2]) || m[2]}).`]
  ];

  /* ---- 含标记的整段文案：用 HTML 模板 ---- */
  const HTML_KEYS = {
    'notes-empty-help': {
      en: 'Drag a lecture screenshot anywhere on the Notes page (or press <kbd>⌘V</kbd> to paste), then hit “Save”.<br>The AI transcribes the key points, reorganizes them, and writes them into this day\u2019s <code>笔记.md</code>.'
    },
    'key-help': {
      en: 'Stored only in <code>config.local.json</code> on this Mac. Never uploaded anywhere else.'
    },
    'model-help': {
      en: 'Vision needs an image-capable model such as <code>deepseek-flash</code>.'
    },
    'drop-main': {
      en: 'Drop it here, or <span class="drop-link">choose screenshots</span>'
    }
  };

  const SKIP = '#notesPreview, #chatLog, #miniNotePreview, #langToggle';
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const ALLOW_SKIPPED = '.block-edit-btn, .chat-tip';

  let lang = 'zh';
  try { lang = localStorage.getItem('javaplan.lang') === 'en' ? 'en' : 'zh'; } catch (e) { /* ignore */ }

  const origins = new Map();       // textNode -> 中文原值
  const attrOrigins = new Map();   // element -> { attr: 中文原值 }
  const htmlOrigins = new Map();   // element -> 中文 innerHTML
  let observer = null;
  let applying = false;

  const hasCjk = s => /[\u3400-\u9fff]/.test(s);

  function translate(core) {
    if (!hasCjk(core)) return null;
    if (Object.prototype.hasOwnProperty.call(DICT, core)) return DICT[core];
    for (const [re, fn] of PATTERNS) {
      const m = core.match(re);
      if (m) return fn(m);
    }
    return null;
  }

  function translateText(raw) {
    if (!hasCjk(raw)) return raw;
    const lead = (raw.match(/^\s*/) || [''])[0];
    const tail = (raw.match(/\s*$/) || [''])[0];
    const core = raw.slice(lead.length, raw.length - tail.length);
    const out = translate(core);
    return out == null ? raw : lead + out + tail;
  }

  function isSkipped(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest(ALLOW_SKIPPED)) return false;
    return !!el.closest(SKIP);
  }

  function translateAttrValue(value) {
    if (!value || !hasCjk(value)) return value;
    const out = translateText(value);
    return out === value ? value : out;
  }

  function handleText(node) {
    if (node.nodeType !== 3) return;
    const parent = node.parentElement;
    if (!parent || isSkipped(parent)) return;
    if (parent.closest('script,style,textarea')) return;
    const zh = node.nodeValue;
    if (!hasCjk(zh)) return;
    const en = translateText(zh);
    if (en === zh) return;
    if (!origins.has(node)) origins.set(node, zh);
    applying = true;
    node.nodeValue = en;
    applying = false;
  }

  function handleAttrs(el) {
    if (!el || el.nodeType !== 1 || isSkipped(el)) return;
    for (const attr of ATTRS) {
      if (!el.hasAttribute(attr)) continue;
      const zh = el.getAttribute(attr);
      if (!hasCjk(zh)) continue;
      const en = translateAttrValue(zh);
      if (en === zh) continue;
      if (!attrOrigins.has(el)) attrOrigins.set(el, {});
      const rec = attrOrigins.get(el);
      if (!(attr in rec)) rec[attr] = zh;
      applying = true;
      el.setAttribute(attr, en);
      applying = false;
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { handleText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1) handleAttrs(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) handleText(n);
      else handleAttrs(n);
    }
  }

  function applyHtml() {
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.dataset.i18nHtml;
      const tpl = HTML_KEYS[key];
      if (!tpl) return;
      if (!htmlOrigins.has(el)) htmlOrigins.set(el, el.innerHTML);
      applying = true;
      el.innerHTML = lang === 'en' ? tpl.en : htmlOrigins.get(el);
      applying = false;
    });
  }

  function restore() {
    for (const [node, zh] of origins) {
      if (node.isConnected && node.nodeValue !== zh) node.nodeValue = zh;
    }
    origins.clear();
    for (const [el, rec] of attrOrigins) {
      if (!el.isConnected) continue;
      for (const attr in rec) el.setAttribute(attr, rec[attr]);
    }
    attrOrigins.clear();
    for (const [el, html] of htmlOrigins) {
      if (el.isConnected && el.innerHTML !== html) el.innerHTML = html;
    }
  }

  function refresh() {
    applyHtml();
    if (lang === 'en') walk(document.body);
  }

  function setLang(next, { silent = false } = {}) {
    lang = next === 'en' ? 'en' : 'zh';
    try { localStorage.setItem('javaplan.lang', lang); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    if (lang === 'zh') {
      restore();
    } else if (!silent) {
      refresh();
    }
    const btn = document.getElementById('langToggle');
    if (btn) {
      btn.textContent = lang === 'en' ? '中文' : 'EN';
      btn.title = lang === 'en' ? '切换到中文' : 'Switch to English';
      btn.setAttribute('aria-label', btn.title);
    }
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(records => {
      if (lang !== 'en' || applying) return;
      for (const r of records) {
        if (r.type === 'characterData') handleText(r.target);
        else if (r.type === 'attributes') handleAttrs(r.target);
        else r.addedNodes.forEach(n => walk(n));
      }
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS
    });
  }

  window.I18N = {
    get lang() { return lang; },
    t: translate,
    setLang,
    refresh,
    startObserver,
    refreshTitle() { document.title = lang === 'en' ? 'Backend Career Roadmap · Daily Plan' : '后端就业学习路线 · 每日计划'; }
  };

  document.addEventListener('DOMContentLoaded', () => {
    setLang(lang, { silent: true });
    refresh();
    I18N.refreshTitle();
    startObserver();
  });
})();
