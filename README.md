# Java 学习计划 · 截图 AI 笔记

原来的看板只记任务和手写日记。现在把「写日记」换成了「记笔记」：

- 每天一个文件夹，截图和 `笔记.md` 放在一起；
- 把课堂截图拖进去，点一次「手动保存」，AI 马上识图、把知识点重新排好，用最少的字写注释和理解，直接写进当天的 md；
- 每保存一次只追加一块，**旧内容一个字都不动**；
- 右侧聊天框可以继续改，只改**最新保存的那一块**；
- 快捷语句：`更简短`、`换一句`、`高亮语句`。

AI 用的是 DeepSeek 的视觉模型 `deepseek-flash`（支持直接读图片，不需要本地 OCR）。

## 快速开始

1. 双击 `启动.command`。
   它会启动本地服务并打开 `http://127.0.0.1:5271`。第一次打开可能会问终端权限，允许就行。
2. 点右上角齿轮，填 DeepSeek API Key，点「测试连接」，成功后「保存」。
   如果 macOS 拦住不让打开，右键 `启动.command` → 打开。
   Key 在 <https://platform.deepseek.com/api_keys> 申请，只写进本机的 `config.local.json`。
3. 切到「笔记」页，把截图拖进右边，点「手动保存」。
4. 想改刚写的那一块，点三个快捷按钮，或者在下面自己说，比如「第二个例子再短一点」。

关掉终端窗口（或 Ctrl+C）就停止服务。只看看板和任务勾选的话，直接双击 `index.html` 也能用，但笔记功能需要上面的本地服务。

## 每天怎么记

- 拖拽：把截图拖到笔记页**任意位置**都行，松手就加进右边待保存区；也可以 `⌘V` 粘贴，或点「选择截图」。一次最多 10 张。
- 缩略图是完整截图，点一下可以看大图，点右上角 × 移除。
- 截图会在浏览器里先压到最长边 1400px 的 PNG，再上传，省流量也省 token。
- 点「手动保存」后：截图先落盘 → AI 按 `agent/笔记生成.md` 的规则整理 → 追加到 `笔记.md`。
  中途失败会把这次刚存的图删掉，不会留下孤儿截图。
- 每次保存生成一个 `## HH:mm · 截图笔记` 块。聊天修改只替换最后一个块，服务端按构造保证前面的块不被重写。
- 聊天时会把最后一块引用的截图重新发给模型，所以它能看着图改。

## 文件存在哪

```
Java学习计划/
├── notes/
│   └── 2026-11-17/
│       ├── 笔记.md
│       └── images/
│           ├── 194212-1.png
│           └── 194212-2.png
├── config.local.json      # 你的 Key，权限 0600
├── agent/
│   ├── 笔记生成.md         # 「截图 → 笔记」的规则，可以直接改
│   └── 笔记修改.md         # 「改最后一块」的规则
├── lib/
│   ├── deepseek.js        # DeepSeek 客户端
│   ├── notes-store.js     # md / 截图的读写
│   └── prompts.js         # 提示词装配
├── server.js              # 本地服务（零依赖）
├── index.html             # 看板
├── app.js
├── markdown.js            # 笔记的 Markdown 渲染
├── plan.js                # 学习计划数据
└── style.css
```

`notes/` 和 `config.local.json` 都在 `.gitignore` 里，不会被提交。笔记是纯 Markdown，随时可以整个文件夹备份或同步。

## 常用命令

```bash
npm start          # 启动服务（等价于 node server.js）
npm test           # 跑测试（不需要真 Key）

# 换端口
JAVA_NOTES_PORT=6000 npm start

# 模拟模式：不调用 DeepSeek，用固定文本走通流程，适合改样式时用
JAVA_NOTES_MOCK=1 npm start

# 临时把笔记放到别的地方（比如测试）
JAVA_NOTES_ROOT=/path/to/notes npm start

# 用环境变量提供 Key（优先级高于 config.local.json）
DEEPSEEK_API_KEY=sk-... npm start
```

## 想改 AI 的写法

直接编辑 `agent/笔记生成.md` 和 `agent/笔记修改.md`，改完下一次请求就生效，不用重启。

- 「太长了」：在生成规则里把「长度」一节改短。
- 「理解写得太像定义」：强调用大白话、可以打比方，禁止复述定义。
- 「高亮太多」：把每块最多 2 处改成 1 处，或者只允许高亮结论。

## 接口

服务只监听 `127.0.0.1`，只接受本机页面调用。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/status` | Key 是否配置、模型、模拟模式、笔记目录 |
| GET/POST | `/api/config` | 读/写 Key、API 地址、模型 |
| POST | `/api/config/test` | 用 `/models` 测 Key |
| GET | `/api/notes/days` | 有笔记的日期列表 |
| GET | `/api/notes/:date` | 某天的 noteInfo（md、块数、截图数） |
| POST | `/api/notes/:date/save` | 上传截图，生成并追加一块 |
| POST | `/api/notes/:date/chat` | 只改最后一块 |
| POST | `/api/notes/:date/open` | 在 Finder 里打开当天文件夹 |
| GET | `/notes/:date/笔记.md` | 笔记原文 |
| GET | `/notes/:date/images/:file` | 截图 |

## 隐私

- Key 只存在本机 `config.local.json`（0600），接口只回 masked 值，不会被静态访问。
- 截图和笔记只存在本机 `notes/`；只有点保存/聊天时，当次内容才会发给 DeepSeek。
- 服务只绑定 `127.0.0.1`，并校验 Host 和 Origin，局域网里的其他设备访问不到。

## 常见问题

**双击后浏览器说打不开？**
看终端窗口有没有报错。端口 5271 被占用时，直接访问 `http://127.0.0.1:5271`，可能已经启动过了。

**保存报「还没有填 DeepSeek API Key」？**
点右上角齿轮填 Key，先点「测试连接」确认能连上。

**报 402 / 429？**
402 是账户余额不足，429 是请求太频繁，等几秒再点。

**图片太大？**
单张压缩后仍超过 12MB 会被拒绝，先把图裁一下；一次最多 10 张。

**任务和日历还在吗？**
在。勾选仍存在浏览器 localStorage（`javaplan.tasks.v1`），计划内容仍由 `plan.js` 提供，跟笔记互不影响。
