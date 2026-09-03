import { useEffect, useState } from 'react';

export const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
const luminance = (channels: number[]) => channels.reduce((sum, value, i) => sum + (value / 255 <= .04045 ? value / 3294.6 : ((value / 255 + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i], 0);
export function applyColor(color: string, dark: boolean) {
  const root = document.documentElement;
  const channels = rgb(color);
  const surface = luminance(rgb(dark ? '#20242c' : '#ffffff'));
  let foreground = [...channels];
  for (let step = 0; step <= 100; step++) {
    foreground = channels.map(value => Math.round(value + ((dark ? 255 : 0) - value) * step / 100));
    const light = luminance(foreground);
    if ((Math.max(surface, light) + .05) / (Math.min(surface, light) + .05) >= 4.5) break;
  }
  root.style.setProperty('--accent', `rgb(${foreground.join(',')})`);
  root.style.setProperty('--accent-fill', color);
  root.style.setProperty('--on-accent', luminance(channels) > .179 ? '#101217' : '#ffffff');
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${color} ${dark ? 18 : 9}%, var(--surface))`);
  root.style.setProperty('--accent-border', `color-mix(in srgb, ${color} 35%, var(--line))`);
}

export default function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return <div className="custom-color"><label className="palette-input"><input type="color" aria-label="主题色色盘" value={value} onChange={event => onChange(event.target.value)} /><span>打开色盘，自由选色</span></label><label className="hex-input"><span>HEX</span><input aria-label="主题色 HEX" value={hex} maxLength={7} spellCheck={false} onChange={event => { setHex(event.target.value); if (isColor(event.target.value)) onChange(event.target.value.toLowerCase()); }} onBlur={() => setHex(value)} /></label></div>;
}
