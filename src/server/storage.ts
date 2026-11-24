import { randomUUID } from 'node:crypto'
import { mkdirSync, appendFileSync, readFileSync, renameSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class ServiceError extends Error {
  constructor(message: string, public readonly code = 'INVALID_REQUEST') {
    super(message)
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceError('需要一个参数对象。')
  }
  return value as Record<string, unknown>
}

export function string(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ServiceError(`${name}无效。`)
  }
  return value
}

export function json(value: unknown): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new ServiceError('需要 JSON 值。')
  return encoded
}

export type Priority = 'activity' | 'gentle' | 'scheduled' | 'urgent'
export type Action = { label: string; method: string; params: Record<string, unknown> }
export type Notice = {
  id: string
  pluginId: string
  key: string
  title: string
  body: string
  priority: Priority
  origin: unknown
  actions: Action[]
  createdAt: number
  presentedAt: number | null
  readAt: number | null
  dismissedAt: number | null
  unread: boolean
  decision: string
}

const levels = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = typeof levels[number]
type LogEntry = {
  at: string
  level: LogLevel
  source: string
  event: string
  correlationId: string
  fields: Record<string, string | number | boolean>
}
type Diagnostic = {
  level: unknown
  source: string
  event: unknown
  correlationId?: string
  fields?: unknown
}
const namePattern = /^[a-z][a-z0-9_.-]{0,79}$/
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const logLevels = new Set<unknown>(levels)
const codePattern = /^[A-Z][A-Z0-9_]{0,47}$/
const decisions = new Set(['activity_only', 'host_offline', 'host_locked', 'do_not_disturb', 'quiet_hours', 'user_idle', 'rate_limited', 'presented'])
const numericFields = new Set(['durationMs', 'elapsedMs', 'retryMs', 'statusCode', 'attempt', 'count'])
const booleanFields = new Set(['enabled', 'locked', 'ok', 'retryable','wheel'])
const metadataFields = new Set(['pluginId', 'method', 'origin'])
const maxLogBytes = 256 * 1024

function safeFields(input: unknown) {
  const fields: LogEntry['fields'] = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fields
  let redacted = 0
  for (const [key, value] of Object.entries(input)) {
    const valid = (numericFields.has(key) && typeof value === 'number' && Number.isFinite(value))
      || (booleanFields.has(key) && typeof value === 'boolean')
      || (metadataFields.has(key) && typeof value === 'string' && namePattern.test(value))
      || (key === 'code' && typeof value === 'string' && codePattern.test(value))
      || (key === 'noticeId' && typeof value === 'string' && uuidPattern.test(value))
      || (key === 'priority' && ['activity', 'gentle', 'scheduled', 'urgent'].includes(value))
      || (key === 'decision' && decisions.has(value))
    if (valid) fields[key] = value
    else redacted++
  }
  if (redacted) fields.redactedCount = redacted
  return fields
}

export function acquireServiceLock(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(join(dir, 'service-lock.sqlite'), { timeout: 0 })
  try {
    database.exec('BEGIN EXCLUSIVE')
    return database
  } catch (error) {
    database.close()
    if ((error as { errcode?: number }).errcode === 5) return null
    throw error
  }
}

export class Storage {
  private readonly database: DatabaseSync
  private readonly logFile: string

  constructor(directory: string, logs = directory) {
    mkdirSync(logs, { recursive: true, mode: 0o700 })
    this.logFile = join(logs, 'audit.jsonl')
    this.database = new DatabaseSync(join(directory, 'island.sqlite'), { timeout: 1500 })
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS kv (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (namespace, key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS notices (
        id TEXT PRIMARY KEY,
        plugin TEXT NOT NULL,
        key TEXT NOT NULL,
        data TEXT NOT NULL,
        created INTEGER NOT NULL,
        UNIQUE (plugin, key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS notices_created ON notices (created DESC);
      CREATE TABLE IF NOT EXISTS notice_history (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL,
        at INTEGER NOT NULL,
        event TEXT NOT NULL,
        detail TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS notice_history_id ON notice_history (id, seq DESC);
    `)
  }

  transaction<T>(run: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = run()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  get(namespace: string, key: string, fallback?: unknown) {
    const row = this.database.prepare('SELECT value FROM kv WHERE namespace = ? AND key = ?').get(namespace, key)
    return row ? JSON.parse(row.value as string) : fallback
  }

  set(namespace: string, key: string, value: unknown) {
    this.database.prepare(`
      INSERT INTO kv (namespace,key,value) VALUES (?,?,?)
      ON CONFLICT(namespace,key) DO UPDATE SET value = excluded.value
    `).run(namespace, key, json(value))
  }

  readNotice(id: string): Notice | undefined {
    const row = this.database.prepare('SELECT data FROM notices WHERE id = ?').get(id)
    return row ? JSON.parse(row.data as string) : undefined
  }

  noticeKey(pluginId: string, key: string): Notice | undefined {
    const row = this.database.prepare('SELECT data FROM notices WHERE plugin = ? AND key = ?').get(pluginId, key)
    return row ? JSON.parse(row.data as string) : undefined
  }

  notices(limit = 100, includeDismissed = false): Notice[] {
    const rows = this.database.prepare(`
      SELECT data FROM notices
      WHERE ? = 1 OR json_extract(data, '$.dismissedAt') IS NULL
      ORDER BY created DESC, rowid DESC LIMIT ?
    `).all(Number(includeDismissed), limit)
    return rows.map((row) => JSON.parse(row.data as string))
  }

  insertNotice(notice: Notice, detail: Record<string, unknown>) {
    this.transaction(() => {
      this.database.prepare('INSERT INTO notices (id,plugin,key,data,created) VALUES (?,?,?,?,?)')
        .run(notice.id, notice.pluginId, notice.key, json(notice), notice.createdAt)
      this.recordNotice(notice.id, 'created', detail)
    })
  }

  updateNotice(notice: Notice, event: string, detail: Record<string, unknown> = {}) {
    this.transaction(() => {
      this.database.prepare('UPDATE notices SET data = ? WHERE id = ?').run(json(notice), notice.id)
      this.recordNotice(notice.id, event, detail)
    })
  }

  recordNotice(id: string, event: string, detail: Record<string, unknown> = {}) {
    this.database.prepare('INSERT INTO notice_history (id,at,event,detail) VALUES (?,?,?,?)')
      .run(id, Date.now(), event, json(detail))
  }

  noticeHistory(id: string) {
    return this.database.prepare(`
      SELECT at,event,detail FROM notice_history WHERE id = ? ORDER BY seq DESC LIMIT 50
    `).all(id).map((row) => ({ at: row.at, event: row.event, detail: JSON.parse(row.detail as string) }))
  }

  log(input: Diagnostic | string, details?: Record<string, unknown>) {
    try {
      const diagnostic: Diagnostic = typeof input === 'string'
        ? {level: /error|failed/.test(input) ? 'error' : 'info', source: 'service', event: input, fields: details}
        : input
      const { level, source, event, correlationId, fields } = diagnostic
      const entry: LogEntry = {
        at: new Date().toISOString(),
        level: logLevels.has(level) ? level as LogLevel : 'info',
        source: /^(?:plugin:)?[a-z][a-z0-9_.-]{0,79}$/.test(source) ? source : 'service',
        event: typeof event === 'string' && namePattern.test(event) ? event : 'log.message',
        correlationId: correlationId && uuidPattern.test(correlationId) ? correlationId : randomUUID(),
        fields: safeFields(fields)
      }
      const line = `${json(entry)}\n`
      try {
        if (statSync(this.logFile).size + Buffer.byteLength(line) > maxLogBytes) {
          rmSync(`${this.logFile}.1`, { force: true })
          renameSync(this.logFile, `${this.logFile}.1`)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      appendFileSync(this.logFile, line, { mode: 0o600 })
    } catch {
      // A diagnostic write must not interfere with the operation it describes.
    }
  }

  logs(filter: { level?: string; source?: string; event?: string; correlationId?: string }, limit: number) {
    const entries: LogEntry[] = []
    for (const file of [this.logFile, `${this.logFile}.1`]) {
      let lines: string[]
      try {
        lines = readFileSync(file, 'utf8').trimEnd().split('\n').reverse()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      for (const line of lines) {
        try {
          const entry: LogEntry = JSON.parse(line)
          if (!entry?.fields || !Object.entries(filter).every(([key, value]) => entry[key as keyof LogEntry] === value)) continue
          entries.push(entry)
          if (entries.length === limit) return entries
        } catch {
          // Continue past a partially written record after an unclean shutdown.
        }
      }
    }
    return entries
  }

  close() {
    this.database.close()
  }
}
