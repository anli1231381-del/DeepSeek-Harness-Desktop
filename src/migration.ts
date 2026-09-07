import type { Snapshot } from './types';
import type { StorageSnapshot, Session, Message, Execution } from './coreModels';

const nowISO = () => new Date().toISOString();

function mapTaskStatusToExecutionStatus(taskStatus: string): Execution['status'] {
  switch (taskStatus) {
    case 'running':
      return 'interrupted';
    case 'completed':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'cancelled';
    default:
      return 'succeeded';
  }
}

export function migrateOldTasksToSnapshot(old: Snapshot, existing?: StorageSnapshot): { snapshot: StorageSnapshot; warnings: string[] } {
  const warnings: string[] = [];
  const sessions: Session[] = existing?.sessions ? [...existing.sessions] : [];
  const messages: Message[] = existing && Array.isArray((existing as any).messages) ? [...(existing as any).messages] : [];
  const executions: Execution[] = existing && Array.isArray((existing as any).executions) ? [...(existing as any).executions] : [];

  if (!old.tasks || old.tasks.length === 0) {
    return { snapshot: { schemaVersion: 1, projects: old.projects || [], sessions, messages, executions, artifacts: existing?.artifacts || [] }, warnings };
  }

  for (const t of old.tasks) {
    try {
      const legacyId = `task:${t.id}`;
      if (sessions.find(s => (s as any).legacySourceId === legacyId)) continue;
      const sid = `s-${t.id}`;
      const createdAt = t.startedAt ?? nowISO();
      const updatedAt = t.finishedAt ?? createdAt;

      const m1 = { id: `m-${t.id}-u`, sessionId: sid, role: 'user', content: t.prompt, createdAt } as Message;
      messages.push(m1);
      if (t.response && t.response.length > 0) messages.push({ id: `m-${t.id}-a`, sessionId: sid, role: 'assistant', content: t.response, createdAt: updatedAt } as Message);

      const exec: Execution = {
        id: `e-${t.id}`,
        sessionId: sid,
        triggerMessageId: m1.id,
        createdAt,
        startedAt: t.startedAt,
        endedAt: t.finishedAt,
        status: mapTaskStatusToExecutionStatus(t.status),
        toolCalls: [],
        logs: (t.activities || []).map(activity => activity.label),
      };
      executions.push(exec);

      const session: Session = {
        id: sid,
        projectId: t.projectId ?? null,
        title: t.stage || `Task ${t.id}`,
        createdAt,
        updatedAt,
        contextSummary: null,
        workspacePath: null,
        schemaVersion: 1,
      } as Session & { legacySourceId?: string };
      (session as any).legacySourceId = legacyId;
      sessions.push(session);
    } catch (e) {
      warnings.push(`failed to migrate task ${t.id}: ${String(e)}`);
    }
  }

  const snapshot: StorageSnapshot = { schemaVersion: 1, projects: old.projects || [], sessions, messages, executions, artifacts: existing?.artifacts || [] };
  return { snapshot, warnings };
}

export default migrateOldTasksToSnapshot;
