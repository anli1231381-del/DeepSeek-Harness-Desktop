import React, { createContext, useContext, useLayoutEffect, useState } from 'react';

export type Language = 'zh-CN' | 'en';
const LanguageContext = createContext<{ language: Language; toggle: () => void }>({ language: 'zh-CN', toggle() {} });

const english: Record<string, string> = {
  '桌面助手': 'Assistant', '首页': 'Home', '项目': 'Projects', '扩展': 'Extensions', '任务': 'Tasks', '修改': 'Changes', '设置': 'Settings',
  '工作台': 'Workspace', '对话': 'Chat', '未选择会话': 'No conversation selected', '外观': 'Appearance', '本地工作空间': 'Local workspace', '浏览器预览 · 未连接': 'Browser preview · disconnected',
  '主导航': 'Main navigation', '界面外观': 'Appearance', '关闭外观设置': 'Close appearance settings', '显示模式': 'Display mode', '浅色': 'Light', '深色': 'Dark', '跟随系统': 'System', '主题色': 'Accent color', '蓝色': 'Blue', '绿色': 'Green', '紫色': 'Purple', '琥珀': 'Amber', '石墨': 'Graphite', '即时生效，自动保存偏好': 'Applies instantly and saves automatically', '恢复默认': 'Reset',
  '新对话': 'New conversation', '未关联项目': 'No project linked', '关联项目（可选）': 'Link project (optional)', '添加并关联文件夹': 'Add and link folder', '将在首次发送时创建独立目录': 'A private workspace will be created on first send',
  '正在准备对话…': 'Preparing conversation…', '继续描述需求，或直接追问…': 'Continue your request or ask a follow-up…', '消息输入': 'Message input', '发送': 'Send', '发送中…': 'Sending…', '无需关联项目也能交流；需要操作文件时再选择项目。': 'Chat without a project; link one only when files are needed.',
  '还没有消息，开始描述你的需求。': 'No messages yet. Describe what you need.', '你': 'You', '复制': 'Copy', '等待开始': 'Waiting to start', '正在思考与执行': 'Working', '等待中': 'Queued', '进行中': 'In progress', '等待确认': 'Waiting for approval', '已完成': 'Completed', '失败': 'Failed', '已停止': 'Stopped', '已中断': 'Interrupted', '来自真实执行事件与工具记录': 'Observable actions and tool records', '状态：': 'Status: ', '执行已停止，可能存在部分修改。': 'Execution stopped; some changes may remain.',
  '你的项目': 'Your projects', '从本地文件夹开始，随时继续工作。': 'Choose a local folder and continue your work anytime.', '添加项目': 'Add project', '让第一个项目就位': 'Add your first project', '选择一个本地文件夹，Harness 就可以了解并处理这个项目。': 'Choose a local folder so Harness can understand and work on it.', '选择项目文件夹': 'Choose project folder', '从列表移除项目只会忘记该项目，不会删除本地文件。': 'Removing a project only forgets it; local files remain.', '继续工作': 'Continue', '进入项目': 'Open project',
  '扩展管理': 'Extension manager', '安装 Skill、连接 MCP，并检查 Git。启用项会在下一次对话执行时加载。': 'Install Skills, connect MCP services, and check Git. Enabled items load on the next run.', '使用范围': 'Scope', '全局使用': 'Global', '仅当前项目': 'Current project only', '导入本地 Skill': 'Import local Skill', '尚未导入 Skill': 'No Skills imported', '从 GitHub 安装': 'Install from GitHub', 'GitHub 链接': 'GitHub URL', '识别并安装': 'Detect and install', '检查并更新': 'Check for updates', 'MCP 服务': 'MCP services', '远程服务': 'Remote', '本地服务': 'Local', '导入配置': 'Import config', 'JSON 配置': 'JSON config', '名称': 'Name', 'HTTPS 地址': 'HTTPS URL', '启动程序': 'Command', '保存 MCP': 'Save MCP', '连接测试': 'Test connection', '停用': 'Disable', '启用': 'Enable',
  '选择包含 SKILL.md 的文件夹。状态会区分“已发现”和“已加载”。': 'Choose a folder containing SKILL.md. Status shows whether it was discovered or loaded.', '支持公开仓库或具体 tree 目录。只复制 Skill 文件，不运行仓库脚本。': 'Public repositories and specific tree folders are supported. Repository scripts are never run.', '需要密钥时请在导入配置中填写 headers 或 env；密钥会加密保存。测试会真实连接并列出工具。': 'Add required keys in headers or env when importing. Keys are encrypted; connection tests list the available tools.', '（请先选择项目）': ' (select a project first)', '全局': 'Global', '当前项目': 'Current project', '已加载': 'Loaded', '已发现，将在新执行中加载': 'Discovered; loads on the next run', '已保存凭证': 'Credentials saved', '无凭证': 'No credentials', '操作已完成，新的执行会使用最新配置。': 'Done. New runs will use the latest configuration.', 'Git 安装完成，请重新启动应用后再次检测。': 'Git installation finished. Restart the app and check again.',
  'Git 环境': 'Git environment', '检测 Git': 'Check Git', 'Git 用于文件差异预览。未安装时仍可聊天和修改文件。': 'Git enables change previews. Chat and file editing still work without it.', 'Git 已安装': 'Git installed', '未检测到 Git': 'Git not found', '一键安装 Git': 'Install Git', '重新检测': 'Check again', '打开安装指南': 'Open install guide', '点击检测查看当前电脑的 Git 状态。': 'Check the Git status on this computer.',
  '工作区修改': 'Workspace changes', '查看项目中全部尚未提交的修改，包括你和其他工具的更改。': 'Review all uncommitted changes in the project.', '刷新': 'Refresh', '先选择一个项目': 'Select a project first', '正在读取工作区修改…': 'Reading workspace changes…', '暂时无法查看修改': 'Changes unavailable', '工作区是干净的': 'Workspace is clean', '修改的文件': 'Changed files', '只读': 'Read only',
  '连接本机运行环境，让工作顺畅开始。': 'Connect the local runtime and start working.', '模型 API': 'Model APIs', '高级运行设置': 'Advanced runtime settings', 'Harness 路径': 'Harness path', '可选': 'Optional', '当前模型来源': 'Current model source', '已有 Harness 配置': 'Existing Harness config', '保存设置': 'Save settings', '环境状态': 'Environment status', '检测并验证连接': 'Check and verify connection', '正在验证连接…': 'Checking connection…', '应用内置': 'Bundled', '本机安装': 'Installed locally', '尚未检测': 'Not detected',
  '自动检测本机安装，或填写安装目录': 'Detect automatically or enter an install folder', '填写已有 Harness 安装目录；留空时使用自动检测。': 'Enter an existing Harness folder, or leave blank for automatic detection.', '选择安装目录': 'Choose install folder', '检测已有配置': 'Detect existing config', 'Harness 服务商': 'Harness provider', 'Harness 模型': 'Harness model', 'Node 路径': 'Node path', 'Harness 版本': 'Harness version', '环境来源': 'Environment source',
  '第一次使用？在上方“模型 API”添加服务商信息并选择“使用”。使用已添加的 API 时，点击对应配置的“更换模型 / 编辑”。使用已有 Harness 配置时，先检测，再选择服务商与模型并保存。': 'First time? Add a provider under Model APIs and select Use. To change a saved API model, choose Change model / Edit. For an existing Harness config, detect it first, then choose a provider and model.', '保存配置后验证连接。验证成功表示运行环境已就绪。模型权限与可用额度将在任务请求时验证。': 'Verify after saving. A successful check means the runtime is ready; model access and quota are checked when a request runs.',
  '桌面环境未连接': 'Desktop runtime disconnected', '连接已验证': 'Connection verified', '环境已检测，待验证': 'Environment found, verification pending', '环境待配置': 'Environment needs setup', '查看环境': 'View environment', '本地工作 · 自由连接': 'Local work · flexible connections',
  '登录 DeepSeek': 'Sign in to DeepSeek', '连接 DeepSeek 账号': 'Connect DeepSeek account', '登录后使用官网对话': 'Sign in to use official chat', '打开官方登录': 'Open official sign-in', '通过 DeepSeek 官方页面完成认证': 'Authentication is completed on DeepSeek’s official site', '工作模式 API 设置': 'Work API settings', '关闭登录面板': 'Close sign-in panel',
  '准备工作目录': 'Prepare workspace', '记录执行前文件状态': 'Record initial files', '启动 Harness': 'Start Harness', '处理本轮需求': 'Process request', '捕获文件成果': 'Capture file results', '查看详情': 'View details', '复制错误': 'Copy error', '再次执行': 'Run again',
  '添加 API': 'Add API', '编辑 API': 'Edit API', '服务商': 'Provider', '接口协议': 'Protocol', '配置名称': 'Connection name', 'API 地址': 'API URL', 'API 密钥': 'API key', '模型名称': 'Model', '获取模型': 'Get models', '正在获取模型…': 'Loading models…', '保存 API': 'Save API', '正在保存…': 'Saving…', '取消': 'Cancel', '使用': 'Use', '当前使用': 'In use', '更换模型 / 编辑': 'Change model / Edit', '确认删除': 'Confirm delete', '密钥已保存': 'Key saved', '未填写密钥': 'No key', '自定义 / 其他服务商': 'Custom / other provider',
  '选择服务商后自动填写接口。填好密钥，模型列表将自动加载。': 'Choose a provider to fill the endpoint. Models load after you enter a key.', '添加服务商的连接信息，然后选择“使用”。每个 API 都可以获取并切换模型。': 'Add a provider connection, then select Use. Each connection can load and switch models.', '请选择模型': 'Choose a model', '先获取模型，或选择手动填写': 'Load models or enter one manually', '手动填写模型 ID…': 'Enter model ID manually…', '填写服务商提供的模型 ID': 'Enter the model ID from your provider',
  '对话名称': 'Conversation title', '执行或排队期间保留当前目录，结束后可切换项目。': 'The current directory stays fixed while work is running or queued.', '加载会话失败：': 'Failed to load conversation: ', '正在加载会话…': 'Loading conversation…', '＋ 新建对话': '+ New conversation', '无未关联会话': 'No unlinked conversations', '排队中': 'Queued',
  '新增': 'Created', '删除': 'Deleted', '重命名': 'Renamed', '收起对比': 'Hide diff', '查看对比': 'View diff', '打开文件': 'Open file', '打开位置': 'Open location', '文件成果': 'File results', '无产出文件': 'No output files', '没有文本对比。': 'No text diff.',
  '工作模式': 'Work mode', '返回工作': 'Back to work', '对话模式': 'Chat mode', '官网对话': 'Official chat', 'DeepSeek 官网': 'DeepSeek website', '刷新网页': 'Reload page', '在浏览器打开': 'Open in browser',
  '任务记录': 'Task history', '每一步工作，都有真实记录可循。': 'Every observable work step is recorded.', '新建任务': 'New task', '任务列表': 'Task list', '任务详情': 'Task details', '工作记录': 'Work log', '助手输出': 'Response', '还没有任务记录': 'No task history', '创建一个任务，查看 Harness 的工作过程和执行结果。': 'Create a task to see its work process and result.', '开始第一个任务': 'Start first task',
  '桌面界面': 'Desktop UI', '模型连接': 'Model connection', 'WebView2 已启动': 'WebView2 is running', '已检测': 'Detected', '尚未验证': 'Not verified', '未安装；需要时可一键安装': 'Not installed; install it when needed', '本轮工作已完成': 'Work completed', '模型执行失败': 'Model execution failed', '模拟回复（真实执行失败）': 'Simulated reply (real execution failed)',
  'Language': 'Language'
};

const originals = new WeakMap<Node, string>();
const originalAttrs = new WeakMap<Element, Map<string, string>>();
export function translateText(value: string, language: Language) {
  if (language === 'zh-CN') return value;
  const leading = value.match(/^\s*/)?.[0] || '', trailing = value.match(/\s*$/)?.[0] || '';
  const core = value.slice(leading.length, value.length - trailing.length);
  if (english[core]) return leading + english[core] + trailing;
  if (/^用时\s/.test(core)) return leading + core.replace(/^用时/, 'Elapsed').replace('分钟', 'm ').replace('秒', 's') + trailing;
  if (core.startsWith('当前操作目录：')) return leading + core.replace('当前操作目录：', 'Current directory: ') + trailing;
  if (core.startsWith('状态：')) return leading + core.replace('状态：', 'Status: ') + trailing;
  if (/^.+ · 应用内置$/.test(core)) return leading + core.replace('应用内置', 'Bundled') + trailing;
  if (core.includes('（当前填写）')) return leading + core.replaceAll('（当前填写）', ' (current)') + trailing;
  return value;
}

function translateDom(root: Node, language: Language) {
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const current = node.textContent || '', previous = originals.get(node);
      if (previous === undefined || (current !== previous && current !== translateText(previous, 'en'))) originals.set(node, current);
      const translated = translateText(originals.get(node) || '', language);
      if (node.textContent !== translated) node.textContent = translated;
      return;
    }
    if (!(node instanceof Element) || node.matches('.message-content, .project-path, .diff-content, .step-detail, .runtime-detail, .error-detail, .assistant-response, .activity-list, code, pre')) return;
    for (const name of ['aria-label', 'title', 'placeholder']) if (node.hasAttribute(name)) {
      let values = originalAttrs.get(node); if (!values) { values = new Map(); originalAttrs.set(node, values); }
      const current = node.getAttribute(name) || '', previous = values.get(name);
      if (previous === undefined || (current !== previous && current !== translateText(previous, 'en'))) values.set(name, current);
      const translated = translateText(values.get(name) || '', language);
      if (node.getAttribute(name) !== translated) node.setAttribute(name, translated);
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem('harness-language') === 'en' ? 'en' : 'zh-CN');
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    translateDom(document.body, language);
    const observer = new MutationObserver(records => records.forEach(record => record.type === 'childList' ? record.addedNodes.forEach(node => translateDom(node, language)) : translateDom(record.target, language)));
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
    localStorage.setItem('harness-language', language);
    return () => observer.disconnect();
  }, [language]);
  return <LanguageContext.Provider value={{ language, toggle: () => setLanguage(value => value === 'zh-CN' ? 'en' : 'zh-CN') }}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
