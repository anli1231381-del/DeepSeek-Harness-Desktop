import React, { useState } from 'react';
import type { Execution, Artifact } from './coreModels';
import ArtifactBlock from './ArtifactBlock';

export default function ExecutionBlock({ execution, artifacts }: { execution: Execution; artifacts: Artifact[] }) {
  const [open, setOpen] = useState(false);
  const status = execution.simulated ? '模拟完成（未执行真实任务）' : ({ queued: '等待中', running: '进行中', waiting_user: '等待确认', succeeded: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' }[execution.status] || '等待中');
  const summary = execution.toolCalls?.[0]?.name;
  return (
    <div className={`execution-block status-${status}`}>
      <button className="execution-toggle" onClick={() => setOpen(v => !v)}>{open ? '▼' : '▶'} 执行过程{summary ? ` — ${summary}` : ''} <span className="muted">{status}</span></button>
      {execution.status === 'cancelled' && <p>执行已停止，可能存在部分修改。</p>}
      {open && <div className="execution-detail">
        <div className="execution-meta"><time>{execution.createdAt}</time><div className="muted">状态：{status}</div></div>
        {execution.logs && <pre className="execution-logs">{execution.logs.join('\n')}</pre>}
        {execution.error && <p role="alert">{execution.error}</p>}
      </div>}
      {artifacts.length > 0 && <ArtifactBlock artifacts={artifacts} />}
    </div>
  );
}
