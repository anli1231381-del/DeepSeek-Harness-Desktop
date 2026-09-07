// Uses an existing encrypted Windows app connection; never prints its credential.
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createController } from '../runtime/core.mjs';

const source = process.argv[2] || join(process.env.APPDATA, 'local.harness.desktop', 'state.json');
const config = JSON.parse(await readFile(source, 'utf8'));
const connection = config.connections?.find(c => new URL(c.baseUrl).origin === 'https://openrouter.ai' && c.encryptedApiKey);
if (!connection) throw new Error('请先在应用设置中保存 OpenRouter 密钥和模型。');
const dir = await mkdtemp(join(tmpdir(), 'harness-openrouter-'));
const verificationId = 'verify-' + randomUUID();
const stateFile = join(dir, 'state.json');
await writeFile(stateFile, JSON.stringify({ connections: [connection], settings: { ...config.settings, activeConnectionId: connection.id } }));
const app = await createController({ stateFile, resourceRoot: process.argv[3] });
try {
  await app.dispatch('create_session', { session: { id: verificationId, projectId: null } });
  await app.dispatch('create_execution', { sessionId: verificationId, execution: { id: verificationId, status: 'queued', prompt: 'Create verification.txt in the current working directory containing exactly harness-openrouter-ok. Do not read other files or access the network. Then reply done.' } });
  await app.dispatch('run_execution', { executionId: verificationId });
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const snapshot = await app.dispatch('snapshot');
    const execution = snapshot.executions[0];
    if (!snapshot.runtime.busy && ['succeeded', 'failed', 'cancelled'].includes(execution.status)) {
      if (execution.status !== 'succeeded' || execution.simulated) throw new Error('真实 OpenRouter 执行未成功：' + (execution.error || execution.status));
      const artifact = snapshot.artifacts.find(a => a.path === 'verification.txt');
      if (!artifact || (await readFile(join(artifact.workspacePath, artifact.path), 'utf8')).trim() !== 'harness-openrouter-ok') throw new Error('模型没有生成预期验证文件。');
      console.log(JSON.stringify({ provider: 'OpenRouter', model: connection.model, realExecution: true, artifactCaptured: true, verificationDirectory: dir }));
      break;
    }
    await delay(500);
  }
  if (Date.now() >= deadline) throw new Error('真实模型验证超时。');
} finally { await app.close(); }
