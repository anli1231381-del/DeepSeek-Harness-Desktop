import React from 'react';
import type { Message, Execution, Artifact } from './coreModels';
import ExecutionBlock from './ExecutionBlock';
import ArtifactBlock from './ArtifactBlock';

function renderContent(content: string) {
  // very small markdown/code fence handling: split by ``` blocks
  const parts = content.split(/```([\s\S]*?)```/g);
  return parts.map((part, i) => i % 2 === 1 ? <pre key={i} className="code-block">{part}</pre> : <div key={i} className="markdown-block">{part.split('\n').map((line, idx) => <p key={idx}>{line}</p>)}</div>);
}

export default function MessageTimeline({ messages, executions, artifacts }: { messages: Message[]; executions: Execution[]; artifacts: Artifact[] }) {
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
        <div key={item.id} className={`message ${item.payload.role}`}><div className="message-role">{item.payload.role === 'user' ? '你' : 'AI'}</div><div className="message-body">{renderContent(item.payload.content)}<div className="message-meta"><time>{new Date(item.at).toLocaleString()}</time><button className="text-button" onClick={() => navigator.clipboard?.writeText(item.payload.content)}>复制</button></div></div></div>
      ) : (
        <div key={item.id} className="execution-wrapper"><ExecutionBlock execution={item.payload} artifacts={artifacts.filter(a => a.executionId === item.payload.id)} /></div>
      ))}
    </div>
  );
}
