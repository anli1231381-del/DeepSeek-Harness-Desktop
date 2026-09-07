import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, LogIn, Settings2, X } from 'lucide-react';

export default function DeepSeekAccount({ hidden, onOfficialLogin, onApiSettings }: { hidden?: boolean; onOfficialLogin: () => void; onApiSettings: () => void }) {
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
      <button className="account-close icon-button" aria-label="关闭登录面板" onClick={() => setOpen(false)}><X size={15} /></button>
      <img className="account-logo" src="/app-icon.png" alt="" />
      <div className="account-panel-title"><strong>连接 DeepSeek 账号</strong><span>登录后使用官网对话</span></div>
      <button className="button primary full-width" onClick={() => { setOpen(false); onOfficialLogin(); }}><ExternalLink size={15} />打开官方登录</button>
      <p className="account-verify">通过 DeepSeek 官方页面完成认证</p>
      <div className="account-divider" />
      <button className="account-api-link" aria-label="工作模式 API 设置" onClick={() => { setOpen(false); onApiSettings(); }}><Settings2 size={14} />工作模式 API 设置 <span>→</span></button>
    </div>}
    <button className={`deepseek-account-trigger ${open ? 'active' : ''}`} aria-expanded={open} onClick={() => setOpen(value => !value)}><img src="/app-icon.png" alt="" /><span>登录 DeepSeek</span><LogIn size={14} /></button>
  </div>;
}
