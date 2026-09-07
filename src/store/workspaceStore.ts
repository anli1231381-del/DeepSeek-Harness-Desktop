import { bridge, desktop } from '../api';
import type { StorageSnapshot, Project, Session, Message, Execution, Artifact } from '../coreModels';

const LS_CURRENT = 'harness-current-session';

// Development-only in-memory mock snapshot. Use setMockSnapshot(...) in Console to inject UI fixtures.
let __mockSnapshot: StorageSnapshot | null = null;
export function setMockSnapshot(snap: StorageSnapshot | null) {
  __mockSnapshot = snap;
  try { if ((window as any).__harness_mock_set_called) { /* noop */ } } catch {}
}
// Expose for easy Console use in dev only
try {
  const isProd = (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.MODE === 'production');
  if (!isProd) {
    (window as any).__harness_setMockSnapshot = setMockSnapshot;
  }
} catch {}

export async function loadWorkspaceSnapshot(): Promise<StorageSnapshot> {
  // If a mock snapshot is set (dev/testing), return it first — do NOT persist it to localStorage.
  if (__mockSnapshot) return __mockSnapshot;

  if (desktop) {
    const data = await bridge('snapshot');
    // If legacy snapshot with tasks, runtime migrates; ensure normalized shape
    if (data && !Array.isArray((data as any).sessions)) return { schemaVersion: 1, projects: (data as any).projects || [], sessions: [] };
    return data as unknown as StorageSnapshot;
  }
  return { schemaVersion: 1, projects: [], sessions: [] };
}

export function getProjects(snapshot: StorageSnapshot): Project[] { return snapshot.projects || []; }

export function getSessionsByProjectId(snapshot: StorageSnapshot, projectId: string | null) {
  return (snapshot.sessions || []).filter(s => s.projectId === projectId);
}

export function getUnlinkedSessions(snapshot: StorageSnapshot) { return (snapshot.sessions || []).filter(s => s.projectId === null); }

export function getCurrentSession(): string | null { try { return localStorage.getItem(LS_CURRENT); } catch { return null; } }
export function setCurrentSession(sessionId: string | null) { try { if (sessionId) localStorage.setItem(LS_CURRENT, sessionId); else localStorage.removeItem(LS_CURRENT); } catch {} }

export function getMessagesBySessionId(snapshot: StorageSnapshot, sessionId: string) {
  // prefer top-level normalized messages if present
  if (snapshot.messages && snapshot.messages.length) return snapshot.messages.filter(m => m.sessionId === sessionId);
  const s = (snapshot.sessions || []).find(x => x.id === sessionId);
  return s ? s.messages || [] : [];
}
export function getExecutionsBySessionId(snapshot: StorageSnapshot, sessionId: string) {
  if (snapshot.executions && snapshot.executions.length) return snapshot.executions.filter(e => e.sessionId === sessionId);
  const s = (snapshot.sessions || []).find(x => x.id === sessionId);
  return s ? s.executions || [] : [];
}
export function getArtifactsBySessionId(snapshot: StorageSnapshot, sessionId: string) {
  if (snapshot.artifacts && snapshot.artifacts.length) return snapshot.artifacts.filter(a => a.executionId ? (snapshot.executions || []).find(e => e.id === a.executionId)?.sessionId === sessionId : a.sessionId === sessionId);
  const s = (snapshot.sessions || []).find(x => x.id === sessionId);
  return s ? s.artifacts || [] : [];
}
