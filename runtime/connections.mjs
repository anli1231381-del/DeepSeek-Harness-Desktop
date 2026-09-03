import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const protocols = ['openai-completions', 'openai-responses', 'anthropic-messages'];
export function validateConnection(input) {
  if (!input || typeof input !== 'object') throw new Error('API 配置无效');
  const result = {};
  for (const field of ['name', 'protocol', 'baseUrl', 'model']) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > (field === 'baseUrl' ? 2048 : 200)) throw new Error('请填写名称、协议、API 地址和模型');
    result[field] = input[field].trim();
  }
  if (!protocols.includes(result.protocol)) throw new Error('不支持的 API 协议');
  let url;
  try { url = new URL(result.baseUrl); } catch { throw new Error('API 地址格式无效'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址只能包含 HTTP(S) 服务地址和路径，不能包含凭证、参数或片段');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程 API 地址请使用 HTTPS；本机服务可使用 HTTP');
  result.baseUrl = url.href.replace(/\/+$/, '');
  if (url.origin === 'https://api.deepseek.com' && ['/', '/v1', '/anthropic'].includes(url.pathname.replace(/\/$/, '') || '/')) {
    const anthropic = url.pathname.replace(/\/$/, '') === '/anthropic';
    if (anthropic && result.protocol !== 'anthropic-messages') throw new Error('此 DeepSeek 地址使用 Anthropic 协议，请选择 Anthropic · Messages，或将地址改为 https://api.deepseek.com。');
    if (!anthropic && result.protocol === 'anthropic-messages') throw new Error('DeepSeek 的 Anthropic 协议地址应为 https://api.deepseek.com/anthropic。');
  }
  if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 8192 || /[\r\n\0]/.test(input.apiKey))) throw new Error('API 密钥格式无效');
  return result;
}

// Windows DPAPI binds saved credentials to the current OS user; plaintext only travels over pipes.
export function credential(operation, value) {
  if (process.platform !== 'win32') throw new Error('当前版本的密钥保存需要 Windows');
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./credentials.ps1', import.meta.url))], { windowsHide: true, timeout: 15000, maxBuffer: 65536 }, (error, stdout) => {
      if (error) reject(new Error(operation === 'protect' ? '无法加密保存密钥，请重试' : '无法解密密钥，请在此 Windows 账户下重新填写'));
      else resolve(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ operation, value }));
  });
}

export function connectionPatch(connection) {
  const provider = `desktop-${connection.id}`;
  return [{ id: 'llm-pi-ai', config: { providers: { [provider]: {
    displayName: connection.name, api: connection.protocol, baseURL: connection.baseUrl,
    apiKeyEnv: 'HARNESS_DESKTOP_MODEL_KEY',
    models: [{ id: connection.model, contextWindow: 32768, maxTokens: 4096 }],
    retryPolicy: { mode: 'normal', maxRetries: 1 },
  } } } }];
}
