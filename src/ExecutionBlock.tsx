import React, { useEffect, useRef, useState } from 'react';
import type { Execution, Artifact } from './coreModels';
import ArtifactBlock from './ArtifactBlock';

export default function ExecutionBlock({ execution, artifacts }: { execution: Execution; artifacts: Artifact[] }) {
  const [open, setOpen] = useState(['queued', 'running', 'waiting_user'].includes(execution.status));
  const previousStatus = useRef(execution.status);
  useEffect(() => {
    if (['queued', 'running', 'waiting_user'].includes(execution.status)) setOpen(true);
    else if (['queued', 'running', 'waiting_user'].includes(previousStatus.current)) setOpen(false);
    previousStatus.current = execution.status;
  }, [execution.status]);
  const status = execution.simulated ? '模拟完成（未执行真实任务）' : ({ queued: '等待中', running: '进行中', waiting_user: '等待确认', succeeded: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' }[execution.status] || '等待中');
  const summary = execution.toolCalls?.[0]?.name;
  const endedAt = (execution as Execution & { finishedAt?: string }).finishedAt || execution.endedAt;
  const seconds = Math.max(1, Math.round((new Date(endedAt || execution.startedAt || execution.createdAt).getTime() - new Date(execution.startedAt || execution.createdAt).getTime()) / 1000));
  const elapsed = seconds >= 60 ? `${Math.floor(seconds / 60)}分钟${seconds % 60 ? `${seconds % 60}秒` : ''}` : `${seconds}秒`;
  const active = ['queued', 'running', 'waiting_user'].includes(execution.status);
  const title = execution.status === 'queued' ? '等待开始' : active ? '正在思考与执行' : `用时 ${elapsed}`;
  return (
    <div className={`execution-block status-${execution.status}`}>
      <button className="execution-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}><span>{title} <span className="execution-chevron">{open ? '⌄' : '›'}</span>{summary && open ? ` · ${summary}` : ''}</span>{execution.status !== 'succeeded' && <span className="execution-status">{status}</span>}</button>
      {execution.status === 'cancelled' && <p>执行已停止，可能存在部分修改。</p>}
      {open && <div className="execution-detail">
        <p className="execution-source">来自真实执行事件与工具记录</p>
        <div className="execution-meta"><time>{execution.createdAt}</time><div className="muted">状态：{status}</div></div>
        {execution.logs && <pre className="execution-logs">{execution.logs.join('\n')}</pre>}
        {execution.error && <p role="alert">{execution.error}</p>}
      </div>}
      {artifacts.length > 0 && <ArtifactBlock artifacts={artifacts} />}
    </div>
  );
}
