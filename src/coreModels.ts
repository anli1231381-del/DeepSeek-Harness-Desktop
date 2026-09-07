export const SCHEMA_VERSION = 1;

export type ID = string;

export type Project = {
  id: ID;
  name: string;
  path: string;
  updatedAt: string;
};

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type Message = {
  id: ID;
  sessionId: ID;
  role: MessageRole;
  content: string; // supports Markdown
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type ExecutionStatus = 'queued' | 'running' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export type ToolCall = {
  id: ID;
  name: string;
  params?: Record<string, unknown>;
  result?: unknown;
  startedAt?: string;
  endedAt?: string;
  error?: string;
};

export type Execution = {
  simulated?: boolean;
  error?: string;
  id: ID;
  sessionId: ID;
  triggerMessageId?: ID; // which message triggered this execution
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  status: ExecutionStatus;
  toolCalls?: ToolCall[];
  logs?: string[];
};

export type ArtifactChange = 'created' | 'modified' | 'deleted' | 'renamed';

export type Artifact = {
  workspacePath?: string;
  id: ID;
  executionId?: ID;
  sessionId?: ID;
  path: string; // file system path relative to project or session workspace
  type?: string; // mime or file type hint
  changeType: ArtifactChange;
  beforeHash?: string | null;
  afterHash?: string | null;
  diff?: string | null; // text diff if available
  createdAt: string;
};

export type Session = {
  id: ID;
  projectId: ID | null; // null = unassociated session
  title: string;
  createdAt: string;
  updatedAt: string;
  // lightweight summary for model-context / token trimming
  contextSummary?: string | null;
  // when projectId === null, session may still have a workspacePath
  workspacePath?: string | null;
  messages?: Message[];
  executions?: Execution[];
  artifacts?: Artifact[];
  schemaVersion: number;
  legacySourceId?: string | null; // e.g. 'task:<legacyId>' to support idempotent migrations
};

export type StorageSnapshot = {
  schemaVersion: number;
  projects: Project[]; // normalized collection
  sessions: Session[]; // normalized collection
  messages?: Message[]; // all messages (optional denormalized store)
  executions?: Execution[]; // all executions (optional denormalized store)
  artifacts?: Artifact[]; // all artifacts (optional denormalized store)
};

// Minimal helpers
export const nowISO = () => new Date().toISOString();
