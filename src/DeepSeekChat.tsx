import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ExternalLink, MessageCircle, RefreshCw } from 'lucide-react';
import { desktop } from './api';

const chatUrl = 'https://chat.deepseek.com/';

export default function DeepSeekChat({ active, suspended }: { active: boolean; suspended: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const queue = useRef(Promise.resolve());
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = viewport.current?.getBoundingClientRect();
        const visible = active && !suspended && !!rect && rect.width > 0 && rect.height > 0;
        const bounds = visible ? { visible, x: rect.x, y: rect.y, width: rect.width, height: rect.height } : { visible: false };
        // Keep native creation, resizing and hiding in the same order as mode changes.
        queue.current = queue.current.then(async () => {
          if (disposed) return;
          try { await invoke('chat_view', bounds); if (!disposed) setError(''); }
          catch { if (!disposed && visible) setError('暂时无法打开对话页，请重试或在浏览器中打开。'); }
        });
      });
    };
    const observer = new ResizeObserver(sync);
    if (viewport.current) observer.observe(viewport.current);
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    sync();
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
      queue.current = queue.current.then(() => invoke<void>('chat_view', { visible: false })).catch(() => {});
    };
  }, [active, suspended, retry]);

  async function reload() {
    setError('');
    try { if (desktop) await invoke('reload_chat'); }
    catch { setError('网页刷新失败，请重试或在浏览器中打开。'); }
    setRetry(value => value + 1);
  }
  async function openBrowser() {
    try {
      if (desktop) await invoke('open_deepseek_web');
      else window.open(chatUrl, '_blank', 'noopener,noreferrer');
    } catch { setError('无法打开浏览器，请访问 chat.deepseek.com。'); }
  }

  return <section className="chat-content" hidden={!active} aria-label="对话模式">
    <div className="chat-toolbar">
      <div><h1>DeepSeek 对话</h1><p>登录 DeepSeek 账号即可聊天，无需配置 API。</p></div>
      <div className="chat-actions"><button className="button" onClick={() => void reload()} disabled={!desktop}><RefreshCw size={15} />刷新网页</button><button className="button" onClick={() => void openBrowser()}><ExternalLink size={15} />在浏览器打开</button></div>
    </div>
    <div ref={viewport} className="chat-viewport">
      <div className="chat-placeholder"><MessageCircle size={32} /><p>{error || (desktop ? '正在打开 DeepSeek 官网…' : '请在桌面应用中使用对话模式，或在浏览器中打开官网。')}</p>{error && <button className="button" onClick={() => setRetry(value => value + 1)}>重试</button>}</div>
    </div>
  </section>;
}
