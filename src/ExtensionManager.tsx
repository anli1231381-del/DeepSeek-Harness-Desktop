import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, FolderOpen, Github, LoaderCircle, Plug, Puzzle, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { bridge, chooseFolder, desktop } from './api';
import type { Project } from './types';

type Skill = { id: string; name: string; description: string; enabled: boolean; scope: 'global' | 'project'; projectPath?: string; status: string; loaded: boolean; discovered: boolean; validationError?: string; source?: { kind: string; url?: string; repo?: string; commit?: string; dependencies?: string } };
type Mcp = { id: string; name: string; transport: string; enabled: boolean; scope: 'global' | 'project'; status: string; loaded: boolean; hasSecret: boolean; tools?: { name: string }[]; testError?: string };
type ExtensionSnapshot = { skills: Skill[]; mcpServers: Mcp[] };
type GitState = { installed: boolean; version: string; guideUrl: string; message?: string };

export default function ExtensionManager({ projects, currentProjectId }: { projects: Project[]; currentProjectId: string }) {
  const project = projects.find(item => item.id === currentProjectId);
  const [data, setData] = useState<ExtensionSnapshot>({ skills: [], mcpServers: [] });
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [githubUrl, setGithubUrl] = useState('');
  const [mcpMode, setMcpMode] = useState<'remote' | 'local' | 'import'>('remote');
  const [mcpName, setMcpName] = useState('');
  const [mcpAddress, setMcpAddress] = useState('');
  const [mcpConfig, setMcpConfig] = useState('');
  const [git, setGit] = useState<GitState>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const params = { projectPath: scope === 'project' ? project?.path || '' : '', scope };
  async function refresh() {
    const result = await bridge<ExtensionSnapshot>('extensions_snapshot', { projectPath: project?.path || '' });
    setData(result);
  }
  useEffect(() => { if (desktop) void refresh().catch(reason => setError(String(reason))); }, [project?.path]);
  async function act(name: string, operation: string, values: Record<string, unknown> = {}) {
    setBusy(name); setError(''); setNotice('');
    try { await bridge(operation, values); await refresh(); setNotice('操作已完成，新的执行会使用最新配置。'); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(''); }
  }
  async function importLocal() {
    try { const path = await chooseFolder(); if (path) await act('skill', 'skill_import', { ...params, path }); }
    catch (reason) { setError(String(reason)); }
  }
  async function detectGit() {
    setBusy('git'); setError('');
    try { setGit(await bridge<GitState>('git_detect')); } catch (reason) { setError(String(reason)); }
    finally { setBusy(''); }
  }
  return <div className="extensions-page">
    <div className="page-title"><div><h1>扩展管理</h1><p>安装 Skill、连接 MCP，并检查 Git。启用项会在下一次对话执行时加载。</p></div><label className="scope-picker">使用范围<select value={scope} onChange={event => setScope(event.target.value as 'global' | 'project')}><option value="global">全局使用</option><option value="project" disabled={!project}>仅当前项目{project ? ` · ${project.name}` : '（请先选择项目）'}</option></select></label></div>
    {error && <div className="banner error-banner" role="alert"><XCircle size={17} />{error}</div>}
    {notice && <div className="banner notice-banner" role="status"><CheckCircle2 size={17} />{notice}</div>}
    <div className="extension-grid">
      <section className="card extension-card"><div className="card-heading"><div><Puzzle size={19} /><h2>Skills</h2></div><button className="button" disabled={!desktop || !!busy} onClick={() => void importLocal()}><FolderOpen size={15} />导入本地 Skill</button></div>
        <p className="extension-help">选择包含 SKILL.md 的文件夹。状态会区分“已发现”和“已加载”。</p>
        <div className="extension-list">{data.skills.length ? data.skills.map(skill => <article key={skill.id}><div><strong>{skill.name}</strong><p>{skill.description}</p><small>{skill.scope === 'global' ? '全局' : '当前项目'} · {skill.loaded ? '已加载' : skill.discovered ? '已发现，将在新执行中加载' : skill.status}{skill.validationError ? ` · ${skill.validationError}` : ''}</small></div><div className="extension-actions"><button className="button small" onClick={() => void act(skill.id, 'skill_toggle', { id: skill.id, enabled: !skill.enabled })}>{skill.enabled ? '停用' : '启用'}</button><button className="icon-button" aria-label={`删除 ${skill.name}`} onClick={() => void act(skill.id, 'skill_remove', { id: skill.id })}><Trash2 size={15} /></button></div></article>) : <p className="empty-line">尚未导入 Skill</p>}</div>
      </section>
      <section className="card extension-card"><div className="card-heading"><div><Github size={19} /><h2>从 GitHub 安装</h2></div></div>
        <p className="extension-help">支持公开仓库或具体 tree 目录。只复制 Skill 文件，不运行仓库脚本。</p>
        <label className="field"><span>GitHub 链接</span><input value={githubUrl} onChange={event => setGithubUrl(event.target.value)} placeholder="https://github.com/owner/repo/tree/main/skill" /></label>
        <button className="button primary" disabled={!githubUrl.trim() || !!busy} onClick={() => void act('github', 'github_import', { ...params, url: githubUrl.trim() }).then(() => setGithubUrl(''))}>{busy === 'github' ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}识别并安装</button>
        {data.skills.filter(skill => skill.source?.kind === 'github').map(skill => <div className="github-source" key={skill.id}><strong>{skill.name}</strong><span>{skill.source?.repo} · {skill.source?.commit?.slice(0, 8)}</span><small>{skill.source?.dependencies}</small><button className="text-button" onClick={() => void act(skill.id, 'github_update', { id: skill.id })}>检查并更新</button></div>)}
      </section>
      <section className="card extension-card"><div className="card-heading"><div><Plug size={19} /><h2>MCP 服务</h2></div></div>
        <div className="mini-tabs">{(['remote', 'local', 'import'] as const).map(mode => <button key={mode} className={mcpMode === mode ? 'active' : ''} onClick={() => setMcpMode(mode)}>{mode === 'remote' ? '远程服务' : mode === 'local' ? '本地服务' : '导入配置'}</button>)}</div>
        {mcpMode === 'import' ? <label className="field"><span>JSON 配置</span><textarea value={mcpConfig} onChange={event => setMcpConfig(event.target.value)} placeholder={'{"mcpServers":{...}}'} /></label> : <><label className="field"><span>名称</span><input value={mcpName} onChange={event => setMcpName(event.target.value)} placeholder="例如 filesystem" /></label><label className="field"><span>{mcpMode === 'remote' ? 'HTTPS 地址' : '启动程序'}</span><input value={mcpAddress} onChange={event => setMcpAddress(event.target.value)} placeholder={mcpMode === 'remote' ? 'https://example.com/mcp' : 'npx'} /></label></>}
        <button className="button primary" disabled={!!busy || (mcpMode === 'import' ? !mcpConfig.trim() : !mcpName.trim() || !mcpAddress.trim())} onClick={() => mcpMode === 'import' ? void act('mcp', 'mcp_import', { ...params, config: mcpConfig }).then(() => setMcpConfig('')) : void act('mcp', 'mcp_save', { ...params, name: mcpName, ...(mcpMode === 'remote' ? { url: mcpAddress, transport: 'streamable-http' } : { command: mcpAddress, args: [], transport: 'stdio' }) }).then(() => { setMcpName(''); setMcpAddress(''); })}>保存 MCP</button>
        <p className="extension-help">需要密钥时请在导入配置中填写 headers 或 env；密钥会加密保存。测试会真实连接并列出工具。</p>
        <div className="extension-list">{data.mcpServers.map(server => <article key={server.id}><div><strong>{server.name}</strong><p>{server.transport} · {server.hasSecret ? '已保存凭证' : '无凭证'}</p><small>{server.loaded ? '已加载' : server.status}{server.tools?.length ? ` · ${server.tools.map(tool => tool.name).join('、')}` : ''}{server.testError ? ` · ${server.testError}` : ''}</small></div><div className="extension-actions"><button className="button small" onClick={() => void act(server.id, 'mcp_test', { id: server.id })}>连接测试</button><button className="button small" onClick={() => void act(server.id, 'mcp_toggle', { id: server.id, enabled: !server.enabled })}>{server.enabled ? '停用' : '启用'}</button><button className="icon-button" aria-label={`删除 ${server.name}`} onClick={() => void act(server.id, 'mcp_remove', { id: server.id })}><Trash2 size={15} /></button></div></article>)}</div>
      </section>
      <section className="card extension-card"><div className="card-heading"><div><RefreshCw size={19} /><h2>Git 环境</h2></div><button className="button" disabled={!!busy} onClick={() => void detectGit()}>{busy === 'git' && <LoaderCircle className="spin" size={15} />}检测 Git</button></div>
        <p className="extension-help">Git 用于文件差异预览。未安装时仍可聊天和修改文件。</p>
        {git ? <div className={`git-result ${git.installed ? 'ready' : ''}`}><strong>{git.installed ? 'Git 已安装' : '未检测到 Git'}</strong><span>{git.version || git.message}</span>{!git.installed && <a href={git.guideUrl} target="_blank" rel="noreferrer">打开安装指南</a>}</div> : <p className="empty-line">点击检测查看当前电脑的 Git 状态。</p>}
      </section>
    </div>
  </div>;
}
