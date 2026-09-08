import React from 'react';
import type { Message, Execution, Artifact } from './coreModels';
import ExecutionBlock from './ExecutionBlock';
import ArtifactBlock from './ArtifactBlock';

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}

function renderContent(content: string) {
  const parts = content.split(/```([\s\S]*?)```/g);
  return parts.map((part, i) => i % 2 === 1 ? <pre key={i} className="code-block">{part}</pre> : <div key={i} className="markdown-block">{part.split('\n').map((line, idx) => {
    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (!line.trim()) return <div className="markdown-space" key={idx} />;
    if (bullet) return <p className="markdown-list-item" key={idx}><span>•</span>{inline(bullet[1])}</p>;
    if (heading) return <h3 key={idx}>{inline(heading[1])}</h3>;
    return <p key={idx}>{inline(line)}</p>;
  })}</div>);
}

export default function MessageTimeline({ messages, executions, artifacts, onRetry }: { messages: Message[]; executions: Execution[]; artifacts: Artifact[]; onRetry?: (execution: Execution) => void }) {
  // Build a simple merged timeline: messages and executions interleaved by createdAt
  type Item = { type: 'message' | 'execution' | 'artifact'; at: string; id: string; payload: any };
  const items: Item[] = [];
  messages.forEach(m => items.push({ type: 'message', at: m.createdAt || '', id: m.id, payload: m }));
  executions.forEach(e => items.push({ type: 'execution', at: e.createdAt || '', id: e.id, payload: e }));
  // artifacts will be shown under executions instead of independently
  items.sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="message-timeline" role="list">
      {items.length === 0 && <div className="empty muted">还没有消息，开始描述你的需求。</div>}
      {items.map(item => item.type === 'message' ? (
        <div key={item.id} className={`message ${item.payload.role}`}>{item.payload.role !== 'assistant' && <div className="message-role">{item.payload.role === 'user' ? '你' : item.payload.role}</div>}<div className="message-bubble"><div className="message-content">{renderContent(item.payload.content)}</div><div className="message-meta"><time>{new Date(item.at).toLocaleString()}</time><button className="text-button" onClick={() => navigator.clipboard?.writeText(item.payload.content)}>复制</button></div></div></div>
      ) : (
        <div key={item.id} className="execution-wrapper"><ExecutionBlock execution={item.payload} artifacts={artifacts.filter(a => a.executionId === item.payload.id)} onRetry={onRetry} /></div>
      ))}
    </div>
  );
}
