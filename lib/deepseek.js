/* DeepSeek Chat Completions 客户端（零依赖）
 * 文档：https://api-docs.deepseek.com/guides/vision
 * deepseek-flash 支持图片输入，所以截图直接发给模型，不需要本地 OCR。 */

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-flash';

export class DeepSeekError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'DeepSeekError';
    this.status = status;
    this.expose = true;
  }
}

function friendly(status, detail) {
  if (status === 401) return 'DeepSeek API Key 无效或已过期，请在「设置」里换一个。';
  if (status === 402) return 'DeepSeek 账户余额不足，充值后再试。';
  if (status === 429) return 'DeepSeek 请求太频繁，等几秒再点保存。';
  if (status === 400) return `DeepSeek 说请求有问题：${detail || '请检查模型名和图片格式'}`;
  if (status >= 500) return `DeepSeek 服务端出错（${status}），稍后重试。`;
  return `DeepSeek 请求失败（${status}）${detail ? '：' + detail : ''}`;
}

async function readError(res) {
  const text = await res.text().catch(() => '');
  try {
    const data = JSON.parse(text);
    return data?.error?.message || data?.message || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

export function createDeepSeek({ apiKey, baseUrl = DEFAULT_BASE, model = DEFAULT_MODEL } = {}) {
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '');

  async function request(pathname, { method = 'GET', body, timeout = 180000 } = {}) {
    let res;
    try {
      res = await fetch(base + pathname, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      if (e?.name === 'TimeoutError') throw new DeepSeekError('DeepSeek 响应超时（超过 3 分钟），稍后重试。');
      throw new DeepSeekError(`连不上 DeepSeek：${e.message}`);
    }
    if (!res.ok) throw new DeepSeekError(friendly(res.status, await readError(res)), res.status);
    return res;
  }

  /** 发一轮对话，返回纯文本。messages 为 OpenAI 兼容格式。 */
  async function chat(messages, { maxTokens = 4096, temperature = 0.3, retries = 1 } = {}) {
    const body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await request('/chat/completions', { method: 'POST', body });
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) {
          throw new DeepSeekError('DeepSeek 返回了空内容，再点一次试试。');
        }
        return text;
      } catch (e) {
        const retryable = e.status === 429 || e.status >= 500 || e.status === 0;
        if (attempt < retries && retryable) {
          await new Promise(r => setTimeout(r, 1800));
          continue;
        }
        throw e;
      }
    }
  }

  /** 测试 Key：拉模型列表。 */
  async function listModels() {
    const res = await request('/models', { timeout: 20000 });
    const data = await res.json();
    return (data?.data || []).map(m => m.id).filter(Boolean);
  }

  return { chat, listModels, base, model };
}

export { DEFAULT_BASE, DEFAULT_MODEL };
