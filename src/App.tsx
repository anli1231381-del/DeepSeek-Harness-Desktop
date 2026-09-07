import React, { useCallback, useEffect, useRef, useState } from 'react';
import SessionSidebar from './SessionSidebar';
import SessionView from './SessionView';
import { ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Clock3, FileCode2, FilePenLine, Folder, FolderOpen, FolderPlus, Home, LoaderCircle, MessageCircle, Monitor, Moon, Palette, Play, Plus, Puzzle, RefreshCw, Settings2, Square, Sun, TerminalSquare, Trash2, X, XCircle } from 'lucide-react';
import ColorPicker, { applyColor, isColor } from './ColorPicker';
import ModelConnections from './ModelConnections';
import HarnessModels from './HarnessModels';
import DeepSeekChat from './DeepSeekChat';
import DeepSeekAccount from './DeepSeekAccount';
import ExtensionManager from './ExtensionManager';
import { bridge, chooseFolder, desktop, emptySnapshot, onAppEvent } from './api';
import type { Appearance, Changes, Page, Settings, Snapshot, Task } from './types';

const pages = [{ name: '首页', icon: Home }, { name: '项目', icon: Monitor }, { name: '扩展', icon: Puzzle }, { name: '修改', icon: FilePenLine }, { name: '设置', icon: Settings2 }] as const;
const modes = [{ id: 'light', name: '浅色', icon: Sun }, { id: 'dark', name: '深色', icon: Moon }, { id: 'system', name: '跟随系统', icon: Monitor }] as const;
const accents = [{ id: 'blue', name: '蓝色', color: '#1769ff' }, { id: 'green', name: '绿色', color: '#168746' }, { id: 'purple', name: '紫色', color: '#8243d8' }, { id: 'amber', name: '琥珀', color: '#d58900' }, { id: 'graphite', name: '石墨', color: '#59616e' }] as const;
const statusNames = { running: '进行中', completed: '已完成', failed: '未完成', stopped: '已停止' };
const defaults: Appearance = { mode: 'light', accent: '#1769ff' };
const readSaved = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
function initialAppearance(): Appearance {
  try {
    const saved = JSON.parse(readSaved('harness-appearance') || 'null');
    return { mode: modes.some(mode => mode.id === saved?.mode) ? saved.mode : defaults.mode, accent: isColor(saved?.accent) ? saved.accent : accents.find(accent => accent.id === saved?.accent)?.color || defaults.accent };
  } catch { return defaults; }
}
function dateLabel(value: string, timeOnly = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('zh-CN', timeOnly ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
function Status({ task }: { task: Task }) { return <span className={`status ${task.status}`}>{task.status === 'running' && <LoaderCircle size={13} className="spin" />}{statusNames[task.status]}</span>; }
function Empty({ icon: Icon = FolderOpen, title, children }: { icon?: typeof FolderOpen; title: string; children: React.ReactNode }) { return <div className="empty"><span className="empty-icon"><Icon size={26} strokeWidth={1.5} /></span><h3>{title}</h3><div>{children}</div></div>; }

export default function App() {
  const [workspaceMode, setWorkspaceMode] = useState<'work' | 'chat'>('work');
  const [page, setPage] = useState<Page>('首页');
  const [data, setData] = useState<Snapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectId, setProjectId] = useState(readSaved('harness-project') || '');
  const [taskId, setTaskId] = useState('');
  const [appearance, setAppearance] = useState<Appearance>(initialAppearance);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => { try { return localStorage.getItem('harness-current-session'); } catch { return null; } });
  const [settings, setSettings] = useState<Settings>(emptySnapshot.settings);
  const [changes, setChanges] = useState<Changes | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesRefresh, setChangesRefresh] = useState(0);
  const [filePath, setFilePath] = useState('');
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const appearanceButton = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sequence = useRef(0);
  const mutationBusy = useRef(false);
  const mounted = useRef(false);
  const connectionLost = useRef(false);
  const preparingSession = useRef(false);
  const reportError = useCallback((reason: unknown) => setError(String(reason instanceof Error ? reason.message : reason).slice(0, 1000)), []);
  function selectSession(id: string) { setCurrentSessionId(id); setPage('首页'); setWorkspaceMode('work'); try { localStorage.setItem('harness-current-session', id); } catch {} }
  async function newSession(projectId: string | null = null) {
    const id = crypto.randomUUID();
    const snapshot = await bridge('create_session', { session: { id, projectId, title: '新对话' } });
    setData(snapshot); selectSession(id); return id;
  }
  useEffect(() => {
    if (loading || !desktop || currentSessionId && data.sessions?.some(s => s.id === currentSessionId) || preparingSession.current) return;
    preparingSession.current = true;
    void newSession().catch(reportError);
  }, [loading, data.sessions, currentSessionId]);
  const project = data.projects.find(item => item.id === projectId);
  const running = data.tasks.find(task => task.status === 'running');
  const selectedTask = data.tasks.find(task => task.id === taskId) || data.tasks[0];
  const runtimeLabel = !desktop ? '桌面环境未连接' : data.runtime.connected ? '连接已验证' : data.runtime.available ? '环境已检测，待验证' : '环境待配置';

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const snapshot = await bridge('snapshot');
      if (mounted.current && !connectionLost.current && request === sequence.current) setData(snapshot);
    } catch (reason) { if (mounted.current && request === sequence.current) reportError(reason); }
    finally { if (mounted.current) setLoading(false); }
  }, [reportError]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (desktop) void onAppEvent(payload => {
      if (payload.disconnected) {
        connectionLost.current = true; ++sequence.current;
        const message = '本地运行环境已断开，请重新启动应用。';
        setData(previous => ({ ...previous, runtime: { ...previous.runtime, available: false, connected: false, busy: false, message }, tasks: previous.tasks.map(task => task.status === 'running' ? { ...task, status: 'stopped', stage: '运行环境已断开', error: message } : task) }));
        reportError(message); return;
      }
      if (disposed || timer) return;
      timer = setTimeout(() => { timer = undefined; if (!disposed) void refresh(); }, 200);
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(reportError);
    return () => { disposed = true; mounted.current = false; sequence.current++; unlisten?.(); clearTimeout(timer); };
  }, [refresh, reportError]);

  useEffect(() => {
    if (loading) return;
    if (!data.projects.some(item => item.id === projectId)) setProjectId(data.projects[0]?.id || '');
  }, [data.projects, projectId, loading]);
  useEffect(() => { try { localStorage.setItem('harness-project', projectId); } catch { /* Storage may be unavailable in restricted webviews. */ } }, [projectId]);
  useEffect(() => { setTaskId(previous => data.tasks.some(task => task.id === previous) ? previous : data.tasks[0]?.id || ''); }, [data.tasks]);
  useEffect(() => { setSettings(data.settings); }, [data.settings.harnessPath, data.settings.provider, data.settings.model, data.settings.activeConnectionId]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = appearance.mode === 'system' ? media.matches ? 'dark' : 'light' : appearance.mode; document.documentElement.dataset.accent = appearance.accent; applyColor(appearance.accent, document.documentElement.dataset.theme === 'dark'); };
    apply();
    media.addEventListener('change', apply);
    try { localStorage.setItem('harness-appearance', JSON.stringify(appearance)); } catch { /* In-memory preference still works. */ }
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
  useEffect(() => {
    if (!appearanceOpen) return;
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !appearanceButton.current?.contains(event.target as Node)) setAppearanceOpen(false); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAppearanceOpen(false); appearanceButton.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    popup.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); };
  }, [appearanceOpen]);

  useEffect(() => {
    let cancelled = false;
    setChanges(null); setFilePath(''); setDiff('');
    if (!projectId || !desktop) return;
    setChangesLoading(true);
    void bridge<Changes>('changes', { projectId }).then(result => { if (!cancelled) { setChanges(result); setFilePath(result.files[0]?.path || ''); } }).catch(reason => { if (!cancelled) { setChanges({ files: [], git: false, message: String(reason) }); reportError(reason); } }).finally(() => { if (!cancelled) setChangesLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, page === '修改', running?.id, changesRefresh, reportError]);
  useEffect(() => {
    let cancelled = false;
    setDiff('');
    if (!projectId || !filePath || page !== '修改') return;
    setDiffLoading(true);
    void bridge<string>('diff', { projectId, path: filePath }).then(result => { if (!cancelled) setDiff(result); }).catch(reason => { if (!cancelled) reportError(reason); }).finally(() => { if (!cancelled) setDiffLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, filePath, page, changesRefresh, reportError]);

  async function mutate(operation: string, params: Record<string, unknown> = {}, onFailure?: (message: string) => void) {
    if (mutationBusy.current) { onFailure?.('另一个操作正在处理，请稍后重试。'); return; }
    mutationBusy.current = true; setBusy(operation); setError(''); setNotice(''); ++sequence.current;
    try {
      const snapshot = await bridge(operation, params);
      if (!mounted.current || connectionLost.current) return;
      ++sequence.current; setData(snapshot);
      return snapshot;
    } catch (reason) { if (mounted.current) { reportError(reason); onFailure?.(String(reason)); } }
    finally { mutationBusy.current = false; if (mounted.current) { setBusy(''); void refresh(); } }
  }
  async function addProject() {
    if (!desktop) { reportError('添加本地项目需要桌面环境，请打开 Harness 桌面助手。'); return; }
    if (busy) return;
    try {
      const path = await chooseFolder();
      if (!path) return;
      const snapshot = await mutate('add_project', { path });
      if (snapshot) {
        const added = snapshot.projects.find(item => item.path.replace(/\\/g, '/').toLowerCase() === path.replace(/\\/g, '/').toLowerCase());
        setProjectId(added?.id || snapshot.projects[0]?.id || '');
        setNotice('项目已添加，可以开始描述你的目标。');
      }
    } catch (reason) { reportError(reason); }
  }
  async function browseHarness() {
    try {
      const path = await chooseFolder();
      if (path) setSettings(previous => ({ ...previous, harnessPath: path }));
    } catch (reason) { reportError(reason); }
  }
  function projectPicker() {
    return <label className="project-picker"><Folder size={16} /><span>项目</span><select aria-label="当前项目" value={projectId} onChange={event => setProjectId(event.target.value)} disabled={!data.projects.length}><option value="" disabled>选择一个项目</option>{data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></label>;
  }
  function taskActivity(task: Task, compact = false) {
    const activities = compact ? task.activities.slice(-3) : task.activities;
    return <div className={`activity-list ${compact ? 'compact' : ''}`} role="log" aria-label="任务工作记录">{activities.length ? activities.map((activity, index) => <div className={`activity ${activity.kind}`} key={`${index}-${activity.at}`}><span className="activity-dot">{activity.kind === 'success' ? <Check size={11} /> : activity.kind === 'error' ? <X size={11} /> : <Circle size={6} fill="currentColor" />}</span><time dateTime={activity.at}>{dateLabel(activity.at, true)}</time><div><span>{activity.label}</span>{activity.detail && <p>{activity.detail}</p>}</div></div>) : <p className="muted">等待 Harness 返回工作记录。</p>}</div>;
  }
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><img src="/app-icon.png" alt="" width="32" height="32" /></span><span>Harness <span className="brand-sub">桌面助手</span></span></div><div className="workspace-switch" role="group" aria-label="切换模式"><button aria-label="工作模式" aria-pressed={workspaceMode === 'work'} onClick={() => setWorkspaceMode('work')}><Monitor size={17} /><span>工作</span></button><button aria-label="对话模式" aria-pressed={workspaceMode === 'chat'} onClick={() => setWorkspaceMode('chat')}><MessageCircle size={17} /><span>对话</span></button></div>
    <div className="session-list-wrapper"><React.Suspense fallback={null}><SessionSidebar currentSessionId={currentSessionId} onSelect={selectSession} /></React.Suspense></div>
    <nav aria-label="主导航">{pages.map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${workspaceMode === 'work' && page === name ? 'active' : ''}`} aria-current={workspaceMode === 'work' && page === name ? 'page' : undefined} onClick={() => { setWorkspaceMode('work'); setPage(name); }}><Icon size={22} strokeWidth={1.8} /><span>{name}</span>{name === '修改' && !!changes?.files.length && <span className="nav-count">{changes.files.length}</span>}</button>)}</nav><div className="sidebar-footer"><div><span className={`dot ${data.runtime.connected ? 'green' : ''}`} /><span>{runtimeLabel}</span></div><button className="text-button" onClick={() => { setWorkspaceMode('work'); setPage('设置'); }}>查看环境 <ArrowRight size={13} /></button><span className="version">本地工作 · 自由连接</span></div></aside>
    <div className={`workspace ${workspaceMode === 'chat' ? 'chat-workspace' : ''}`}><header className="topbar"><div className="breadcrumbs"><span>{workspaceMode === 'chat' ? '对话' : '工作台'}</span><span className="slash">/</span><span className="muted">{workspaceMode === 'chat' ? 'DeepSeek' : page}</span><span className="slash">/</span><span className="current-session muted">{currentSessionId || '未选择会话'}</span></div><div className="topbar-actions"><button ref={appearanceButton} className={`button appearance-trigger ${appearanceOpen ? 'pressed' : ''}`} aria-expanded={appearanceOpen} aria-controls="appearance-panel" aria-haspopup="dialog" onClick={() => setAppearanceOpen(value => !value)}><Palette size={16} />外观</button><span className={`environment-label ${desktop ? '' : 'preview'}`}><span className="dot" />{workspaceMode === 'chat' ? 'DeepSeek 官网' : desktop ? '本地工作空间' : '浏览器预览 · 未连接'}</span></div>
      {appearanceOpen && <div ref={popup} className="appearance-popover" id="appearance-panel" role="dialog" aria-label="界面外观" onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== appearanceButton.current) setAppearanceOpen(false); }}><div className="card-heading"><h2>界面外观</h2><button className="icon-button" aria-label="关闭外观设置" onClick={() => { setAppearanceOpen(false); appearanceButton.current?.focus(); }}><X size={19} /></button></div><fieldset><legend>显示模式</legend><div className="mode-options">{modes.map(({ id, name, icon: Icon }) => <label key={id} className={appearance.mode === id ? 'selected' : ''}><input type="radio" name="appearance-mode" value={id} checked={appearance.mode === id} onChange={() => setAppearance(previous => ({ ...previous, mode: id }))} /><Icon size={15} /><span>{name}</span></label>)}</div></fieldset><fieldset><legend>主题色</legend><ColorPicker value={appearance.accent} onChange={accent => setAppearance(previous => ({ ...previous, accent }))} /><div className="accent-options">{accents.map(accent => <label key={accent.id}><input type="radio" name="appearance-accent" value={accent.id} checked={appearance.accent === accent.color} onChange={() => setAppearance(previous => ({ ...previous, accent: accent.color }))} /><span className={`color-swatch ${appearance.accent === accent.color ? 'selected' : ''}`} style={{ '--swatch': accent.color } as React.CSSProperties}>{appearance.accent === accent.color && <Check size={22} />}</span><span>{accent.name}</span></label>)}</div></fieldset><div className="appearance-footer"><span className="muted">即时生效，自动保存偏好</span><button className="text-button" onClick={() => setAppearance(defaults)}>恢复默认</button></div></div>}
    </header>
    <main className={`main-content ${page === '首页' ? 'conversation-home' : ''}`} hidden={workspaceMode !== 'work'}>
      {error && <div className="banner error-banner" role="alert"><XCircle size={18} /><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="banner notice-banner" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {page === '首页' && (currentSessionId ? <SessionView key={currentSessionId} currentSessionId={currentSessionId} /> : <section className="session-view card"><div className="session-header"><h2>新对话 · 未关联项目</h2></div><div className="session-body"><p>{desktop ? '正在准备对话…' : '先沟通，再关联项目。浏览器仅预览界面，请打开桌面应用开始工作。'}</p></div></section>)}

      {page === '项目' && <><div className="page-title"><div><h1>你的项目</h1><p>从本地文件夹开始，随时继续工作。</p></div><button className="button primary" disabled={!!busy} onClick={() => void addProject()}><Plus size={17} />添加项目</button></div>{data.projects.length ? <div className="projects-grid">{data.projects.map(item => <section key={item.id} className={`card project-card ${projectId === item.id ? 'is-current' : ''}`}><div className="card-heading"><span className="project-card-icon"><Folder size={25} /></span><button className="icon-button" title="从列表移除，不删除文件" aria-label={`从列表移除 ${item.name}，不删除文件`} disabled={!!busy || running?.projectId === item.id} onClick={() => void mutate('remove_project', { projectId: item.id })}><Trash2 size={16} /></button></div><h2>{item.name}</h2><p className="project-path">{item.path}</p><div className="project-card-bottom"><time className="muted">{dateLabel(item.updatedAt)}</time><button className="text-button" onClick={() => { setProjectId(item.id); const session = data.sessions?.find(s => s.projectId === item.id); if (session) selectSession(session.id); else void newSession(item.id).catch(reportError); }}>{projectId === item.id ? '继续工作' : '进入项目'}<ArrowRight size={15} /></button></div></section>)}</div> : <section className="card large-empty"><Empty title="让第一个项目就位"><p>选择一个本地文件夹，Harness 就可以了解并处理这个项目。</p><button className="button primary" onClick={() => void addProject()}><FolderPlus size={17} />选择项目文件夹</button></Empty></section>}<p className="footnote">从列表移除项目只会忘记该项目，不会删除本地文件。</p></>}

      {page === '扩展' && <ExtensionManager projects={data.projects} currentProjectId={projectId} />}

      {page === '任务' && <><div className="page-title"><div><h1>任务记录</h1><p>每一步工作，都有真实记录可循。</p></div><button className="button" onClick={() => { setPage('首页'); requestAnimationFrame(() => composer.current?.focus()); }}><Plus size={16} />新建任务</button></div>{data.tasks.length ? <div className="tasks-layout"><section className="card task-history" aria-label="任务列表">{data.tasks.map(task => <button key={task.id} className={`history-row ${selectedTask?.id === task.id ? 'selected' : ''}`} onClick={() => setTaskId(task.id)}><div><Status task={task} /><time>{dateLabel(task.startedAt)}</time></div><strong>{task.prompt}</strong><span className="muted">{data.projects.find(item => item.id === task.projectId)?.name || '已移除的项目'}</span></button>)}</section>{selectedTask && <section className="card task-detail"><div className="card-heading"><h2>任务详情</h2><Status task={selectedTask} /></div><h3 className="task-prompt">{selectedTask.prompt}</h3><p className="muted task-meta"><Clock3 size={14} />{dateLabel(selectedTask.startedAt)}{selectedTask.finishedAt && ` — ${dateLabel(selectedTask.finishedAt)}`}</p><div className="detail-stage"><span className="dot" />{selectedTask.stage || statusNames[selectedTask.status]}{selectedTask.status === 'running' && <button className="button small" disabled={!!busy} onClick={() => void mutate('stop_task')}><Square size={12} />停止任务</button>}</div><h3 className="section-label">工作记录</h3>{taskActivity(selectedTask)}{selectedTask.error && <div className="inline-error">{selectedTask.error}</div>}{selectedTask.response && <><h3 className="section-label">助手输出</h3><div className="assistant-response">{selectedTask.response}</div></>}</section>}</div> : <section className="card large-empty"><Empty icon={FileCode2} title="还没有任务记录"><p>创建一个任务，查看 Harness 的工作过程和执行结果。</p><button className="button primary" onClick={() => setPage('首页')}>开始第一个任务 <ArrowRight size={16} /></button></Empty></section>}</>}

      {page === '修改' && <><div className="page-title"><div><h1>工作区修改</h1><p>查看项目中全部尚未提交的修改，包括你和其他工具的更改。</p></div><div className="page-actions">{projectPicker()}<button className="button" disabled={!project || changesLoading} onClick={() => setChangesRefresh(value => value + 1)}><RefreshCw size={16} className={changesLoading ? 'spin' : ''} />刷新</button></div></div>{!project ? <section className="card large-empty"><Empty icon={FilePenLine} title="先选择一个项目"><p>添加本地项目后，即可查看 Git 状态和文件差异。</p><button className="button" onClick={() => void addProject()}><FolderPlus size={16} />添加项目</button></Empty></section> : changesLoading ? <section className="card loading-panel"><LoaderCircle className="spin" size={24} /><span>正在读取工作区修改…</span></section> : !changes?.git ? <section className="card large-empty"><Empty icon={FilePenLine} title="暂时无法查看修改"><p>{changes?.message || '等待读取项目状态。'}</p></Empty></section> : !changes.files.length ? <section className="card large-empty"><Empty icon={CheckCircle2} title="工作区是干净的"><p>这个项目没有尚未提交的文件修改。</p></Empty></section> : <div className="changes-layout"><section className="card file-list"><div className="file-list-heading">修改的文件 <span>{changes.files.length}</span></div>{changes.files.map(file => <button key={file.path} className={`file-row ${filePath === file.path ? 'selected' : ''}`} onClick={() => setFilePath(file.path)}><FileCode2 size={16} /><span title={file.path}>{file.path}</span><code>{file.status}</code></button>)}</section><section className="card diff-panel"><div className="diff-heading"><FileCode2 size={16} /><span>{filePath}</span><span className="read-only">只读</span></div>{diffLoading ? <div className="loading-panel"><LoaderCircle size={23} className="spin" /><span>正在读取差异…</span></div> : <pre className="diff-content" tabIndex={0} aria-label="文件差异">{diff ? diff.split('\n').map((line, index) => <span className={line.startsWith('+') ? 'diff-added' : line.startsWith('-') ? 'diff-removed' : line.startsWith('@@') ? 'diff-hunk' : ''} key={index}>{line || ' '}{'\n'}</span>) : '该文件没有可显示的文本差异。'}</pre>}</section></div>}<p className="footnote">这里只读取 Git 状态和差异，不会自动提交或丢弃你的修改。</p></>}

      {page === '设置' && <><div className="page-title"><div><h1>设置</h1><p>连接本机运行环境，让工作顺畅开始。</p></div></div><div className="settings-layout"><ModelConnections data={data} disabledReason={!desktop ? "请在桌面应用中保存 API 配置。" : busy || data.runtime.busy ? "当前正在处理任务或验证连接，结束后即可保存或切换配置。" : ""} mutate={mutate} /><form className="card settings-form" onSubmit={event => { event.preventDefault(); void mutate('save_settings', { settings }).then(snapshot => { if (snapshot) setNotice('运行设置已保存。'); }); }}><div className="card-heading"><h2>高级运行设置</h2><Settings2 size={19} className="muted" /></div><label className="field"><span>Harness 路径 <small>可选</small></span><input value={settings.harnessPath} onChange={event => setSettings(previous => ({ ...previous, harnessPath: event.target.value }))} placeholder="自动检测本机安装，或填写安装目录" spellCheck={false} /><span className="field-help">填写已有 Harness 安装目录；留空时使用自动检测。</span><button className="button" type="button" disabled={!desktop || !!busy} onClick={() => void browseHarness()}><FolderOpen size={15} />选择安装目录</button></label>{!settings.activeConnectionId && <HarnessModels settings={settings} onChange={setSettings} disabled={!!busy || !!data.runtime.busy || !desktop} />}<label className="field"><span>当前模型来源</span><select value={settings.activeConnectionId} onChange={event => setSettings(previous => ({ ...previous, activeConnectionId: event.target.value }))}><option value="">已有 Harness 配置</option>{data.connections.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></label><div className="settings-note"><TerminalSquare size={18} /><span>第一次使用？在上方“模型 API”添加服务商信息并选择“使用”。使用已添加的 API 时，点击对应配置的“更换模型 / 编辑”。使用已有 Harness 配置时，先检测，再选择服务商与模型并保存。</span></div><div className="settings-actions"><button className="button primary" disabled={!!busy || !desktop} type="submit">{busy === 'save_settings' && <LoaderCircle size={15} className="spin" />}保存设置</button></div></form><section className="card runtime-settings"><div className="card-heading"><h2>环境状态</h2><span className={`dot ${data.runtime.connected ? 'green' : ''}`} /></div><h3>{runtimeLabel}</h3><p className="runtime-message">{data.runtime.message}</p><dl className="settings-runtime-list"><dt>Node.js</dt><dd>{data.runtime.nodeVersion}</dd><dt>Node 路径</dt><dd>{data.runtime.nodePath || '尚未检测'}</dd><dt>Harness 版本</dt><dd>{data.runtime.harnessVersion || '--'}</dd><dt>Harness 路径</dt><dd>{data.runtime.harnessPath || '尚未检测'}</dd><dt>环境来源</dt><dd>{data.runtime.source === 'bundled' ? '应用内置' : data.runtime.source === 'local' ? '本机安装' : '尚未检测'}</dd></dl><button className="button full-width" disabled={!!busy || !desktop} onClick={() => void mutate('check_runtime')}><RefreshCw size={16} className={busy === 'check_runtime' ? 'spin' : ''} />{busy === 'check_runtime' ? '正在验证连接…' : '检测并验证连接'}</button><p className="footnote">保存配置后验证连接。验证成功表示运行环境已就绪。模型权限与可用额度将在任务请求时验证。</p></section></div></>}
    </main><DeepSeekChat active={workspaceMode === 'chat'} suspended={appearanceOpen} /><DeepSeekAccount hidden={workspaceMode === 'chat'} onOfficialLogin={() => setWorkspaceMode('chat')} /></div>
  </div>;
}
