import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, LogIn, Settings2, X } from 'lucide-react';

export default function DeepSeekAccount({ hidden, onOfficialLogin }: { hidden?: boolean; onOfficialLogin: () => void }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  if (hidden) return null;
  return <div ref={panel} className="deepseek-account">
    {open && <div className="deepseek-account-panel" role="dialog" aria-label="连接 DeepSeek 账号">
      <div className="account-panel-title"><img src="/app-icon.png" alt="" /><div><strong>连接 DeepSeek 账号</strong><span>登录后仍保留当前工作对话</span></div><button className="icon-button" aria-label="关闭登录面板" onClick={() => setOpen(false)}><X size={16} /></button></div>
      <button className="button primary full-width" onClick={() => { setOpen(false); onOfficialLogin(); }}><ExternalLink size={15} />打开官方登录</button>
      <div className="account-divider"><span>工作模式</span></div>
      <p><Settings2 size={14} />项目对话继续使用“设置”中的 API，官网登录不会覆盖 API 配置。</p>
    </div>}
    <button className={`deepseek-account-trigger ${open ? 'active' : ''}`} aria-expanded={open} onClick={() => setOpen(value => !value)}><img src="/app-icon.png" alt="" /><span>登录 DeepSeek</span><LogIn size={14} /></button>
  </div>;
}
