export type Page = '首页' | '项目' | '任务' | '修改' | '设置';
export type Appearance = { mode: 'light' | 'dark' | 'system'; accent: string };
export type Project = { id: string; name: string; path: string; updatedAt: string };
export type Activity = { at: string; label: string; detail?: string; kind: 'info' | 'tool' | 'error' | 'success' };
export type Task = { id: string; projectId: string; prompt: string; status: 'running' | 'completed' | 'failed' | 'stopped'; startedAt: string; finishedAt?: string; stage: string; activities: Activity[]; response: string; error?: string };
export type Settings = { harnessPath: string; provider: string; model: string; activeConnectionId: string };
export type ModelConnection = { id: string; name: string; protocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages'; baseUrl: string; model: string; hasApiKey: boolean };
export type AvailableModel = { id: string; name?: string };
export type ModelListing = { models: AvailableModel[]; message: string };
export type HarnessCatalog = { providers: { id: string; name: string; models: AvailableModel[] }[]; message: string };
export type Runtime = { busy?: boolean; available: boolean; connected: boolean; nodeVersion: string; nodePath: string; harnessPath: string; harnessVersion: string; source: 'local' | 'bundled' | 'missing'; message: string };
export type Snapshot = { projects: Project[]; tasks: Task[]; connections: ModelConnection[]; settings: Settings; runtime: Runtime };
export type Change = { path: string; status: string };
export type Changes = { files: Change[]; git: boolean; message: string };
// bridge operations: snapshot {}, add_project {path}, remove_project {projectId},
// save_settings {settings}, check_runtime {}, start_task {projectId,prompt}, stop_task {},
// changes {projectId} -> Changes, diff {projectId,path} -> string.
// All mutation operations return Snapshot. Events 'app-event' request a fresh snapshot.
