import { useEffect, useRef, useState } from 'react';
import { Plus, X, Trash2, Pencil, Check, RefreshCw } from 'lucide-react';
import { bridge } from './api';
import ModelSelect from './ModelSelect';
import type { AvailableModel, ModelConnection, ModelListing, Snapshot } from './types';

const blank = { id: '', name: 'DeepSeek', protocol: 'openai-completions' as ModelConnection['protocol'], baseUrl: 'https://api.deepseek.com', model: '', apiKey: '', clearApiKey: false };
const protocols = { 'openai-completions': 'OpenAI 兼容 · Chat Completions', 'openai-responses': 'OpenAI · Responses', 'anthropic-messages': 'Anthropic · Messages' };
const presets = {
  custom: { name: '自定义 / 其他服务商', protocol: 'openai-completions', address: '' },
  deepseek: { name: 'DeepSeek', protocol: 'openai-completions', address: 'https://api.deepseek.com' },
  openai: { name: 'OpenAI', protocol: 'openai-responses', address: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic / Claude', protocol: 'anthropic-messages', address: 'https://api.anthropic.com' },
} as const;
function presetForAddress(address: string): keyof typeof presets {
  if (/^https:\/\/api\.deepseek\.com(?:\/(?:v1|anthropic))?\/?$/.test(address.trim())) return 'deepseek';
  if (/^https:\/\/api\.openai\.com\/v1\/?$/.test(address.trim())) return 'openai';
  if (/^https:\/\/api\.anthropic\.com\/?$/.test(address.trim())) return 'anthropic';
  return 'custom';
}
type Draft = typeof blank;
type Props = { data: Snapshot; disabledReason: string; mutate: (operation: string, params?: Record<string, unknown>, onFailure?: (message: string) => void) => Promise<Snapshot | undefined> };

function ConnectionEditor({ initial, saved, disabledReason, mutate, close }: { initial: Draft; saved?: ModelConnection; close: () => void } & Pick<Props, 'disabledReason' | 'mutate'>) {
  const [draft, setDraft] = useState(initial);
  const [preset, setPreset] = useState(() => presetForAddress(initial.baseUrl));
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const request = useRef(0);
  const autoTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => { alive.current = false; element.close(); opener?.focus(); };
  }, []);
  const change = (field: keyof Draft, value: string | boolean) => {
    const next = { ...draft, [field]: value };
    if (field === 'protocol' && preset === 'deepseek') next.baseUrl = `https://api.deepseek.com${value === 'anthropic-messages' ? '/anthropic' : ''}`;
    if (field === 'baseUrl') {
      const provider = presetForAddress(String(value)); setPreset(provider);
      if (provider === 'anthropic' || (provider === 'deepseek' && /\/anthropic\/?$/.test(String(value)))) next.protocol = 'anthropic-messages';
      else if (provider !== 'custom' && next.protocol === 'anthropic-messages') next.protocol = presets[provider].protocol;
    }
    if (['baseUrl', 'protocol'].includes(field)) { next.apiKey = ''; next.model = ''; }
    setDraft(next); setError('');
    if (['baseUrl', 'protocol', 'apiKey', 'clearApiKey'].includes(field)) { setModels([]); setMessage(''); }
  };
  useEffect(() => {
    ++request.current; setFetching(false);
    const savedKey = saved?.hasApiKey && !draft.clearApiKey && draft.baseUrl === saved.baseUrl && draft.protocol === saved.protocol;
    if (!disabledReason && draft.baseUrl.trim() && (draft.apiKey.trim() || savedKey)) {
      autoTimer.current = window.setTimeout(() => void discover(), 800);
    }
    return () => { window.clearTimeout(autoTimer.current); ++request.current; };
  }, [draft.baseUrl, draft.protocol, draft.apiKey, draft.clearApiKey, disabledReason]);
  async function discover() {
    window.clearTimeout(autoTimer.current);
    const current = ++request.current;
    setFetching(true); setError(''); setMessage('');
    try {
      const result = await bridge<ModelListing>('api_models', { connection: draft });
      if (!alive.current || current !== request.current) return;
      setModels(result.models); setMessage(result.message);
      setDraft(previous => previous.model ? previous : { ...previous, model: result.models[0]?.id || '' });
    } catch (reason) { if (alive.current && current === request.current) setError(String(reason)); }
    finally { if (alive.current && current === request.current) setFetching(false); }
  }
  return <dialog ref={dialog} className="connection-dialog" aria-labelledby="api-editor-title" onCancel={event => { event.preventDefault(); if (!saving) close(); }}>
    <form className="connection-editor" onSubmit={event => { event.preventDefault(); setError(''); setSaving(true); void mutate('save_connection', { connection: draft }, setError).then(result => { if (result) close(); }).finally(() => { if (alive.current) setSaving(false); }); }}>
      <div className="card-heading"><div><h3 id="api-editor-title">{draft.id ? '编辑 API' : '添加 API'}</h3><p className="footnote">选择服务商后自动填写接口。填好密钥，模型列表将自动加载。</p></div><button type="button" className="icon-button" aria-label="取消编辑 API" disabled={saving} onClick={close}><X size={18} /></button></div>
      <fieldset disabled={saving} className="connection-fields">
        <label className="field"><span>服务商</span><select aria-label="服务商" autoFocus value={preset} onChange={event => {
          const id = event.target.value as keyof typeof presets; const chosen = presets[id];
          setPreset(id); setModels([]); setMessage(''); setError('');
          setDraft(previous => ({ ...previous, name: id === 'custom' ? previous.name : chosen.name, baseUrl: chosen.address, protocol: chosen.protocol, model: '', apiKey: '', clearApiKey: !!saved?.hasApiKey }));
        }}>{Object.entries(presets).map(([id, provider]) => <option key={id} value={id}>{provider.name}</option>)}</select></label>
        <label className="field"><span>接口协议</span><select aria-label="接口协议" value={draft.protocol} onChange={event => change('protocol', event.target.value)}>{Object.entries(protocols).filter(([value]) => preset === 'anthropic' ? value === 'anthropic-messages' : preset === 'openai' ? value !== 'anthropic-messages' : true).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="field"><span>配置名称</span><input required maxLength={200} value={draft.name} onChange={event => change('name', event.target.value)} placeholder="例如：我的 DeepSeek / 公司模型服务" /></label>
        <label className="field"><span>API 地址</span><input aria-label="API 地址" required type="url" maxLength={2048} value={draft.baseUrl} onChange={event => change('baseUrl', event.target.value)} placeholder="https://服务商地址/v1" spellCheck={false} /><span className="field-help">{preset !== 'custom' ? '已根据服务商和协议填写，可按需修改。' : '填写服务商提供的基础地址。'}{draft.protocol === 'anthropic-messages' ? '不含 /v1/messages。' : '不含 /chat/completions 或 /responses。'}</span></label>
        <label className="field api-key-field"><span>API 密钥</span><input aria-label="API 密钥" type="password" autoComplete="new-password" maxLength={8192} value={draft.apiKey} onChange={event => change('apiKey', event.target.value)} placeholder={saved?.hasApiKey ? '已保存，留空则保持不变' : '填写服务商提供的密钥；无需鉴权的本机服务可留空'} spellCheck={false} /><span className="field-help">密钥由 Windows 加密保存在本机。更换地址或协议后，请重新填写。</span></label>
        {saved?.hasApiKey && <label className="clear-key api-key-field"><input type="checkbox" checked={draft.clearApiKey} onChange={event => change('clearApiKey', event.target.checked)} />清除已保存的密钥</label>}
        <div className="api-key-field model-discovery"><button type="button" className="button" disabled={!!disabledReason || fetching || !draft.baseUrl.trim()} onClick={() => void discover()}><RefreshCw size={15} className={fetching ? 'spin' : ''} />{fetching ? '正在获取模型…' : '获取模型'}</button><span className="field-help">填写密钥后自动获取，也可点击重试；不支持时可手动填写。</span></div>
        <div className="api-key-field"><ModelSelect key={`${preset}:${draft.baseUrl}:${draft.protocol}`} label="模型名称" value={draft.model} models={models} onChange={value => change('model', value)} disabled={fetching} /></div>
      </fieldset>
      {message && <p className="field-help" role="status">{message}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {disabledReason && <p className="field-help" role="status">{disabledReason}</p>}
      <div className="settings-actions"><button className="button" type="button" disabled={saving} onClick={close}>取消</button><button className="button primary" type="submit" disabled={!!disabledReason || fetching || saving}>{saving ? '正在保存…' : '保存 API'}</button></div>
    </form>
  </dialog>;
}

export default function ModelConnections({ data, disabledReason, mutate }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState('');
  const disabled = !!disabledReason;
  return <section className="card model-connections"><div className="card-heading"><div><h2>模型 API</h2><p className="footnote">添加服务商的连接信息，然后选择“使用”。每个 API 都可以获取并切换模型。</p></div><button className="button" onClick={() => { setDraft({ ...blank }); setDeleting(''); }}><Plus size={16} />添加 API</button></div>
    {disabledReason && <p className="field-help">{disabledReason}</p>}
    <div className="connection-list"><div className="connection-row"><div><strong>已有 Harness 配置</strong><p>{!data.settings.activeConnectionId ? `${data.settings.provider} · ${data.settings.model}` : '在下方检测已配置的服务商与模型'}</p></div><button className="button" disabled={disabled || !data.settings.activeConnectionId} onClick={() => void mutate('save_settings', { settings: { ...data.settings, activeConnectionId: '' } })}>{!data.settings.activeConnectionId ? <><Check size={14} />当前使用</> : '使用'}</button></div>
    {data.connections.map(connection => <div className="connection-row" key={connection.id}><div><strong>{connection.name}</strong><p>{connection.model} · {protocols[connection.protocol]}</p><p>{connection.baseUrl} · {connection.hasApiKey ? '密钥已保存' : '未填写密钥'}</p></div><div className="connection-actions"><button className="button" disabled={disabled || data.settings.activeConnectionId === connection.id} onClick={() => void mutate('save_settings', { settings: { ...data.settings, activeConnectionId: connection.id } })}>{data.settings.activeConnectionId === connection.id ? <><Check size={14} />当前使用</> : '使用'}</button><button className="button" aria-label={`编辑 ${connection.name}`} onClick={() => { setDraft({ ...connection, apiKey: '', clearApiKey: false }); setDeleting(''); }}><Pencil size={15} />更换模型 / 编辑</button><button className="icon-button" aria-label={`删除 ${connection.name}`} disabled={disabled} onClick={() => setDeleting(connection.id)}><Trash2 size={15} /></button>{deleting === connection.id && <><button className="button" disabled={disabled} onClick={() => void mutate('remove_connection', { id: connection.id }).then(result => { if (result) setDeleting(''); })}>确认删除</button><button className="text-button" onClick={() => setDeleting('')}>取消</button></>}</div></div>)}</div>
    {draft && <ConnectionEditor initial={draft} saved={data.connections.find(item => item.id === draft.id)} disabledReason={disabledReason} mutate={mutate} close={() => setDraft(null)} />}
  </section>;
}
