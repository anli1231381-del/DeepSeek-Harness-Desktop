import { bridge } from './api';
import type { StorageSnapshot, Session, Project } from './coreModels';

export const storage = {
  async loadSnapshot(): Promise<StorageSnapshot> {
    const snapshot = await bridge<StorageSnapshot>('snapshot');
    return { ...snapshot, sessions: snapshot.sessions || [] };
  },
  async saveSnapshot(_snapshot: StorageSnapshot): Promise<void> {
    throw new Error('请通过运行时的会话接口保存数据。');
  },
  async listProjects(): Promise<Project[]> {
    return (await this.loadSnapshot()).projects || [];
  },
  async listSessions(projectId?: string | null): Promise<Session[]> {
    const sessions = (await this.loadSnapshot()).sessions;
    return projectId === undefined ? sessions : sessions.filter(s => s.projectId === projectId);
  },
  async getSession(id: string): Promise<Session | null> {
    return (await this.loadSnapshot()).sessions.find(s => s.id === id) || null;
  },
  async saveSession(session: Session): Promise<void> {
    await bridge('save_session', { session });
  },
};

export default storage;
