import {currentLocale} from './i18n';
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Schema {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  enum?: unknown[];
  enumNames?: string[];
  items?: Schema;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
  label?: string;
  options?: string[];
  min?: number;
  max?: number;
}

export interface Tool {
  name: string;
  description?: string;
  inputSchema?: Schema;
  pluginId?: string;
}

export interface Plugin {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  presentation?: {wheel:boolean};
  translations?: Record<string,Record<string,string>>;
  version?: string;
  revision?: string | number;
  ui?: string | { entry?: string; revision?: string | number };
  settings?: Schema | Record<string, Schema>;
  tools?: Array<string | Tool>;
}

export interface Notice {
  id: string;
  pluginId: string;
  key?: string;
  title: string;
  body?: string;
  priority?: string | number;
  origin?: unknown;
  actions?: Array<{ label: string; method: string; params?: Record<string, unknown> }>;
  createdAt?: number;
  dismissedAt?: number | null;
  unread?: boolean;
  decision?: unknown;
}

export interface Theme {
  mode: string;
  palette: string;
  material: string;
  wheelPlacement?: string;
  locale?: string;
}

export interface State {
  plugins: Plugin[];
  settings: Record<string, { values: Record<string, unknown> }>;
  theme: Theme;
  notifications: Notice[];
  notificationSettings?: Record<string, unknown>;
  host?: { online?: boolean; idleSeconds?: number; locked?: boolean };
}

export interface Account {
  provider: string;
  host?: string;
  username?: string;
  connected?: boolean;
  oauth?: boolean;
  configured?: boolean;
  oauthAvailable?: boolean;
}

export interface Host {
  captureClip():Promise<void>;
  beginMove():Promise<void>;
  endMove():Promise<{moved:boolean}>;
  ropeInfo():Promise<{visible:boolean;pinned?:boolean;bounds?:Rect;displayId?:string;notch?:Rect;wheelHeight?:number}>;
  ropeReposition():Promise<void>;
  ropeEditing(active:boolean):Promise<void>;
  ropeMoving(active:boolean):Promise<void>;
  startClipDrag(id:string):Promise<{dragged:boolean}>;
  prepareClipDrag(id:string,revision?:number):Promise<void>;
  oauthOptions():Promise<Record<string,{clientId?:string;hasSecret?:boolean}>>; 
  systemLocale?: string;
  rpc<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent(callback: (event: { type: string; payload: any }) => void): () => void;
  setHitAreas(rects: Rect[]): void;
  openSettings(section?: string): void;
  platform: string;
  assetUrl(id: string, mode?: 'preview' | 'thumb'): string;
  pluginUrl(id: string, revision?: string | number): string;
  filePath(file: File): string;
  pickFile(): Promise<string[]>;
  openExternal(url: string): Promise<void>;
  uiState?(snapshot: Record<string, unknown>): void;
  mcpConfig?(): Promise<unknown>;
  mcpAccess?(): Promise<string[]>;
  setMcpAccess?(groups: string[]): Promise<unknown>;
  pluginsFolder?(): Promise<string>;
  openPluginsFolder?(): Promise<void>;
  accounts?(): Promise<Account[] | { accounts: Account[]; oauth?: Record<string, boolean> }>;
  saveAccount?(input: { provider: string; host?: string; token: string }): Promise<unknown>;
  disconnectAccount?(provider: string): Promise<unknown>;
  connectAccount?(input: { provider: string; host?: string; clientId?: string;clientSecret?:string }): Promise<unknown>;
}

declare global {
  interface Window { notch: Host }
}

export const fallbackState: State = {
  plugins: [], settings: {}, notifications: [],
  theme: { mode: 'system', palette: 'graphite', material: 'glass' },
};

export const labels: Record<string, { title: string; detail: string }> = {
  todo: { title: '待办', detail: '任务与到期提醒' },
  clipline: { title: '剪贴绳', detail: '把手边的东西挂起来' },
  snippets: { title: '片段', detail: '复用指令与上下文' },
  vocabulary: { title: '词汇', detail: '探索新词，收藏并间隔复习' },
  trends: { title: '开源趋势', detail: '仓库、模型与开发文章' },
  morning: { title: '晨间简报', detail: '掌握今天的安排' },
  attention: { title: '协作提醒', detail: 'Agent 等待你处理的事' },
  wellness: { title: '休息提醒', detail: '喝水、起身与走动' },
};

export const titleOf = (plugin: Plugin) => labels[plugin.id]?.title || plugin.name || plugin.id;
export const detailOf = (plugin: Plugin) => labels[plugin.id]?.detail || plugin.description || '';
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const dateTime = () => new Intl.DateTimeFormat(currentLocale(), {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
export function formatTime(value?: string | number | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateTime().format(date);
}

export function localMinute(value?: string | number | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
