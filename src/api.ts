import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Snapshot } from './types';

export const desktop = isTauri();
export const emptySnapshot: Snapshot = {
  projects: [], tasks: [], connections: [], settings: { harnessPath: '', provider: 'deepseek-official', model: 'deepseek-v4-flash', activeConnectionId: '' },
  runtime: { available: false, connected: false, nodeVersion: '--', nodePath: '', harnessPath: '', harnessVersion: '--', source: 'missing', message: desktop ? '正在检测本机运行环境…' : '浏览器预览未连接桌面环境，请在桌面应用中使用本地项目与任务。' },
};

export async function bridge<T = Snapshot>(operation: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!desktop) {
    if (operation === 'snapshot') return emptySnapshot as T;
    throw new Error('此操作需要桌面环境，请打开 Harness 桌面助手。');
  }
  return invoke<T>('bridge', { operation, params });
}

export const chooseFolder = () => invoke<string | null>('choose_folder');
export const onAppEvent = (callback: (payload: { disconnected?: boolean }) => void) => listen<{ disconnected?: boolean }>('app-event', event => callback(event.payload));
