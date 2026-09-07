import React, { useState } from 'react';
import type { Artifact } from './coreModels';
import { bridge } from './api';

function ArtifactRow({ artifact }: { artifact: Artifact }) {
  const [details, setDetails] = useState<(Artifact & { availability?: string }) | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(operation: string, location = false) {
    setBusy(true); setError('');
    try {
      const result = await bridge<Artifact & { availability?: string }>(operation, { artifactId: artifact.id, location });
      if (operation === 'artifact_details') setDetails(details ? null : result);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <li>
    <div className="artifact-row"><code className="file-path">{artifact.path}</code>
      <span className="muted">{{ created: '新增', modified: '修改', deleted: '删除', renamed: '重命名' }[artifact.changeType]}</span>
      <button disabled={busy} onClick={() => void act('artifact_details')}>{details ? '收起对比' : '查看对比'}</button>
      <button disabled={busy || artifact.changeType === 'deleted'} onClick={() => void act('open_artifact')}>打开文件</button>
      <button disabled={busy} onClick={() => void act('open_artifact', true)}>打开位置</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {details && <div className="artifact-preview">
      {details.availability === 'missing' && <p>文件已不存在，以下为执行时保存的对比。</p>}
      {details.availability === 'modified' && <p>文件在本次执行后又有修改，以下为执行时保存的对比。</p>}
      <pre>{details.diff || '没有文本对比。'}</pre>
    </div>}
  </li>;
}

export default function ArtifactBlock({ artifacts }: { artifacts: Artifact[] }) {
  if (!artifacts || artifacts.length === 0) return <div className="artifact-list muted">无产出文件</div>;
  return (
    <div className="artifact-list">
      <h4>文件成果</h4>
      <ul>
        {artifacts.map(a => <ArtifactRow key={a.id} artifact={a} />)}
      </ul>
    </div>
  );
}
