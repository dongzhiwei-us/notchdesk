import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {resolveLocale,supportedLocales} from '../shared/locales'
import Ajv, { type ValidateFunction } from 'ajv'
import { watch } from 'chokidar'
import { object, ServiceError, string, type Notice, type Storage } from './storage'

export type Parameters = Record<string, unknown>
export type Actor = { kind: string; operationId: string }
export type Handler = (params: Parameters, context: { origin: string; operationId: string; actor: Actor }) => unknown
type Callback = (...args: any[]) => unknown
export type Tool = { name: string; description: string; inputSchema: Parameters; handler: Handler; validate?: ValidateFunction; internal?: boolean; pluginId?:string; activate?:boolean }
type Setting = {
  type: 'number' | 'boolean' | 'string' | 'select' | 'time'
  label: string
  default: unknown
  options?: string[]
  min?: number
  max?: number
  [field: string]: unknown
}
export type Tick = { now: number; activeSeconds: number; elapsedSeconds: number; idleSeconds: number; locked: boolean }
type Manifest = { id: string; name: string; icon: string; version: string; entry: string; ui?: string; settings: Record<string, Setting>; defaultEnabled?: boolean; locales?:Record<string,string>; presentation?:{wheel:boolean} }
type Runtime = {
  live: boolean
  actions: Map<string, Tool>
  tick: Set<Callback>
  busyTicks: Set<Callback>
  hooks: Map<string, Set<Callback>>
  subscriptions: Map<string, Set<Callback>>
  cleanup?: Callback
}
type Plugin = { dir: string; manifest: Manifest; activate: Callback; revision:string; source?: string; translations?:Record<string,Record<string,string>>; runtime?: Runtime }
type Services = {
  storage: Storage
  notify(pluginId: string, input: Parameters): Notice
  native(method: string, params: Parameters): Promise<unknown>
  invoke(method: string, params: Parameters, origin: string): Promise<unknown>
  changed(): void
  isCoreTool(name: string): boolean
}

const localRequire = createRequire(__filename)
const schemaValidator = new Ajv({ strict: false, ownProperties: true })
const identifier = /^[a-z][a-z0-9_.-]{0,79}$/
const reserved = new Set(['__proto__', 'constructor', 'prototype'])
const internalActions = new Set(['clip_resolve', 'clip_open_file'])

function inside(root: string, file: string) {
  const name = relative(root, file)
  return name !== '' && name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name)
}

function pluginFile(dir: string, name: unknown, extension: RegExp) {
  const file = realpathSync(resolve(dir, string(name, '插件文件路径')))
  if (!inside(realpathSync(dir), file) || !extension.test(file)) throw new ServiceError('无效的插件文件。')
  return file
}

function checkSetting(field: Setting, value: unknown) {
  switch (field.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        && value >= (field.min ?? -Infinity) && value <= (field.max ?? Infinity)
    case 'boolean': return typeof value === 'boolean'
    case 'string': return typeof value === 'string' && value.length <= 100_000
    case 'time': return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    case 'select': return typeof value === 'string' && field.options?.includes(value)
    default: return false
  }
}

function loadManifest(dir: string): Manifest {
  const raw = object(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')))
  const id = string(raw.id, '插件 ID')
  if (!identifier.test(id) || reserved.has(id)) throw new ServiceError('无效的插件 ID。')
  const settings: Record<string, Setting> = Object.create(null)
  const presentation=raw.presentation===undefined?undefined:object(raw.presentation)
  if(presentation&&typeof presentation.wheel!=='boolean')throw new ServiceError('presentation.wheel 必须是布尔值。')
  for (const [key, definition] of Object.entries(object(raw.settings ?? {}))) {
    if (reserved.has(key) || key.length > 80) throw new ServiceError('无效的设置键。')
    const field = object(definition) as Setting
    string(field.label, '设置名称')
    if (!checkSetting(field, field.default)) throw new ServiceError('无效的设置默认值。')
    settings[key] = field
  }
  return {
    id, name: string(raw.name, '插件名称'), icon: string(raw.icon ?? 'sparkles', '插件图标'),
    version: string(raw.version ?? '0.1.0', '插件版本'), entry: string(raw.entry ?? 'index.cjs', '插件入口'),
    ...(raw.ui ? { ui: string(raw.ui, '插件面板') } : {}),
    ...(typeof raw.defaultEnabled === 'boolean' ? { defaultEnabled: raw.defaultEnabled } : {}),
    settings,
    ...(presentation?{presentation:{wheel:presentation.wheel as boolean}}:{}),
    ...(raw.locales ? {locales:Object.fromEntries(Object.entries(object(raw.locales)).map(([locale,file])=>{if(!supportedLocales.includes(locale as any))throw new ServiceError("Unsupported plugin locale");return [locale,string(file,"Locale resource")]}))} : {})
  }
}

export class Plugins {
  private readonly plugins = new Map<string, Plugin>()
  private readonly reloadTimers = new Map<string, NodeJS.Timeout>()
  private watcher?: ReturnType<typeof watch>
  private jobs: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(private readonly directory: string, private readonly assets: string, private readonly services: Services) {}

  async start() {
    mkdirSync(this.directory, { recursive: true })
    this.watcher = watch(this.directory, {
      ignoreInitial: true, followSymlinks: false,
      ignored: (file) => file.split(/[\\/]/).includes('node_modules'),
      awaitWriteFinish: { stabilityThreshold: 125, pollInterval: 35 }
    })
    this.watcher.on('all', (_event, file) => {
      if (this.closed || !inside(this.directory, file)) return
      const dir = join(this.directory, relative(this.directory, file).split(sep)[0])
      clearTimeout(this.reloadTimers.get(dir))
      this.reloadTimers.set(dir, setTimeout(() => {
        this.reloadTimers.delete(dir)
        void this.enqueue(() => this.reload(dir))
      }, 120))
    }).on('error', () => this.services.storage.log('plugin.watch_error'))
    for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await this.reload(join(this.directory, entry.name))
    }
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.jobs.then(run)
    this.jobs = next.catch(() => undefined)
    return next
  }

  private async reload(dir: string) {
    const previous = [...this.plugins.values()].find((plugin) => plugin.dir === dir)
    if (!existsSync(join(dir, 'manifest.json'))) {
      if (previous) {
        this.plugins.delete(previous.manifest.id)
        await this.dispose(previous.runtime)
        this.services.changed()
      }
      return
    }
    try {
      const manifest = loadManifest(dir)
      const conflict = this.plugins.get(manifest.id)
      if (conflict && conflict !== previous) throw new ServiceError('插件 ID 重复。')
      const entry = pluginFile(dir, manifest.entry, /\.(?:cjs|js)$/i)
      const source = manifest.ui ? readFileSync(pluginFile(dir, manifest.ui, /\.(?:mjs|js)$/i), 'utf8') : undefined
      for (const file of Object.keys(localRequire.cache)) {
        if (inside(dir, file) && !relative(dir, file).split(sep).includes('node_modules')) delete localRequire.cache[file]
      }
      const translations:Record<string,Record<string,string>>={}
      for(const [locale,file] of Object.entries(manifest.locales||{})) {
        const raw=readFileSync(pluginFile(dir,file,/\.json$/i),'utf8')
        if(Buffer.byteLength(raw)>512*1024)throw new ServiceError('Locale resource is too large')
        const values=object(JSON.parse(raw))
        if(Object.values(values).some(value=>typeof value!=='string'))throw new ServiceError('Locale values must be strings')
        translations[locale]=values as Record<string,string>
      }
      const module = localRequire(entry)
      if (typeof module.activate !== 'function') throw new ServiceError('插件需要导出 activate。')
      const plugin: Plugin = { dir, manifest, activate: module.activate, revision:randomUUID(), source, translations }
      if (this.enabled(plugin)) plugin.runtime = await this.activate(plugin, previous)
      if (previous) this.plugins.delete(previous.manifest.id)
      this.plugins.set(manifest.id, plugin)
      await this.dispose(previous?.runtime)
      this.services.storage.log('plugin.loaded', { pluginId: manifest.id })
      this.services.changed()
    } catch {
      this.services.storage.log('plugin.load_failed', { pluginId: previous?.manifest.id ?? 'unknown' })
    }
  }

  private enabled(plugin: Plugin) {
    return this.services.storage.get('core', `enabled:${plugin.manifest.id}`, plugin.manifest.defaultEnabled ?? true) === true
  }

  private configuration(plugin: Plugin) {
    const saved = object(this.services.storage.get('settings', plugin.manifest.id, {}))
    return Object.fromEntries(Object.entries(plugin.manifest.settings).map(([key, field]) => [
      key, checkSetting(field, saved[key]) ? saved[key] : field.default
    ]))
  }

  private async activate(plugin: Plugin, previous?: Plugin) {
    const id = plugin.manifest.id
    const runtime: Runtime = { live: false, actions: new Map(), tick: new Set(), busyTicks: new Set(), hooks: new Map(), subscriptions: new Map() }
    const namespace = `plugin:${id}`
    const assetDir = join(this.assets, id)
    mkdirSync(assetDir, { recursive: true, mode: 0o700 })
    let staging = true
    const writes = new Map<string, unknown>()
    const sharedWrites = new Map<string, unknown>()
    const notices: Parameters[] = []
    const available = () => {
      if (!staging && !runtime.live) throw new ServiceError('插件已停用。', 'PLUGIN_DISABLED')
    }
    const active = () => {
      if (!runtime.live) throw new ServiceError('插件尚未启用。', 'PLUGIN_DISABLED')
    }
    const register = (registry: Map<string, Set<Callback>>, key: string, callback: Callback) => {
      available()
      if (typeof callback !== 'function') throw new ServiceError('需要有效的插件回调。')
      const listeners = registry.get(key) ?? new Set()
      listeners.add(callback)
      registry.set(key, listeners)
      return () => listeners.delete(callback)
    }
    try {
      const cleanup = await plugin.activate({
        action: (name: string, description: string, inputSchema: Parameters, handler: Handler, options?: { internal?: boolean; activate?:boolean }) => {
          if (!staging) throw new ServiceError('动作只能在 activate 中注册。')
          const alreadyOwned = [...this.plugins.values()].some((other) => other !== previous && other.runtime?.actions.has(name))
          if (!identifier.test(name) || reserved.has(name) || runtime.actions.has(name)
            || this.services.isCoreTool(name) || alreadyOwned || typeof handler !== 'function') {
            throw new ServiceError('插件动作无效或重名。')
          }
          const schema = object(inputSchema)
          runtime.actions.set(name, {
            name, description: string(description, '动作说明', 1500), inputSchema: schema, handler, pluginId:id, activate:options?.activate===true,
            validate: schemaValidator.compile(schema),
            internal: !!options?.internal || internalActions.has(name)
          })
        },
        store: {
          get: (key: string, fallback?: unknown) => {
            available()
            return staging && writes.has(key) ? structuredClone(writes.get(key)) : this.services.storage.get(namespace, string(key, '存储键'), fallback)
          },
          set: (key: string, value: unknown) => {
            available()
            string(key, '存储键')
            if (staging) writes.set(key, structuredClone(value))
            else {
              this.services.storage.set(namespace, key, value)
              this.services.changed()
            }
          }
        },
        config: () => this.configuration(plugin),
        notify: (input: Parameters) => {
          available()
          if (staging) {
            notices.push(structuredClone(input))
            return null
          }
          return this.services.notify(id, input)
        },
        onTick: (callback: Callback) => {
          available()
          if (typeof callback !== 'function') throw new ServiceError('需要有效的插件回调。')
          runtime.tick.add(callback)
          return () => runtime.tick.delete(callback)
        },
        native: (method: string, params: Parameters = {}) => {
          active()
          return this.services.native(method, params)
        },
        invoke: (method: string, params: Parameters = {}) => {
          active()
          return this.services.invoke(method, params, id)
        },
        ui: {
          activate: (options: Parameters = {}) => {
            active()
            return this.services.invoke('ui.activate',{...object(options),pluginId:id},id)
          }
        },
        shared: {
          get: (key: string, fallback?: unknown) => {
            available()
            return staging && sharedWrites.has(key) ? structuredClone(sharedWrites.get(key)) : this.services.storage.get('shared', string(key, '共享键'), fallback)
          },
          set: (key: string, value: unknown) => {
            available()
            string(key, '共享键')
            if (staging) sharedWrites.set(key, structuredClone(value))
            else this.setShared(key, value)
          },
          subscribe: (key: string, callback: Callback) => register(runtime.subscriptions, string(key, '共享键'), callback)
        },
        hook: (key: string, callback: Callback) => register(runtime.hooks, string(key, '钩子名称'), callback),
        locale: () => resolveLocale(String((this.services.storage.get('core','theme',{}) as any).locale||'system'),String(this.services.storage.get('core','systemLocale',Intl.DateTimeFormat().resolvedOptions().locale))),
        t: (key:string,values:Record<string,unknown>={}) => {
          const language=resolveLocale(String((this.services.storage.get('core','theme',{}) as any).locale||'system'),String(this.services.storage.get('core','systemLocale',Intl.DateTimeFormat().resolvedOptions().locale)))
          const message=plugin.translations?.[language]?.[key] ?? plugin.translations?.['zh-CN']?.[key] ?? key
          return message.replace(/\{\{(\w+)\}\}/g,(_match,name)=>String(values[name]??''))
        },
        assetDir,
        log: (level: unknown, event: unknown, fields: unknown) => this.services.storage.log({level, source: 'plugin:' + id, event, fields})
      })
      if (typeof cleanup === 'function') runtime.cleanup = () => cleanup()
      this.services.storage.transaction(() => {
        for (const [key, value] of writes) this.services.storage.set(namespace, key, value)
        for (const [key, value] of sharedWrites) this.services.storage.set('shared', key, value)
      })
      staging = false
      runtime.live = true
      for (const input of notices) {
        try { this.services.notify(id, input) } catch { this.services.storage.log('plugin.notice_error', { pluginId: id }) }
      }
      return runtime
    } catch (error) {
      staging = false
      await this.dispose(runtime)
      throw error
    }
  }

  private async dispose(runtime?: Runtime) {
    if (!runtime) return
    runtime.live = false
    try { await runtime.cleanup?.() } catch { this.services.storage.log('plugin.cleanup_error') }
  }

  private setShared(key: string, value: unknown) {
    const previous = this.services.storage.get('shared', key)
    this.services.storage.set('shared', key, value)
    this.services.changed()
    for (const plugin of this.plugins.values()) {
      for (const callback of plugin.runtime?.subscriptions.get(key) ?? []) {
        void Promise.resolve().then(() => plugin.runtime?.live && callback(structuredClone(value), structuredClone(previous)))
          .catch(() => this.services.storage.log('plugin.subscription_error', { pluginId: plugin.manifest.id }))
      }
    }
  }

  tick(event: Tick) {
    for (const plugin of this.plugins.values()) {
      const runtime = plugin.runtime
      if (!runtime?.live) continue
      for (const callback of runtime.tick) {
        if (runtime.busyTicks.has(callback)) continue
        runtime.busyTicks.add(callback)
        void Promise.resolve().then(() => runtime.live && callback(event))
          .catch(() => this.services.storage.log('plugin.tick_error', { pluginId: plugin.manifest.id }))
          .finally(() => runtime.busyTicks.delete(callback))
      }
    }
  }

  async hooks(key: string, event: Parameters, allowBlock: boolean): Promise<{ allowed: boolean; reason?: string }> {
    for (const plugin of this.plugins.values()) {
      for (const callback of plugin.runtime?.hooks.get(key) ?? []) {
        try {
          const result = await callback(event)
          const disposition = result && typeof result === 'object' ? result as { allowed?: boolean; reason?: unknown } : undefined
          if (allowBlock && (result === false || disposition?.allowed === false)) {
            return { allowed: false, reason: typeof disposition?.reason === 'string' ? disposition.reason : '插件暂时阻止此操作。' }
          }
        } catch {
          this.services.storage.log('plugin.hook_error', { pluginId: plugin.manifest.id })
        }
      }
    }
    return { allowed: true }
  }

  tool(name: string) {
    for (const plugin of this.plugins.values()) {
      const tool = plugin.runtime?.actions.get(name)
      if (tool) return tool
    }
  }

  tools() {
    return Array.from(this.plugins.values()).flatMap((plugin) => Array.from(plugin.runtime?.actions.values() ?? []))
  }

  state() {
    const list = [...this.plugins.values()].map((plugin) => ({ ...plugin.manifest, presentation:{wheel:this.services.storage.get('core',`wheel:${plugin.manifest.id}`,plugin.manifest.presentation?.wheel??true)}, translations:plugin.translations, revision:plugin.revision, enabled: !!plugin.runtime?.live }))
    const settings = Object.fromEntries([...this.plugins.values()].map((plugin) => [
      plugin.manifest.id, { values: this.configuration(plugin) }
    ]))
    return { plugins: list, settings }
  }

  patch(id: string, values: Parameters) {
    const plugin = this.find(id)
    const current = this.configuration(plugin)
    for (const [key, value] of Object.entries(values)) {
      const field = plugin.manifest.settings[key]
      if (!field || !checkSetting(field, value)) throw new ServiceError('无效的插件设置。')
      current[key] = value
    }
    this.services.storage.set('settings', id, current)
    this.services.changed()
    return { values: current }
  }

  setEnabled(id: string, enabled: boolean) {
    return this.enqueue(async () => {
      const plugin = this.find(id)
      if (enabled !== !!plugin.runtime?.live) {
        if (enabled) plugin.runtime = await this.activate(plugin, plugin)
        this.services.storage.set('core', `enabled:${id}`, enabled)
        if (!enabled) {
          const old = plugin.runtime
          plugin.runtime = undefined
          await this.dispose(old)
        }
        this.services.changed()
      }
      return { id, enabled }
    })
  }

  setPresentation(id:string,wheel:boolean){
    this.find(id)
    // Store the preference independently of activation and plugin configuration.
    if(typeof wheel!=='boolean')throw new ServiceError('轮盘显示需要布尔值。')
    const value=wheel
    this.services.storage.set('core',`wheel:${id}`,value)
    this.services.storage.log('plugin.presentation_changed',{pluginId:id,wheel:value})
    this.services.changed()
    return {id,presentation:{wheel:value}}
  }

  source(id: string, requested?: string) {
    const plugin = this.find(id)
    if (!plugin.runtime?.live || plugin.source === undefined) throw new ServiceError('插件面板不可用。', 'NOT_FOUND')
    if (requested !== undefined && requested !== plugin.manifest.ui) throw new ServiceError('找不到插件文件。', 'NOT_FOUND')
    return { source: plugin.source, mime: 'text/javascript' }
  }

  private find(id: string) {
    const plugin = this.plugins.get(id)
    if (!plugin) throw new ServiceError('找不到插件。', 'NOT_FOUND')
    return plugin
  }

  async close() {
    this.closed = true
    for (const timer of this.reloadTimers.values()) clearTimeout(timer)
    await this.watcher?.close()
    await this.jobs
    await Promise.all([...this.plugins.values()].map((plugin) => this.dispose(plugin.runtime)))
  }
}
