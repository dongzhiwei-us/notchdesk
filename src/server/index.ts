import {HttpMcp} from '../mcp/http'
import {DEFAULT_SERVICE_PORT} from '../shared/connection'
import { localeOptions } from '../shared/locales'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, watch as watchFiles, type FSWatcher } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { groupFor, permissions } from '../shared/access'
import { dataHome } from '../shared/connection'
import { Plugins, type Parameters, type Tool } from './plugins'
import { acquireServiceLock, object, ServiceError, Storage, string, type Notice, type Priority } from './storage'

type Access = 'host' | 'renderer' | 'mcp'
type Client = { id: string; access: Access; response: ServerResponse }
type Pending = { succeed(value: unknown): void; fail(error: Error): void; timeout: NodeJS.Timeout }
const defaults = { mode: 'system', palette: 'graphite', material: 'glass', wheelPlacement: 'edge', locale: 'system' }
const noticeDefaults = {
  doNotDisturb: false, quietEnabled: false, quietStart: '22:00',
  quietEnd: '08:00', allowUrgentInDnd: true, gentleWhileIdle: false
}
const priorities: Priority[] = ['activity', 'gentle', 'scheduled', 'urgent']
const nativeMethods = new Set([
  'clipboard.capture', 'clipboard.write', 'file.open', 'session.open',
  'ui.open', 'ui.snapshot', 'ui.clipline_pin', 'ui.clipline_hide', 'files.pick', 'session.adapters', 'session.register', 'accounts.fetch', 'accounts.list'
])
const hostOnly = new Set(['native.reply', 'plugins.ui', 'clip_resolve'])
const maximumBody = 64 * 1024 * 1024
const text = { type: 'string' }
const boolean = { type: 'boolean' }
const jsonObject = { type: 'object' }

function validToken(expected: string, supplied: string | null | undefined) {
  return typeof supplied === 'string' && supplied.length === expected.length
    && Buffer.byteLength(supplied) === expected.length
    && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  const json = JSON.stringify(payload)
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(json)
}

async function body(request: IncomingMessage) {
  const declared = Number(request.headers['content-length'] ?? 0)
  if (declared > maximumBody) throw new ServiceError('请求内容过大。', 'TOO_LARGE')
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > maximumBody) throw new ServiceError('请求内容过大。', 'TOO_LARGE')
    chunks.push(chunk)
  }
  try {
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch {
    throw new ServiceError('需要有效的 JSON 请求。')
  }
}

class Service {
  readonly token = randomBytes(32).toString('hex')
  readonly rendererToken = randomBytes(32).toString('hex')
  readonly mcpToken:string
  private readonly httpMcp:HttpMcp
  readonly server = createServer((req, res) => void this.request(req, res))
  private readonly clients = new Map<string, Client>()
  private readonly core = new Map<string, Tool>()
  private readonly pending = new Map<string, Pending>()
  private readonly acting = new Set<string>()
  private readonly plugins: Plugins
  private readonly execution = new AsyncLocalStorage<{ id: string; depth: number; origin: string }>()
  private grantsWatcher?: FSWatcher
  private pulse?: NodeJS.Timeout
  private stateEvent?: NodeJS.Timeout
  private host?: { id: string; at: number; idleSeconds: number; locked: boolean }
  private lastTick = Date.now()
  private lastPresented = 0

  constructor(private readonly storage: Storage, private readonly dataDir: string, pluginDirectory: string, assetDirectory: string) {
    const credential=join(dataDir,'mcp-token')
    try{this.mcpToken=readFileSync(credential,'utf8').trim()}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;this.mcpToken=randomBytes(32).toString('hex');writeFileSync(credential,this.mcpToken,{flag:'wx',mode:0o600,flush:true})}
    if(!/^[a-f0-9]{64}$/.test(this.mcpToken))throw Error('Invalid MCP credential file')
    this.plugins = new Plugins(pluginDirectory, assetDirectory, {
      storage,
      native: (method, params) => this.native(method, params),
      invoke: (method, params, origin) => this.invoke(method, params, origin),
      notify: (pluginId, input) => this.notify(pluginId, input),
      changed: () => this.changed(),
      isCoreTool: (name) => this.core.has(name)
    })
    this.declareTools()
    this.httpMcp=new HttpMcp({
      list:async()=>await this.invoke('tools.list',{},'mcp') as any[],
      invoke:(method,params)=>this.invoke(method,params,'mcp')
    },this.mcpToken)
  }

  async start(port: number) {
    await this.plugins.start()
    await new Promise<void>((ok, fail) => {
      this.server.once('error', fail)
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', fail)
        ok()
      })
    })
    this.grantsWatcher=watchFiles(this.dataDir,(_event,file)=>{if(String(file)==='mcp-grants.json')this.changed()})
    this.grantsWatcher.on('error',()=>this.storage.log('permissions.watch_error'))
    this.pulse = setInterval(() => this.tick(), 5000)
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Service address unavailable')
    return address.port
  }

  private async request(request: IncomingMessage, response: ServerResponse) {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if(url.pathname==='/mcp'){await this.httpMcp.handle(request,response);return}
      const bearer = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined
      const supplied = url.pathname === '/events' ? bearer ?? url.searchParams.get('token') : bearer
      const access = validToken(this.token, supplied) ? 'host'
        : validToken(this.rendererToken, supplied) ? 'renderer'
          : validToken(this.mcpToken, supplied) ? 'mcp' : undefined
      if (!access) {
        sendJson(response, 401, { error: { message: '未授权。', code: 'UNAUTHORIZED' } })
        return
      }
      if (request.method === 'GET' && url.pathname === '/events') {
        this.connect(response, access)
        return
      }
      if (request.method === 'GET' && url.pathname.startsWith('/plugins/') && access === 'host') {
        const [, , rawId, ...segments] = url.pathname.split('/')
        const file = this.plugins.source(decodeURIComponent(rawId), segments.map(decodeURIComponent).join('/'))
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
        response.end(file.source)
        return
      }
      if (request.method !== 'POST' || url.pathname !== '/rpc') {
        sendJson(response, 404, { error: { message: '找不到接口。', code: 'NOT_FOUND' } })
        return
      }
      const input = await body(request)
      const result = await this.invoke(string(input.method, '操作名称'), object(input.params ?? {}), access)
      sendJson(response, 200, { result: result ?? null })
    } catch (error) {
      const failure = error instanceof ServiceError ? error : new ServiceError('操作失败。', 'INTERNAL')
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, 200, { error: { message: failure.message, code: failure.code } })
      } else {
        response.end()
      }
    }
  }

  private connect(response: ServerResponse, access: Access) {
    const client = { id: randomUUID(), response, access }
    this.clients.set(client.id, client)
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
    })
    response.on('close', () => {
      this.clients.delete(client.id)
      if (this.host?.id === client.id) this.offline()
    })
    this.event(client, 'connected', { id: client.id })
  }

  private event(client: Client, type: string, payload: unknown) {
    if (client.response.destroyed) return
    if (client.response.writableLength > 4 * 1024 * 1024) {
      client.response.destroy()
      return
    }
    client.response.write(`data: ${JSON.stringify({ type, payload })}\n\n`)
  }

  private broadcast(type: string, payload: unknown) {
    for (const client of this.clients.values()) {
      if (client.access !== 'mcp' || type === 'changed' || (type === 'notification' && permissions(this.dataDir).includes('workspace'))) {
        this.event(client, type, payload)
      }
    }
  }

  private changed() {
    if (!this.stateEvent) {
      this.stateEvent = setTimeout(() => {
        this.stateEvent = undefined
        this.broadcast('changed', {})
        void this.httpMcp.changed().catch(()=>{})
      }, 35)
    }
  }

  private native(method: string, params: Parameters) {
    if (!nativeMethods.has(method)) return Promise.reject(new ServiceError('宿主不支持此操作。', 'NOT_FOUND'))
    const client = this.host && this.clients.get(this.host.id)
    if (!client) return Promise.reject(new ServiceError('桌面窗口当前离线。', 'HOST_OFFLINE'))
    const id = randomUUID()
    return new Promise<unknown>((succeed, fail) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        fail(new ServiceError('桌面操作超时。', 'NATIVE_TIMEOUT'))
      }, method === 'files.pick' ? 120_000 : 15_000)
      this.pending.set(id, { succeed, fail, timeout })
      this.event(client, 'native', { id, method, params })
    })
  }

  private offline() {
    this.host = undefined
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.fail(new ServiceError('桌面窗口已断开。', 'HOST_OFFLINE'))
    }
    this.pending.clear()
    this.changed()
  }

  private tick() {
    const now = Date.now()
    const inactive = !this.host || this.host.locked || now - this.host.at > 25_000
    const idleSeconds = this.host?.idleSeconds ?? 0
    const elapsedSeconds = inactive ? 0 : Math.min(5, Math.max(0, (now - this.lastTick) / 1000))
    const activeSeconds = idleSeconds < 60 ? elapsedSeconds : 0
    this.lastTick = now
    for (const client of this.clients.values()) {
      if (client.response.writableLength < 4096) client.response.write(': tick\n\n')
    }
    this.plugins.tick({ now, activeSeconds, elapsedSeconds, idleSeconds, locked: inactive })
    this.flushNotices()
  }

  private requireNotice(id: unknown) {
    const notice = this.storage.readNotice(string(id, '通知 ID'))
    if (!notice) throw new ServiceError('找不到通知。', 'NOT_FOUND')
    return notice
  }

  private decision(notice: Pick<Notice, 'priority'>, now: number) {
    const { priority } = notice
    if (priority === 'activity') return 'activity_only'
    if (!this.host || !this.clients.has(this.host.id)) return 'host_offline'
    if (this.host.locked || now - this.host.at > 25_000) return 'host_locked'
    const rules = this.noticeSettings()
    const time = new Date(now)
    const minute = time.getHours() * 60 + time.getMinutes()
    const start = this.minuteOfDay(rules.quietStart)
    const end = this.minuteOfDay(rules.quietEnd)
    const inQuietHours = rules.quietEnabled && (start < end ? minute >= start && minute < end : minute >= start || minute < end)
    if ((rules.doNotDisturb || inQuietHours) && !(priority === 'urgent' && rules.allowUrgentInDnd)) {
      return rules.doNotDisturb ? 'do_not_disturb' : 'quiet_hours'
    }
    if (priority === 'gentle' && this.host.idleSeconds >= 60 && !rules.gentleWhileIdle) return 'user_idle'
    const cooldown = priority === 'urgent' ? 3000 : priority === 'scheduled' ? 20_000 : 60_000
    if (now - this.lastPresented < cooldown) return 'rate_limited'
    return 'presented'
  }

  private minuteOfDay(time: string) {
    const [hour, minute] = time.split(':').map(Number)
    return hour * 60 + minute
  }

  private noticeSettings() {
    return { ...noticeDefaults, ...object(this.storage.get('core', 'notificationSettings', {})) }
  }

  private changeNoticeSettings(params: Parameters) {
    const current = this.noticeSettings()
    for (const [key, value] of Object.entries(params)) {
      const rule = noticeDefaults[key as keyof typeof noticeDefaults]
      const valid = typeof rule === 'boolean' ? typeof value === 'boolean'
        : typeof rule === 'string' && typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
      if (!Object.hasOwn(noticeDefaults, key) || !valid) throw new ServiceError('无效的通知设置。')
    }
    if (Object.keys(params).length) {
      const next = { ...current, ...params }
      this.storage.set('core', 'notificationSettings', next)
      this.changed()
      this.flushNotices()
      return next
    }
    return current
  }

  private notify(pluginId: string, input: Parameters) {
    const key = string(input.key, '通知键', 400)
    const existing = this.storage.noticeKey(pluginId, key)
    if (existing) {
      this.storage.recordNotice(existing.id, 'deduplicated', { operationId: this.execution.getStore()?.id ?? '' })
      return existing
    }
    const priority = input.priority as Priority
    if (!priorities.includes(priority)) throw new ServiceError('无效的通知优先级。')
    if (input.actions !== undefined && (!Array.isArray(input.actions) || input.actions.length > 8)) {
      throw new ServiceError('无效的通知操作。')
    }
    const actions = (input.actions as unknown[] ?? []).map((item) => {
      const action = object(item)
      const method = string(action.method, '操作名称')
      const source = this.execution.getStore()?.origin
      if (this.core.get(method)?.internal || (source === 'mcp' && !this.mcpAllowed(method))) {
        throw new ServiceError('无法把此操作附在通知上。', 'FORBIDDEN')
      }
      return { label: string(action.label, '操作标签', 60), method, params: object(action.params ?? {}) }
    })
    const now = Date.now()
    const decision = this.decision({ priority }, now)
    const notice: Notice = {
      id: randomUUID(), pluginId, key, title: string(input.title, '通知标题', 500),
      body: typeof input.body === 'string' ? input.body.slice(0, 3000) : '',
      priority, origin: input.origin ?? null, actions, createdAt: now,
      presentedAt: decision === 'presented' ? now : null, readAt: null, dismissedAt: null, unread: true, decision
    }
    this.storage.insertNotice(notice, { decision, operationId: this.execution.getStore()?.id ?? '' })
    this.storage.log('notification.created', { pluginId, id: notice.id, priority, decision })
    if (notice.presentedAt) {
      this.lastPresented = now
      this.broadcast('notification', notice)
    }
    this.changed()
    return notice
  }

  private flushNotices() {
    const now = Date.now()
    const candidates = this.storage.notices(250).filter((notice) => notice.unread && !notice.presentedAt && notice.priority !== 'activity')
      .sort((left, right) => priorities.indexOf(right.priority) - priorities.indexOf(left.priority) || left.createdAt - right.createdAt)
    const notice = candidates.find((item) => this.decision(item, now) === 'presented')
    if (notice) {
      const present = { ...notice, decision: 'presented', presentedAt: now }
      this.storage.updateNotice(present, 'presented')
      this.lastPresented = now
      this.broadcast('notification', present)
      this.changed()
    }
  }

  private readNotice(id: unknown, dismiss: boolean) {
    const notice = this.requireNotice(id)
    if ((!dismiss && !notice.unread) || (dismiss && notice.dismissedAt !== null)) return notice
    const now = Date.now()
    notice.readAt ??= now
    notice.unread = false
    if (dismiss) notice.dismissedAt = now
    this.storage.updateNotice(notice, dismiss ? 'dismissed' : 'read', { operationId: this.execution.getStore()?.id ?? '' })
    this.changed()
    return notice
  }

  private async takeAction(params: Parameters) {
    const notice = this.requireNotice(params.id)
    if (typeof params.index !== 'number' || !Number.isInteger(params.index) || !notice.actions[params.index]) {
      throw new ServiceError('找不到通知操作。', 'NOT_FOUND')
    }
    if (notice.dismissedAt || this.acting.has(notice.id)) throw new ServiceError('通知已经处理。', 'ALREADY_HANDLED')
    this.acting.add(notice.id)
    const action = notice.actions[params.index]
    try {
      const result = await this.invoke(action.method, action.params, this.execution.getStore()?.origin === 'mcp' ? 'mcp' : 'notification')
      this.readNotice(notice.id, true)
      this.storage.recordNotice(notice.id, 'action_succeeded', { method: action.method, operationId: this.execution.getStore()?.id ?? '' })
      return { ok: true, result }
    } catch (error) {
      this.storage.recordNotice(notice.id, 'action_failed', { method: action.method, operationId: this.execution.getStore()?.id ?? '' })
      throw error
    } finally {
      this.acting.delete(notice.id)
    }
  }

  private declareTools() {
    const tool = (name: string, description: string, properties: Parameters, required: string[], handler: Tool['handler'], internal = false) => {
      this.core.set(name, { name, description, inputSchema: { type: 'object', properties, required }, handler, internal })
    }
    tool('state.get', '读取插件、外观与通知状态。', {}, [], (_params, context) => ({
      ...this.plugins.state(),
      ...(context.origin === 'mcp' && !permissions(this.dataDir).includes('administration') ? { settings: {} } : {}),
      theme: { ...defaults, ...object(this.storage.get('core', 'theme', defaults)) },
      notificationSettings: this.noticeSettings(),
      notifications: this.storage.notices(),
      host: { online: !!this.host, idleSeconds: this.host?.idleSeconds ?? 0, locked: this.host?.locked ?? false }
    }))
    tool('settings.patch', '更新指定插件的部分设置。', { pluginId: text, values: jsonObject }, ['pluginId', 'values'],
      (params) => this.plugins.patch(string(params.pluginId, '插件 ID'), object(params.values)))
    tool('locale.list','List supported interface language preferences.',{},[],()=>localeOptions)
    tool('locale.set','Set the interface language for all desktop windows and plugins.',{locale:{enum:localeOptions.map(item=>item.value)}},['locale'],(params)=>this.invoke('theme.set',params,'locale'))
    tool('theme.set', '更新圆盘的停靠位置、明暗、配色与材质。', {
      mode: { enum: ['system', 'dark', 'light'] },
      palette: { enum: ['graphite', 'tide', 'amber'] },
      material: { enum: ['glass', 'solid'] },
      position:{type:'object',properties:{x:{type:'number'},y:{type:'number'}},required:['x','y'],additionalProperties:false},
      wheelPlacement: { enum: ['edge', 'floating'] }, locale: { enum: localeOptions.map(item=>item.value) }
    }, [], (params) => {
      const theme: Record<string, unknown> = { ...defaults, ...object(this.storage.get('core', 'theme', defaults)) }
      for (const [key, value] of Object.entries(params)) {
        if(key==='position'){const position=object(value);if(!Number.isFinite(position.x)||!Number.isFinite(position.y))throw new ServiceError('Invalid position');theme.position={x:position.x,y:position.y};continue}
        const allowed: Record<string, string[]> = { mode: ['system', 'dark', 'light'], palette: ['graphite', 'tide', 'amber'], material: ['glass', 'solid'], wheelPlacement: ['edge', 'floating'], locale: localeOptions.map(item=>item.value) }
        if (!Object.hasOwn(allowed, key) || typeof value !== 'string' || !allowed[key].includes(value)) {
          throw new ServiceError('无效的外观设置。')
        }
        theme[key] = value
      }
      this.storage.set('core', 'theme', theme)
      this.broadcast('theme.changed', theme)
      this.broadcast('locale.changed',{preference:theme.locale})
      void this.plugins.hooks('locale.changed',{preference:theme.locale},false)
      this.changed()
      return theme
    })
    tool('plugins.enable', '启用或停用已安装的插件。', { id: text, enabled: boolean }, ['id', 'enabled'], (params) => {
      if (typeof params.enabled !== 'boolean') throw new ServiceError('需要布尔值。')
      return this.plugins.setEnabled(string(params.id, '插件 ID'), params.enabled)
    })
    tool('plugins.ui', '读取本地可信插件的面板源码。', { id: text }, ['id'], (params) => this.plugins.source(string(params.id, '插件 ID')), true)
    tool('plugins.presentation','设置插件是否显示在轮盘；隐藏入口仍保留后台运行、通知和 MCP 能力。',{
      id:text,wheel:boolean
    },['id','wheel'],params=>this.plugins.setPresentation(string(params.id,'插件 ID'),params.wheel as boolean))
    tool('tools.list', '列出当前可用的 MCP 操作。', {}, [], (_params, context) =>
      [...this.core.values(), ...this.plugins.tools()].filter((entry) => !entry.internal && (context.origin !== 'mcp' || this.mcpAllowed(entry.name)))
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), true)
    tool('notifications.list', '查看悬屿通知及处理状态。', { limit: { type: 'integer', minimum: 1, maximum: 250 }, includeDismissed: boolean }, [], (params) => {
      const limit = params.limit ?? 100
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 250) throw new ServiceError('通知条数必须介于 1 和 250。')
      return this.storage.notices(limit, params.includeDismissed === true)
    })
    tool('notifications.create', '创建一条本地通知，相同 key 用于去重。', {
      key: text, title: text, body: text, priority: { enum: priorities }, origin: jsonObject, actions: { type: 'array' }
    }, ['key', 'title', 'priority'], (params) => this.notify('external', params))
    tool('notifications.read', '把通知标为已读。', { id: text }, ['id'], (params) => this.readNotice(params.id, false))
    tool('notifications.dismiss', '关闭一条通知。', { id: text }, ['id'], (params) => this.readNotice(params.id, true))
    tool('notifications.explain', '查看通知的展示原因和处理记录。', { id: text }, ['id'], (params) => {
      const notice = this.requireNotice(params.id)
      return { notice, history: this.storage.noticeHistory(notice.id) }
    })
    tool('notifications.action', '运行通知上的一个操作。', { id: text, index: { type: 'integer', minimum: 0 } }, ['id', 'index'],
      (params) => this.takeAction(params))
    tool('notifications.settings', '读取或更新免打扰、静默时段与温和提醒规则。', {
      doNotDisturb: boolean, quietEnabled: boolean, quietStart: text, quietEnd: text, allowUrgentInDnd: boolean, gentleWhileIdle: boolean
    }, [], (params, context) => {
      if (context.origin === 'mcp' && Object.keys(params).length && !permissions(this.dataDir).includes('administration')) {
        throw new ServiceError('缺少修改通知规则的权限。', 'FORBIDDEN')
      }
      return this.changeNoticeSettings(params)
    })
    tool('ui.open', '定位并打开悬屿视图。', { view: text }, [], (params) => this.native('ui.open', params))
    tool('ui.activate', '激活已启用插件，同时同步圆盘选中项和插件界面。', {
      pluginId:{type:'string',maxLength:80},itemId:{type:'string',maxLength:128},reason:{type:'string',maxLength:200},transient:boolean
    }, ['pluginId'], async(params,context)=>{
      const pluginId=string(params.pluginId,'插件 ID',80)
      if(!this.plugins.state().plugins.some(plugin=>plugin.id===pluginId&&plugin.enabled))throw new ServiceError('插件不可用。','PLUGIN_DISABLED')
      if(!this.host||!this.clients.has(this.host.id))return {dispatched:false,reason:'HOST_OFFLINE'}
      return this.native('ui.open',{view:pluginId,pluginId,itemId:params.itemId,transient:params.transient===true,reason:params.reason||'plugin-response',activationId:context.operationId})
    })
    tool('ui.snapshot', '读取悬屿窗口的当前界面状态。', {}, [], (params) => this.native('ui.snapshot', params))
    tool('accounts.list', '列出本机已连接账号的状态。', {}, [], (params) => this.native('accounts.list', params))
    tool('session.adapters', '列出可用的会话打开适配器。', {}, [], (params) => this.native('session.adapters', params))
    tool('session.register', '登记 Vanish 会话深链模板。', { provider: { enum: ['vanish'] }, template: text }, ['provider', 'template'],
      (params, context) => {
        if (context.origin === 'mcp' && !permissions(this.dataDir).includes('administration')) {
          throw new ServiceError('缺少注册会话适配器的权限。', 'FORBIDDEN')
        }
        return this.native('session.register', params)
      })
    tool('files.pick', '打开系统文件选择器。', {}, [], (params) => this.native('files.pick', params), true)
    tool('ui.settled', '视图过渡动画完成后的生命周期事件。', {view: text, pluginId: text}, ['view'], () => ({settled:true}), true)
    tool('ui.transition', '执行视图切换钩子。', { from: text, to: text, reason: text }, [], () => ({ allowed: true }), true)
    tool('host.online', '注册桌面宿主。', {}, [], (params) => {
      const id = string(params.connectionId, '桌面连接 ID')
      if (this.clients.get(id)?.access !== 'host') throw new ServiceError('桌面事件连接已断开。', 'HOST_OFFLINE')
      if (this.host && this.host.id !== id) this.offline()
      const idleSeconds = typeof params.idleSeconds === 'number' && Number.isFinite(params.idleSeconds)
        ? Math.max(0, params.idleSeconds) : 0
      if(typeof params.systemLocale==='string')this.storage.set('core','systemLocale',params.systemLocale.slice(0,80))
      this.host = { id, at: Date.now(), idleSeconds, locked: params.locked === true }
      this.changed()
      this.flushNotices()
      return { ok: true }
    }, true)
    tool('host.activity', '同步桌面空闲与锁定状态。', {}, [], (params) => {
      if (!this.host || (params.connectionId !== undefined && this.host.id !== params.connectionId)) {
        throw new ServiceError('桌面事件连接已断开。', 'HOST_OFFLINE')
      }
      if (typeof params.idleSeconds !== 'number' || !Number.isFinite(params.idleSeconds) || params.idleSeconds < 0) {
        throw new ServiceError('无效的空闲时间。')
      }
      const before = this.host.locked
      this.host.at = Date.now()
      this.host.idleSeconds = params.idleSeconds
      this.host.locked = params.locked === true
      if (before !== this.host.locked) this.changed()
      return { ok: true }
    }, true)
    tool('host.offline', '注销桌面宿主。', {}, [], (params) => {
      if (params.connectionId === undefined || params.connectionId === this.host?.id) this.offline()
      return { ok: true }
    }, true)
    tool('native.reply', '提交桌面操作结果。', {}, [], (params) => {
      const id = string(params.id, '操作 ID')
      const pending = this.pending.get(id)
      if (!pending) return { ok: false }
      this.pending.delete(id)
      clearTimeout(pending.timeout)
      if (params.error) {
        const info = typeof params.error === 'object' ? object(params.error).message : params.error
        pending.fail(new ServiceError(typeof info === 'string' ? info.slice(0, 300) : '桌面操作失败。', 'NATIVE_ERROR'))
      } else {
        pending.succeed(params.result ?? null)
      }
      return { ok: true }
    }, true)
  }

  private mcpAllowed(method: string) {
    const entry = this.core.get(method) ?? this.plugins.tool(method)
    return !!entry && !entry.internal && permissions(this.dataDir).includes(groupFor(method))
  }

  private invoke(method: string, params: Parameters, origin: string): Promise<unknown> {
    const core = this.core.get(method)
    const entry = core ?? this.plugins.tool(method)
    if (!entry) {
      return Promise.reject(new ServiceError('找不到此操作。', 'NOT_FOUND'))
    }
    if ((origin !== 'host' && (method.startsWith('host.') || hostOnly.has(method))) ||
        (origin === 'mcp' && method !== 'tools.list' && !this.mcpAllowed(method))) {
      return Promise.reject(new ServiceError('当前调用没有此操作的权限。', 'FORBIDDEN'))
    }
    if (entry.validate && !entry.validate(params)) {
      const validation = entry.validate.errors?.[0]
      return Promise.reject(new ServiceError(`参数无效${validation?.instancePath ? ' ' + validation.instancePath : ''}。`))
    }
    const parent = this.execution.getStore()
    const depth = parent ? parent.depth + 1 : 0
    if (depth > 10) return Promise.reject(new ServiceError('插件操作调用层级过深。', 'RECURSION'))
    const id = parent?.id ?? randomUUID()
    const operational = method.startsWith('host.') || method === 'native.reply'
    const context = { origin, operationId: id, actor: { kind: origin, operationId: id } }
    return this.execution.run({ id, depth, origin }, async () => {
      const start = Date.now()
      let result: unknown
      let code = 'OK'
      try {
        const guard: { allowed: boolean; reason?: string } = operational ? { allowed: true }
          : await this.plugins.hooks(`before:${method}`, { method, params, ...context }, true)
        if (!guard.allowed && method !== 'ui.transition') throw new ServiceError(guard.reason ?? '操作已拒绝。', 'BLOCKED')
        result = guard.allowed ? await entry.handler(params, context) : guard
        if (!operational) await this.plugins.hooks(`after:${method}`, { method, params, ...context, result }, false)
        if(entry.activate&&entry.pluginId&&(origin!=='mcp'||permissions(this.dataDir).includes('desktop'))){
          try{await this.invoke('ui.activate',{pluginId:entry.pluginId,reason:'action:'+method},entry.pluginId)}
          catch{this.storage.log('plugin.activation_failed',{pluginId:entry.pluginId,method})}
        }
        return result
      } catch (error) {
        const failure = error instanceof ServiceError ? error : new ServiceError(
          !core && error instanceof Error && error.message ? error.message.slice(0, 300) : '操作失败。',
          core ? 'INTERNAL' : 'PLUGIN_ERROR'
        )
        code = failure.code
        if (!operational) await this.plugins.hooks(`after:${method}`, { method, params, ...context, error: code }, false)
        throw failure
      } finally {
        if (!operational && !['state.get', 'tools.list'].includes(method)) {
          this.storage.log('rpc', { id, method, code, durationMs: Date.now() - start })
        }
      }
    })
  }

  async close() {
    this.grantsWatcher?.close()
    clearInterval(this.pulse)
    clearTimeout(this.stateEvent)
    this.offline()
    clearTimeout(this.stateEvent)
    for (const client of this.clients.values()) client.response.end()
    await this.httpMcp.close()
    this.server.closeAllConnections()
    await new Promise<void>((ok) => this.server.close(() => ok()))
    await this.plugins.close()
  }
}

async function run() {
  const directory = resolve(dataHome())
  const pluginDirectory = resolve(process.env.NOTCH_PLUGINS ?? join(process.cwd(), 'plugins'))
  const configuredPort = Number(process.env.NOTCH_PORT ?? DEFAULT_SERVICE_PORT)
  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) throw new Error('Invalid NOTCH_PORT')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const acquired = acquireServiceLock(directory)
  if (!acquired) return
  const lock = acquired
  const descriptor = join(directory, 'connection.json')
  rmSync(descriptor, { force: true })
  const temporary = join(directory, `.connection-${process.pid}.json`)
  const storage = new Storage(directory, process.env.NOTCH_LOGS ? resolve(process.env.NOTCH_LOGS) : directory)
  const service = new Service(storage, directory, pluginDirectory, join(directory, 'assets'))
  let stopping = false
  async function close() {
    if (stopping) return
    stopping = true
    try {
      const owner = JSON.parse(readFileSync(descriptor, 'utf8'))
      if (owner.token === service.token) rmSync(descriptor)
    } catch {
      // A service that failed initial startup may not have published a descriptor.
    }
    try { await service.close() } finally {
      storage.close()
      lock.close()
    }
  }
  process.once('SIGTERM', () => void close())
  process.once('SIGINT', () => void close())
  try {
    const port = await service.start(configuredPort)
    writeFileSync(temporary, JSON.stringify({ port, token: service.token, rendererToken: service.rendererToken, mcpToken: service.mcpToken }), { mode: 0o600, flush: true })
    renameSync(temporary, descriptor)
  } catch (error) {
    rmSync(temporary, { force: true })
    await close()
    throw error
  }
}

void run().catch((error) => {
  console.error('悬屿服务启动失败。', (error as NodeJS.ErrnoException)?.code ?? 'STARTUP')
  process.exitCode = 1
})
