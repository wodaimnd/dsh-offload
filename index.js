// @local/dsh-offload —— Host 半。
// 职责：一条 /api/ds-offload 环回路由（面板用），把 bridge 的健康、自检、提问、统计、设置摊开；
//       注册一个模型工具 ds_offload，让对话里可以直接把子问题丢给网页版。
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const ROUTE = '/api/ds-offload'
const NAME = '@local/dsh-offload'

const DEFAULTS = {
  bridge: 'http://127.0.0.1:8788',
  skillDir: 'C:/Users/Shinelon/.agents/skills/deepseek-web-offload',
  pingTimeoutMs: 20000,
  askTimeoutMs: 150000,
  tools: true,
  autoDelete: true,
  newChat: true,
  deep: 'auto',
  simpleChars: 500,
  deepChars: 1200,
  processChars: 800,
}

const SETTING_KEYS = ['autoDelete', 'newChat', 'deep', 'simpleChars', 'deepChars', 'processChars', 'bridge']

function message(error) {
  return String((error && error.message) || error || 'unknown error')
}

function normalizeConfig(raw) {
  const v = raw && typeof raw === 'object' ? raw : {}
  const bridge = String(v.bridge || DEFAULTS.bridge).replace(/\/+$/, '')
  return {
    bridge: bridge || DEFAULTS.bridge,
    skillDir: String(v.skillDir || DEFAULTS.skillDir),
    pingTimeoutMs: Number(v.pingTimeoutMs) > 0 ? Number(v.pingTimeoutMs) : DEFAULTS.pingTimeoutMs,
    askTimeoutMs: Number(v.askTimeoutMs) > 0 ? Number(v.askTimeoutMs) : DEFAULTS.askTimeoutMs,
    tools: v.tools !== false,
    autoDelete: v.autoDelete !== false,
    newChat: v.newChat !== false,
    deep: ['auto', 'on', 'off'].includes(v.deep) ? v.deep : 'auto',
    simpleChars: Number(v.simpleChars) > 0 ? Number(v.simpleChars) : DEFAULTS.simpleChars,
    deepChars: Number(v.deepChars) > 0 ? Number(v.deepChars) : DEFAULTS.deepChars,
    processChars: Number(v.processChars) > 0 ? Number(v.processChars) : DEFAULTS.processChars,
  }
}

// ------------------------------------------------------------------ bridge 客户端
async function bridgeHealth(config) {
  const res = await fetch(`${config.bridge}/health`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`bridge /health 返回 HTTP ${res.status}`)
  const json = await res.json()
  return {
    ok: json.ok !== false,
    name: json.name || 'dsask-bridge',
    pid: json.pid,
    port: json.port,
    online: Number(json.online || 0),
    queued: Number(json.queued || 0),
    minVersion: json.minVersion || '',
    clients: Array.isArray(json.clients) ? json.clients : [],
  }
}

async function bridgeSubmit(config, task, waitMs) {
  const created = await fetch(`${config.bridge}/task`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(task),
    signal: AbortSignal.timeout(10000),
  })
  if (!created.ok) throw new Error(`bridge /task 返回 HTTP ${created.status}`)
  const meta = await created.json()
  const id = meta.id || (meta.task && meta.task.id)
  if (!id) throw new Error('bridge 没有返回任务 id')

  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    const left = Math.max(1000, Math.min(20000, deadline - Date.now()))
    const res = await fetch(`${config.bridge}/wait?id=${encodeURIComponent(id)}&timeout=${Math.round(left / 1000)}`, {
      signal: AbortSignal.timeout(left + 5000),
    })
    if (!res.ok) throw new Error(`bridge /wait 返回 HTTP ${res.status}`)
    const json = await res.json()
    const done = json.done === true || json.status === 'done' || json.status === 'error' || Boolean(json.result)
    if (!done) continue
    const result = json.result || json
    if (result.ok === false || result.error) throw new Error(String(result.error || '网页端执行失败'))
    const data = result.data || result
    return { ok: true, text: String(data.answer || result.text || ''), data, elapsedMs: Number(result.elapsedMs || data.elapsedMs || 0) }
  }
  throw new Error(`等不到网页标签执行完（${Math.round(waitMs / 1000)} 秒）`)
}

async function settingsFile(config) {
  return path.join(config.skillDir, 'state', 'panel.json')
}

async function readSettings(config) {
  try {
    const raw = await fs.readFile(await settingsFile(config), 'utf8')
    const json = JSON.parse(raw)
    const out = { ...DEFAULTS }
    for (const key of SETTING_KEYS) if (json[key] !== undefined) out[key] = json[key]
    out.bridge = config.bridge
    return out
  } catch {
    return { ...DEFAULTS, bridge: config.bridge }
  }
}

async function writeSettings(config, patch) {
  const current = await readSettings(config)
  const next = { ...current }
  for (const key of SETTING_KEYS) {
    if (patch && patch[key] !== undefined) next[key] = patch[key]
  }
  const file = await settingsFile(config)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

async function readStats(config) {
  const ledger = path.join(config.skillDir, 'state', 'sessions.jsonl')
  const out = { runs: 0, answerChars: 0, thinkingChars: 0, shownChars: 0, deleted: 0, updatedAt: null }
  let raw = ''
  try {
    raw = await fs.readFile(ledger, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (!text) continue
    let row
    try {
      row = JSON.parse(text)
    } catch {
      continue
    }
    out.runs += 1
    out.answerChars += Number(row.chars || 0)
    out.thinkingChars += Number(row.thinkingChars || 0)
    out.shownChars += Number(row.shownChars || 0)
    if (row.deleted) out.deleted += 1
    out.updatedAt = row.at || row.time || out.updatedAt
  }
  return out
}

// ------------------------------------------------------------------ 提问前的前置动作
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 把 Edge 窗口顶到前台：visibilityState=hidden 时 DeepSeek 不会发出 completion。 */
function focusEdgeWindow() {
  if (process.platform !== 'win32') return Promise.resolve(false)
  const ps = [
    'Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes',
    'Add-Type \'using System;using System.Runtime.InteropServices;public class FS{[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);}\'',
    '$r=[System.Windows.Automation.AutomationElement]::RootElement',
    '$c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,\'Chrome_WidgetWin_1\')',
    '$w=$r.FindAll([System.Windows.Automation.TreeScope]::Children,$c)',
    'foreach($x in $w){$n=$x.Current.Name; if($n -like \'*Edge*\' -and $n -like \'*DeepSeek*\'){[FS]::ShowWindow([IntPtr]$x.Current.NativeWindowHandle,9)|Out-Null;[FS]::SetForegroundWindow([IntPtr]$x.Current.NativeWindowHandle)|Out-Null;break}}',
  ].join(';')
  return new Promise((resolve) => {
    try {
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true })
      child.on('exit', () => resolve(true))
      child.on('error', () => resolve(false))
    } catch {
      resolve(false)
    }
  })
}

/**
 * 标签停在会话页时先派一条 fire-and-forget 的 reset，让页面自己回首页。
 * 直接让提问脚本硬跳会在页面重载时丢掉在途任务，所以这里等它真的回首页再放行。
 */
async function ensureHome(config) {
  let health
  try {
    health = await bridgeHealth(config)
  } catch {
    return
  }
  const clients = health.clients || []
  const onSession = (c) => /\/a\/chat\/s\//.test(String(c.url || ''))
  const onHome = (c) => /^https:\/\/chat\.deepseek\.com\/?$/.test(String(c.url || ''))
  if (!clients.some(onSession) || clients.some(onHome)) return

  const target = clients.filter(onSession).sort((a, b) => (a.ageSec || 0) - (b.ageSec || 0))[0]
  try {
    await fetch(`${config.bridge}/task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'reset', targetSid: target.sid }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    return
  }

  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    await sleep(500)
    let now
    try {
      now = await bridgeHealth(config)
    } catch {
      return
    }
    const list = now.clients || []
    if (!list.length) return
    if (list.some(onHome)) return
  }
}

// ------------------------------------------------------------------ 操作分发
async function handleOperation(config, body) {
  const action = String((body && body.action) || '')
  if (action === 'status') {
    try {
      return { ok: true, health: await bridgeHealth(config) }
    } catch (error) {
      return { ok: false, error: message(error) }
    }
  }
  if (action === 'stats') {
    return { ok: true, stats: await readStats(config) }
  }
  if (action === 'settings.get') {
    return { ok: true, settings: await readSettings(config) }
  }
  if (action === 'settings.set') {
    return { ok: true, settings: await writeSettings(config, body.settings || {}) }
  }
  if (action === 'test') {
    const startedAt = Date.now()
    try {
      await focusEdgeWindow()
      const out = await bridgeSubmit(config, { type: 'ping' }, config.pingTimeoutMs)
      const data = out.data || {}
      return {
        ok: true,
        ms: Date.now() - startedAt,
        data: { version: data.version || '', loggedIn: Boolean(data.loggedIn), url: data.url || '', path: data.path || '', sessions: Number(data.sessions || 0) },
      }
    } catch (error) {
      return { ok: false, ms: Date.now() - startedAt, error: message(error) }
    }
  }
  if (action === 'ask') {
    const text = String((body && body.text) || '').trim()
    if (!text) return { ok: false, error: 'question 不能为空' }
    const startedAt = Date.now()
    const task = { type: 'ask', payload: text, text, question: text, newChat: config.newChat !== false, ephemeral: true, timeout: Math.round(config.askTimeoutMs / 1000) }
    if (typeof body.deep === 'boolean') task.deep = body.deep
    try {
      await focusEdgeWindow()
      await ensureHome(config)
      const out = await bridgeSubmit(config, task, config.askTimeoutMs)
      const data = out.data || {}
      const full = String(data.answer || out.text || '')
      const budget = data.deep ? config.deepChars : config.simpleChars
      const answer = budget > 0 && full.length > budget ? `${full.slice(0, budget)}…` : full
      return {
        ok: true,
        answer,
        full,
        chars: full.length,
        shownChars: answer.length,
        deep: Boolean(data.deep),
        search: Boolean(data.search),
        elapsedMs: Number(data.elapsedMs || Date.now() - startedAt),
        sessionId: data.sessionId || '',
        deleted: Boolean(data.deleted),
      }
    } catch (error) {
      return { ok: false, ms: Date.now() - startedAt, error: message(error) }
    }
  }
  return { ok: false, error: `unknown action: ${action}` }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('body 不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function register(config) {
  return (wctx) =>
    wctx.effect(() =>
      wctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        async handler(req, res) {
          if (req.method !== 'POST') return sendJSON(res, 405, { ok: false, error: 'method not allowed' })
          let body
          try {
            body = await readBody(req)
          } catch (error) {
            return sendJSON(res, 400, { ok: false, error: message(error) })
          }
          try {
            const result = await handleOperation(config, body)
            const bad = result.ok === false && String(result.error || '').startsWith('unknown action')
            sendJSON(res, bad ? 400 : 200, result)
          } catch (error) {
            sendJSON(res, 500, { ok: false, error: message(error) })
          }
        },
      }),
    )
}

// ------------------------------------------------------------------ 模型工具
const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: '网页版给出的结论（可能按预算截断）' },
    chars: { type: 'number', description: '结论原始字数' },
    shownChars: { type: 'number', description: '本次读回上下文的字数' },
    truncated: { type: 'boolean', description: '结论是否被截断' },
    deep: { type: 'boolean', description: '是否用了深度思考' },
    search: { type: 'boolean', description: '是否联网搜索' },
    elapsedMs: { type: 'number', description: '网页端耗时' },
    sessionId: { type: 'string', description: '网页会话 id（用于排查）' },
    deleted: { type: 'boolean', description: '临时会话是否已清理' },
  },
  required: ['answer'],
}

function makeOffloadTool(config) {
  return {
    name: 'ds_offload',
    description:
      '把「想一下就能答」的子问题外包给网页版 chat.deepseek.com，本地只读回压缩后的结论，用于省 token。适合推理、解释、翻译、写样板代码、整理格式；需要读文件、改代码、跑命令时不要用。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '要问网页版的问题，写完整、自包含。' },
        deep: { type: 'boolean', description: '是否强制开深度思考；留空按问题难度自动判断。' },
        maxChars: { type: 'number', description: '读回上下文的字数上限，0 表示全文。留空按深浅默认（浅 600 / 深 1200）。' },
        withProcess: { type: 'boolean', description: '是否连思考过程一起读回（默认不读，过程只落盘）。' },
      },
      required: ['question'],
    },
    output: {
      schema: TOOL_SCHEMA,
      // rc.4 requires a render function on the output contract
      render: (_args, value) => [{ type: 'text', text: String(value?.answer ?? '') }],
    },
    async execute(args) {
      const options = args && typeof args === 'object' ? args : {}
      const question = String(options.question || '').trim()
      if (!question) throw new Error('question 不能为空')
      const startedAt = Date.now()
      const task = { type: 'ask', payload: question, text: question, question, newChat: true, ephemeral: true, timeout: Math.round(config.askTimeoutMs / 1000) }
      if (typeof options.deep === 'boolean') task.deep = options.deep

      let out
      try {
        await focusEdgeWindow()
        await ensureHome(config)
        out = await bridgeSubmit(config, task, config.askTimeoutMs)
      } catch (error) {
        throw new Error(`${message(error)}｜提示：浏览器里需要有开着的 https://chat.deepseek.com/ 标签页；先在面板里点「测试连接」确认 bridge 联通。`)
      }

      const data = out.data || {}
      const full = String(data.answer || out.text || '')
      if (!full) {
        throw new Error('网页端返回了空答案：多半是标签页刚被重载或还在会话页，请把 https://chat.deepseek.com/ 打开到首页后重试')
      }
      const budget =
        options.maxChars === 0 ? 0 : Number(options.maxChars) > 0 ? Number(options.maxChars) : data.deep ? config.deepChars : config.simpleChars
      const answer = budget > 0 && full.length > budget ? `${full.slice(0, budget)}…` : full
      const thinking = String(data.thinking || '')
      const text = options.withProcess && thinking ? `[过程]\n${thinking.slice(0, config.processChars)}\n\n[结论]\n${answer}` : answer

      return {
        answer: text,
        chars: full.length,
        shownChars: answer.length,
        truncated: Boolean(budget > 0 && full.length > budget),
        deep: Boolean(data.deep),
        search: Boolean(data.search),
        elapsedMs: Number(data.elapsedMs || Date.now() - startedAt),
        sessionId: String(data.sessionId || ''),
        deleted: Boolean(data.deleted),
      }
    },
  }
}

// ------------------------------------------------------------------ 插件入口
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const log = ctx.logger || console

  try {
    ctx.inject(['fs', 'webServer'], register(config))
  } catch (error) {
    log.warn?.(`[dsh-offload] 路由注册失败: ${message(error)}`)
  }

  if (config.tools !== false) {
    ctx.inject(['tools'], (tctx) =>
      tctx.effect(() => {
        tctx.tools.register(makeOffloadTool(config))
      }),
    )
  }
}

export default { name: NAME, apply }
