import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanNoteBody, coerceBlockBody, extractImageRefs, stripFence } from '../lib/prompts.js';

test('保存：去掉误加的标题和整篇围栏', () => {
  const out = cleanNoteBody('```markdown\n## 19:30 · 截图笔记\n\n**多态**\n- 看实际类型\n```');
  assert.equal(out, '**多态**\n- 看实际类型');
});

test('保存：块内的小标题降级成加粗，代码块里的 # 不动', () => {
  const out = cleanNoteBody('**多态**\n\n## 小标题\n- 一\n\n```java\n# 不是标题\n```');
  assert.match(out, /\*\*小标题\*\*/);
  assert.doesNotMatch(out, /^## 小标题/m);
  assert.match(out, /# 不是标题/);
});

test('聊天：模型吐回整篇时只留最后一块', () => {
  const out = coerceBlockBody('## 19:20 · 截图笔记\n老内容\n\n## 19:30 · 截图笔记\n新内容\n### 小标题\n细节');
  assert.equal(out, '新内容\n**小标题**\n细节');
});

test('截图引用去重，外链不算', () => {
  const refs = extractImageRefs('![a](images/1.png)\n![b](images/1.png)\n![c](https://x.com/2.png)');
  assert.deepEqual(refs, ['images/1.png']);
});

test('围栏只剥最外层', () => {
  assert.equal(stripFence('```md\n内容\n```'), '内容');
  assert.equal(stripFence('普通文本'), '普通文本');
});
