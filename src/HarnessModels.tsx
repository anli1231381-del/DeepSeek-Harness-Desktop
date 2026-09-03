import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { bridge } from './api';
import ModelSelect from './ModelSelect';
import type { HarnessCatalog, Settings } from './types';

export default function HarnessModels({ settings, onChange, disabled }: { settings: Settings; onChange: (settings: Settings) => void; disabled: boolean }) {
  const [catalog, setCatalog] = useState<HarnessCatalog>({ providers: [], message: '' });
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [custom, setCustom] = useState(false);
  const currentPath = useRef(settings.harnessPath);
  currentPath.current = settings.harnessPath;
  useEffect(() => { setCatalog({ providers: [], message: '' }); }, [settings.harnessPath]);
  const provider = catalog.providers.find(item => item.id === settings.provider);
  return <>
    <div className="model-discovery"><button className="button" type="button" disabled={disabled || checking} onClick={() => {
      setChecking(true); setError('');
      const path = settings.harnessPath;
      void bridge<HarnessCatalog>('harness_catalog', { harnessPath: path }).then(result => { if (currentPath.current === path) setCatalog(result); }).catch(reason => { if (currentPath.current === path) setError(String(reason)); }).finally(() => setChecking(false));
    }}><RefreshCw size={15} className={checking ? 'spin' : ''} />{checking ? '正在检测…' : '检测已有配置'}</button></div>
    {catalog.message && <p className="field-help catalog-message" role="status">{catalog.message}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <label className="field"><span>Harness 服务商</span><select aria-label="Harness 服务商" disabled={disabled} value={custom ? '__custom__' : settings.provider} onChange={event => {
      const id = event.target.value; setCustom(id === '__custom__');
      if (id !== '__custom__') onChange({ ...settings, provider: id, model: catalog.providers.find(item => item.id === id)?.models[0]?.id || '' });
    }}>{!provider && <option value={settings.provider}>{settings.provider}（当前填写）</option>}{catalog.providers.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}<option value="__custom__">手动填写服务商…</option></select>
    {custom && <input aria-label="自定义 Harness 服务商" required maxLength={200} value={settings.provider} onChange={event => onChange({ ...settings, provider: event.target.value })} />}</label>
    <ModelSelect key={settings.provider} label="Harness 模型" value={settings.model} models={provider?.models || []} disabled={disabled} onChange={value => onChange({ ...settings, model: value })} />
  </>;
}
