import { useState } from 'react';
import type { AvailableModel } from './types';

export default function ModelSelect({ label, value, models, onChange, disabled = false }: { label: string; value: string; models: AvailableModel[]; onChange: (value: string) => void; disabled?: boolean }) {
  const [custom, setCustom] = useState(false);
  const known = models.some(model => model.id === value);
  const options = value && !known ? [{ id: value, name: `${value}（当前填写）` }, ...models] : models;
  return <div className="field"><label><span>{label}</span><select aria-label={label} required disabled={disabled} value={custom ? '__custom__' : value} onChange={event => { const next = event.target.value; setCustom(next === '__custom__'); if (next !== '__custom__') onChange(next); }}>
    <option value="" disabled>{models.length ? '请选择模型' : '先获取模型，或选择手动填写'}</option>
    {options.map(model => <option key={model.id} value={model.id}>{model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id}</option>)}
    <option value="__custom__">手动填写模型 ID…</option>
  </select></label>{custom && <input aria-label={`${label}（自定义 ID）`} autoFocus required maxLength={200} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} placeholder="填写服务商提供的模型 ID" spellCheck={false} />}</div>;
}
