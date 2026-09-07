import React, { useEffect, useState } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import { loadWorkspaceSnapshot, getProjects, getSessionsByProjectId, getUnlinkedSessions, getCurrentSession, setCurrentSession } from './store/workspaceStore';
import type { StorageSnapshot, Session } from './coreModels';
import { bridge, desktop, onAppEvent } from './api';

export default function SessionSidebar({ onSelect, currentSessionId }: { onSelect?: (sessionId: string) => void; currentSessionId?: string | null }) {
  const [snapshot, setSnapshot] = useState<StorageSnapshot>({ schemaVersion: 1, projects: [], sessions: [] });
  const [current, setCurrent] = useState<string | null>(getCurrentSession());
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void onAppEvent(() => setRevision(v => v + 1)).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(reason => setError(String(reason)));
    return () => { disposed = true; stop?.(); };
  }, []);

  useEffect(() => { let mounted = true; void loadWorkspaceSnapshot().then(snap => { if (mounted) setSnapshot(snap); }).catch(reason => { if (mounted) setError(String(reason)); }); return () => { mounted = false; }; }, [revision]);

  useEffect(() => { setCurrent(currentSessionId ?? getCurrentSession()); }, [currentSessionId]);

  function handleSelect(id: string) {
    setCurrentSession(id);
    setCurrent(id);
    onSelect?.(id);
  }

  const projects = getProjects(snapshot);
  const unlinked = getUnlinkedSessions(snapshot);

  async function create(projectId: string | null = null) {
    try { const id = crypto.randomUUID(); await bridge('create_session', { session: { id, projectId, title: '新对话' } }); setRevision(v => v + 1); handleSelect(id); } catch (reason) { setError(String(reason)); }
  }

  function renderSession(s: Session) {
    const isCurrent = current === s.id;
    const executions = (snapshot.executions || []).filter(e => e.sessionId === s.id);
    const status = executions.some(e => e.status === 'running') ? '进行中' : executions.some(e => e.status === 'queued') ? '排队中' : '';
    return <button key={s.id} data-testid={`session-${s.id}`} className={`session-item ${isCurrent ? 'current' : ''}`} onClick={() => handleSelect(s.id)}>{s.title || s.id}{status && <small> · {status}</small>}</button>;
  }

  return <div className="session-sidebar">
    {error && <p role="alert">{error}</p>}
    <button className="button primary new-session-button" disabled={!desktop} onClick={() => void create()}>＋ 新建对话</button>
    <div className="session-group">
      <div className="group-heading"><FolderOpen size={14} /><strong>未关联项目</strong></div>
      <div className="group-list">{unlinked.length ? unlinked.map(renderSession) : <div className="muted">无未关联会话</div>}</div>
    </div>
    {projects.map(project => <div key={project.id} className="session-group"><div className="group-heading"><Folder size={14} /><strong>{project.name}</strong><button className="text-button" aria-label={`在 ${project.name} 中新建对话`} disabled={!desktop} onClick={() => void create(project.id)}>＋</button></div><div className="group-list">{getSessionsByProjectId(snapshot, project.id).length ? getSessionsByProjectId(snapshot, project.id).map(renderSession) : <div className="muted">(空)</div>}</div></div>)}
  </div>;
}
