import React from 'react';
import type { Project, Session } from './coreModels';

export default function SessionHeader({ session, projects, pending, onProject, onAddProject, onRename }: { session?: Session; projects: Project[]; pending: boolean; onProject: (id: string | null) => void; onAddProject: () => void; onRename: (title: string) => void }) {
  const project = projects.find(p => p.id === session?.projectId);
  return <header className="session-header">
    <div className="session-meta">
      <h2 className="session-title" aria-label="对话名称" contentEditable suppressContentEditableWarning key={session?.id + (session?.title || '')} onBlur={e => { const title = e.currentTarget.textContent?.trim(); if (title && title !== session?.title) onRename(title); }}>{session?.title || '新对话'}</h2>
      <div className="session-project-controls">
        <label>关联项目（可选） <select aria-label="关联项目（可选）" value={session?.projectId || ''} disabled={pending} onChange={e => onProject(e.target.value || null)}><option value="">未关联项目</option>{projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <button className="text-button" disabled={pending} onClick={onAddProject}>添加并关联文件夹</button>
      </div>
      <p className="session-directory">当前操作目录：<code>{project?.path || session?.workspacePath || '将在首次发送时创建独立目录'}</code></p>
      {pending && <p className="muted">执行或排队期间保留当前目录，结束后可切换项目。</p>}
    </div>
  </header>;
}
