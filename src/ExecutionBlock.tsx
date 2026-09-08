import React, { useEffect, useRef, useState } from 'react';
import type { Execution, Artifact } from './coreModels';
import ArtifactBlock from './ArtifactBlock';

export default function ExecutionBlock({ execution, artifacts, onRetry }: { execution: Execution; artifacts: Artifact[]; onRetry?: (execution: Execution) => void }) {
  const [open, setOpen] = useState(['queued', 'running', 'waiting_user'].includes(execution.status));
  const previousStatus = useRef(execution.status);
  useEffect(() => {
    if (['queued', 'running', 'waiting_user'].includes(execution.status)) setOpen(true);
    else if (['queued', 'running', 'waiting_user'].includes(previousStatus.current)) setOpen(false);
    previousStatus.current = execution.status;
  }, [execution.status]);
  const status = execution.simulated ? '模拟回复（真实执行失败）' : ({ queued: '等待中', running: '进行中', waiting_user: '等待确认', succeeded: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' }[execution.status] || '等待中');
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
        {!!execution.steps?.length && <ol className="execution-steps">{execution.steps.map(step => <li key={step.id} className={`step-${step.status}`}><span className="step-mark">{step.status === 'succeeded' ? '✓' : step.status === 'failed' ? '!' : '•'}</span><div><strong>{step.label}</strong>{step.detail && <p className="step-detail">{step.detail}</p>}</div><time>{new Date(step.at).toLocaleTimeString()}</time></li>)}</ol>}
        {!execution.steps?.length && execution.logs && <pre className="execution-logs">{execution.logs.join('\n')}</pre>}
        {execution.error && <div className="execution-error"><p className="error-detail" role="alert">{execution.error}</p><div><button className="text-button" onClick={() => navigator.clipboard?.writeText(execution.error || '')}>复制错误</button>{onRetry && execution.prompt && <button className="button small" onClick={() => onRetry(execution)}>再次执行</button>}</div></div>}
      </div>}
      {artifacts.length > 0 && <ArtifactBlock artifacts={artifacts} />}
    </div>
  );
}
