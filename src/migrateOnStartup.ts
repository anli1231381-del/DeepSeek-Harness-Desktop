import storage from './storage';
import type { StorageSnapshot } from './coreModels';
import { desktop } from './api';

export async function runMigrationIfNeeded(): Promise<{ migrated: boolean; warnings: string[]; details?: any }> {
  const warnings: string[] = [];

  // load current persisted snapshot (new format)
  const current = await storage.loadSnapshot();
  const hasSessions = (current.sessions || []).length > 0;

  // Migration is handled by runtime on startup. Frontend should not perform migration.
  // Just load current snapshot for UI consumption.
  try {
    const snap = await storage.loadSnapshot();
    return { migrated: false, warnings, details: { sessions: (snap.sessions || []).length } };
  } catch (e) {
    warnings.push(String(e));
    return { migrated: false, warnings };
  }
}
