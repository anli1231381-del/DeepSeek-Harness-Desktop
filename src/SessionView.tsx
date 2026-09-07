import React, { useEffect, useRef, useState } from 'react';
import { loadWorkspaceSnapshot, getMessagesBySessionId, getExecutionsBySessionId, getArtifactsBySessionId } from './store/workspaceStore';
import type { Message, Execution, Artifact, Session } from './coreModels';
import SessionHeader from './SessionHeader';
import MessageTimeline from './MessageTimeline';
import FixedComposer from './FixedComposer';
import { desktop, onAppEvent } from './api';

export default function SessionView({ currentSessionId }: { currentSessionId: string }) {
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const loadedSession = useRef('');
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void onAppEvent(() => setRevision(v => v + 1)).then(unlisten => {
      if (disposed) unlisten(); else stop = unlisten;
    }).catch(reason => setError(String(reason)));
    return () => { disposed = true; stop?.(); };
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [sessionTitle, setSessionTitle] = useState('');
  const [projectLabel, setProjectLabel] = useState('');
  const pending = executions.some(e => ['queued', 'running'].includes(e.status));
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setRevision(v => v + 1), 500);
    return () => clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    let cancelled = false;
    if (loadedSession.current !== currentSessionId) setLoading(true);
    setError('');
    void loadWorkspaceSnapshot().then(snapshot => {
      if (cancelled) return;
      loadedSession.current = currentSessionId;
      const msgs = (getMessagesBySessionId(snapshot, currentSessionId) || []).slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      const execs = (getExecutionsBySessionId(snapshot, currentSessionId) || []).slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      const arts = (getArtifactsBySessionId(snapshot, currentSessionId) || []).slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      setMessages(msgs);
      setExecutions(execs);
      setArtifacts(arts);
      const sess = snapshot.sessions.find(s => s.id === currentSessionId) as Session | undefined;
      setSessionTitle(sess?.title || '未命名会话');
      const proj = sess ? snapshot.projects.find(p => p.id === sess.projectId) : undefined;
      setProjectLabel(proj?.name || (sess?.projectId ? '已移除的项目' : '未关联项目'));
    }).catch(reason => { if (!cancelled) setError(String(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentSessionId, revision]);

  return (
    <section className="session-view card">
      <SessionHeader projectLabel={projectLabel} sessionTitle={sessionTitle} />
      <div className="session-body">
        {error ? <div role="alert">加载会话失败：{error}</div> : loading ? <div className="loading">正在加载会话…</div> : <MessageTimeline messages={messages} executions={executions} artifacts={artifacts} />}
      </div>
      <FixedComposer key={currentSessionId} sessionId={currentSessionId} executions={executions} onChanged={() => setRevision(v => v + 1)} />
    </section>
  );
}
