import React, { useState } from 'react';
import { bridge } from './api';
import type { Execution } from './coreModels';
import { ArrowUp, Paperclip, Plug, Sparkles } from 'lucide-react';

const drafts = new Map<string, string>();

function genId() { try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.floor(Math.random()*100000)}`; } }

export default function FixedComposer({ sessionId, executions, onChanged, onOpenExtensions }: { sessionId: string; executions: Execution[]; onChanged: () => void; onOpenExtensions?: () => void }) {
  const [value, setValue] = useState(() => drafts.get(sessionId) || '');
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const pending = executions.filter(e => ['running', 'queued'].includes(e.status));
  const active = pending.find(e => e.status === 'running') || pending[0];
  function change(value: string) { setValue(value); drafts.set(sessionId, value); }
  async function stop() {
    if (!active || stopping) return;
    setStopping(true);
    try { await bridge('stop_execution', { executionId: active.id }); }
    catch (error) { alert('停止失败：' + String(error)); }
    finally { setStopping(false); onChanged(); }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || !value.trim()) return;
    if (!sessionId) { alert('请先选择一个会话'); return; }
    setSending(true);
    try {
      // append user message
      const msgId = `m-${genId()}`;
      await bridge('append_message', { sessionId, message: { id: msgId, role: 'user', content: value } });
      onChanged();

      // create execution linked to this message
      const execId = `ex-${genId()}`;
      const execution = { id: execId, triggerMessageId: msgId, status: 'queued', createdAt: new Date().toISOString(), prompt: value };
      await bridge('create_execution', { sessionId, execution });
      onChanged();

      // Enqueue and return immediately; snapshots track background progress.
      await bridge('run_execution', { executionId: execId });

      // clear composer (response will be added by runtime)
      change('');
    } catch (error) {
      console.error('发送失败', error);
      alert('发送失败：' + (error instanceof Error ? error.message : String(error)));
    } finally { setSending(false); onChanged(); }
  };

  return (
    <div className="fixed-composer">
      <form onSubmit={submit}>
        <div className="composer-input-row"><Paperclip size={19} aria-hidden="true" /><textarea placeholder="继续描述需求，或直接追问…" aria-label="消息输入" value={value} disabled={sending} onChange={e => change(e.target.value)} /></div>
        {pending.length > 0 && <p role="status">{pending.some(e => e.status === 'running') ? '执行中，可继续发送需求排队处理。' : '等待执行，可继续发送需求。'} 当前会话待处理 {pending.length} 项。</p>}
        <div className="composer-actions"><div className="composer-tools"><button type="button" onClick={onOpenExtensions}><Sparkles size={14} />Skills</button><button type="button" onClick={onOpenExtensions}><Plug size={14} />MCP</button></div><div className="composer-submit-actions">{active && <button className="button" type="button" disabled={stopping} onClick={() => void stop()}>{stopping ? '正在停止…' : active.status === 'running' ? '停止执行' : '取消排队'}</button>}<button className="button primary composer-send" aria-label="发送" disabled={sending || !value.trim()}>{sending ? '发送中…' : <>发送 <ArrowUp size={15} /></>}</button></div></div>
      </form>
      <p className="composer-note">无需关联项目也能交流；需要操作文件时再选择项目。</p>
    </div>
  );
}
