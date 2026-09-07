import React from 'react';

export default function SessionHeader({ projectLabel, sessionTitle }: { projectLabel: string; sessionTitle: string }) {
  return (
    <header className="session-header">
      <div className="session-meta">
        <div className="project-name muted">{projectLabel}</div>
        <h2 className="session-title">{sessionTitle}</h2>
      </div>
      <div className="session-actions"><button className="icon-button" disabled>更多</button></div>
    </header>
  );
}
