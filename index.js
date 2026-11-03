// @local/dsh-offload —— Host 半。
// 职责：一条 /api/ds-offload 环回路由（面板用），把 bridge 的健康、自检、提问、统计、设置摊开；
//       注册一个模型工具 ds_offload，让对话里可以直接把子问题丢给网页版。
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

const ROUTE = '/api/ds-offload'
const NAME = '@local/dsh-offload'

/** Edge 真实 User Data 目录：登录态与油猴扩展都在这里，launch 优先借它。 */
const USER_DATA_DIR = process.env.DSASK_USER_DATA
  || path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data')

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
  deleteDelay: 900,
  deleteDelayDeep: 3200,
  enforce: false,
  edgeExe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  edgeProfile: 'Profile 1',
  deepseekUrl: 'https://chat.deepseek.com/',
  stealFocus: false,
  retryOnBusy: true,
  retryTimes: 2,
  sessionTag: 'dsask',
}

const SETTING_KEYS = ['autoDelete', 'newChat', 'deep', 'simpleChars', 'deepChars', 'processChars', 'bridge', 'enforce', 'deleteDelay', 'deleteDelayDeep', 'edgeExe', 'edgeProfile', 'deepseekUrl', 'stealFocus', 'retryOnBusy', 'retryTimes', 'sessionTag']

// ------------------------------------------------------------------ 规则约束（把「优先用插件」写进系统提示）
const POLICY_SECTION = 'dsh-offload:policy'
const POLICY_ORDER = 2050 // 紧跟 TOOL_WEB_SEARCH(2000) 之后
const POLICY_TEXT = [
  '## 省 token 规则（dsh-offload 已开启强制优先）',
  '每条消息先做一次分流，再决定怎么动手：',
  '1. 「想一下就能答」——纯知识问答、概念与原理讲解、翻译、改写润色、格式整理、数学与逻辑推演、命名与文案、以及不依赖本仓库的样板代码。这类必须先调用 `ds_offload`，拿回结论直接用，不要自己长篇推理。',
  '2. 「必须看现场」——读文件、改代码、跑命令、查日志、多步工具调用、依赖本会话上下文的任务。这类本地处理，不要调用 `ds_offload`。',
  '3. 调用时把 `question` 写成完整、自包含的一段话：网页版看不到本会话，也不会追问。一条消息里可以连续调用多次，把子问题拆开分别问。',
  '4. `ds_offload` 失败就本地完成，最多重试一次，不要反复重试。',
  '5. 网页版结论与代码/命令的真实输出冲突时，以真实输出为准，但要明确指出冲突点。',
].join('\n')

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
    deleteDelay: Number(v.deleteDelay) >= 0 ? Number(v.deleteDelay) : DEFAULTS.deleteDelay,
    deleteDelayDeep: Number(v.deleteDelayDeep) >= 0 ? Number(v.deleteDelayDeep) : DEFAULTS.deleteDelayDeep,
    enforce: v.enforce === true,
    edgeExe: String(v.edgeExe || DEFAULTS.edgeExe),
    edgeProfile: String(v.edgeProfile || DEFAULTS.edgeProfile),
    deepseekUrl: String(v.deepseekUrl || DEFAULTS.deepseekUrl),
    stealFocus: v.stealFocus === true,
    retryOnBusy: v.retryOnBusy !== false,
    retryTimes: Number.isFinite(Number(v.retryTimes)) ? Math.max(0, Math.min(5, Number(v.retryTimes))) : DEFAULTS.retryTimes,
    sessionTag: String(v.sessionTag === undefined ? DEFAULTS.sessionTag : v.sessionTag).trim().slice(0, 24),
  }
}

/**
 * 每次派活都带上「要不要抢前台 / 要不要重试 / 会话前缀」。
 * 抢前台默认关：用户正在工作的时候提问，不该把浏览器顶到最前面。
 */
function taskExtras(config, deep) {
  const extras = {
    stealFocus: config.stealFocus === true,
    retry: config.retryOnBusy !== false,
    retryTimes: config.retryTimes,
  }
  const tag = String(config.sessionTag || '').trim()
  if (tag) extras.tag = tag
  if (typeof deep === 'boolean') extras.deep = deep
  return extras
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

/**
 * CDP 兜底：脚本通道要求 DS 标签是可见的活动标签，用户一切走就 0 块空气；
 * CDP 通道用 focus emulation 绕开这个限制，代价是 9222 上得有一个已登录的 Edge。
 */
async function cliAskCdp(config, question, { deep, timeoutMs, stealFocus } = {}) {
  const script = path.join(config.skillDir, 'scripts', 'dsask.mjs')
  try {
    await fs.access(script)
  } catch {
    throw new Error(`找不到 dsask.mjs: ${script}`)
  }
  const args = [
    script, 'ask', '--via', 'cdp', '--json', '--max-chars', '0',
    '--timeout', String(Math.max(30, Math.round((timeoutMs || 150000) / 1000))),
    '--text', question,
  ]
  if (typeof deep === 'boolean') args.push(deep ? '--deep' : '--no-deep')
  if (stealFocus === true) args.push('--steal-focus')
  const r = await new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      return reject(error)
    }
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => { stdout += String(b) })
    child.stderr.on('data', (b) => { stderr += String(b) })
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code, stdout, stderr }))
  })
  const line = r.stdout.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'))
  if (!line) throw new Error(`CDP 兜底失败（exit ${r.code}）：${(r.stderr || '').trim().slice(0, 200) || '无输出'}`)
  let json
  try {
    json = JSON.parse(line)
  } catch {
    throw new Error(`CDP 兜底输出不是 JSON：${line.slice(0, 200)}`)
  }
  if (!String(json.answer || '').trim()) throw new Error('CDP 兜底返回空答案：确认 9222 上的 Edge 已登录 chat.deepseek.com')
  return {
    data: {
      answer: json.answer || '',
      thinking: json.thinking || '',
      deep: Boolean(json.deep),
      search: Boolean(json.search),
      sessionId: json.sessionId || '',
      deleted: Boolean(json.deleted),
      elapsedMs: Number(json.elapsedMs || 0),
    },
  }
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

/** 把 Edge 窗口顶到前台：visibilityState=hidden 时 DeepSeek 不会发出 completion。
 *  只顶 config.edgeExe 那一个安装——同机可能有第二份 Edge 或别的账号配置。 */
function focusEdgeWindow(config) {
  if (process.platform !== 'win32') return Promise.resolve(false)
  const wantExe = String((config && config.edgeExe) || DEFAULTS.edgeExe).replace(/'/g, "''")
  const ps = [
    'Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes',
    'Add-Type \'using System;using System.Runtime.InteropServices;public class FS{[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);}\'',
    '$r=[System.Windows.Automation.AutomationElement]::RootElement',
    '$c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,\'Chrome_WidgetWin_1\')',
    '$w=$r.FindAll([System.Windows.Automation.TreeScope]::Children,$c)',
    `$want='${wantExe}'`,
    'foreach($x in $w){$n=$x.Current.Name; if($n -notlike \'*DeepSeek*\'){continue}; $p=Get-Process -Id ($x.Current.ProcessId) -ErrorAction SilentlyContinue; if($p -and $p.Path -and $p.Path -ne $want){continue}; [FS]::ShowWindow([IntPtr]$x.Current.NativeWindowHandle,9)|Out-Null;[FS]::SetForegroundWindow([IntPtr]$x.Current.NativeWindowHandle)|Out-Null;break}',
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

// ------------------------------------------------------------------ 钉死的浏览器
/** Edge 的 profile 有多种叫法（目录名/显示名/邮箱/序号），互相不通。统一解析成目录名。 */
function edgeProfiles() {
  try {
    const raw = fsSync.readFileSync(path.join(USER_DATA_DIR, 'Local State'), 'utf8')
    const j = JSON.parse(raw)
    const cache = (j && j.profile && j.profile.info_cache) || {}
    return Object.entries(cache).map(([dir, v]) => ({
      dir,
      name: String((v && v.name) || ''),
      account: String((v && v.user_name) || ''),
    }))
  } catch {
    return []
  }
}

function resolveEdgeProfile(alias) {
  const want = String(alias || '').trim()
  if (!want) return 'Default'
  const list = edgeProfiles()
  const low = want.toLowerCase()
  const byDir = list.find((p) => p.dir.toLowerCase() === low)
  if (byDir) return byDir.dir
  const byName = list.find((p) => p.name && p.name.toLowerCase() === low)
  if (byName) return byName.dir
  const byAccount = list.find((p) => p.account && p.account.toLowerCase() === low)
  if (byAccount) return byAccount.dir
  if (/^\d+$/.test(want)) {
    const guess = want === '0' ? 'Default' : `Profile ${want}`
    if (list.some((p) => p.dir.toLowerCase() === guess.toLowerCase())) return guess
  }
  if (/^(default|默认|默认配置)$/i.test(want)) return 'Default'
  return want
}

/** 本机在跑的 Edge：只保留带 --profile-directory 的浏览器主进程。 */
function runningEdge(config) {
  if (process.platform !== 'win32') return Promise.resolve([])
  const ps = `
$out = @()
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | ForEach-Object {
  $cl = [string]$_.CommandLine
  $prof = ''
  if ($cl -match '--profile-directory=(?:"([^"]*)"|([^\\s"]+))') {
    if ($matches[1]) { $prof = $matches[1] } else { $prof = $matches[2] }
  }
  if ($prof) { $out += [pscustomobject]@{ pid = $_.ProcessId; profile = $prof; exe = $_.ExecutablePath } }
}
$out | ConvertTo-Json -Depth 4 -Compress
`
  return new Promise((resolve) => {
    let out = ''
    try {
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true })
      child.stdout.on('data', (b) => { out += String(b) })
      child.on('error', () => resolve([]))
      child.on('exit', () => {
        const line = out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith('{') || s.startsWith('[')).pop()
        if (!line) return resolve([])
        try {
          const j = JSON.parse(line)
          const arr = Array.isArray(j) ? j : [j]
          const wantDir = resolveEdgeProfile(config.edgeProfile)
          resolve(arr.map((r) => ({
            pid: r.pid,
            profile: r.profile || '(default)',
            exe: r.exe || '',
            pinned: String(r.exe || '').toLowerCase() === String(config.edgeExe).toLowerCase() && String(r.profile || '') === wantDir,
          })))
        } catch {
          resolve([])
        }
      })
    } catch {
      resolve([])
    }
  })
}

/**
 * 只在钉死的那个浏览器 + 那个配置里开标签页。
 * 已有同 exe + 同 profile 的实例时，这次调用只是把 URL 转交过去（不会新建窗口），
 * 绝不落到默认浏览器或别的 Edge 安装上。
 */
async function ensureBrowser(config, options = {}) {
  const url = String(options.url || config.deepseekUrl)
  const exe = config.edgeExe
  try {
    const st = await fs.stat(exe)
    if (!st.isFile()) throw new Error('不是文件')
  } catch {
    const running = await runningEdge(config)
    const installs = [...new Set(running.map((r) => r.exe).filter(Boolean))]
    throw new Error(`找不到浏览器：${exe}｜本机在跑的 Edge：${installs.join(' / ') || '无'}；在面板「设置 → 浏览器路径」里改成本机的真实路径`)
  }
  const before = await runningEdge(config)
  const existed = before.some((r) => r.pinned)
  // 别名先解析成真实目录名：填 "KOF" 或 "1" 也能落到 Profile 1，不再静默回落到 Default
  const profileDir = resolveEdgeProfile(config.edgeProfile)
  const child = spawn(exe, [`--profile-directory=${profileDir}`, url], { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
  await sleep(1200)
  const after = await runningEdge(config)
  return {
    ok: true,
    exe,
    profile: profileDir,
    profileAlias: config.edgeProfile,
    url,
    existed,
    running: after.filter((r) => r.pinned).length,
    others: after.filter((r) => !r.pinned).map((r) => `${r.profile} @ ${r.exe}`),
  }
}

/**
 * 标签停在会话页时先派一条 fire-and-forget 的 reset，让页面自己回首页。
 * 直接让提问脚本硬跳会在页面重载时丢掉在途任务，所以这里等它真的回首页再放行。
 */
async function ensureHomeClient(config) {
  const onHome = (u) => /^https:\/\/chat\.deepseek\.com\/?(\?.*)?$/.test(String(u || ''))
  const pick = (list) => (list || []).filter((c) => onHome(c.url)).sort((a, b) => (a.ageSec || 0) - (b.ageSec || 0))[0]

  let health
  try {
    health = await bridgeHealth(config)
  } catch {
    return null
  }
  const home = pick(health.clients)
  if (home) return home.sid

  // 没有停在首页的标签：挑最活跃的那个让它自己回首页，然后只把任务派给它。
  const target = (health.clients || []).slice().sort((a, b) => (a.ageSec || 0) - (b.ageSec || 0))[0]
  if (!target) return null
  try {
    await fetch(`${config.bridge}/task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'reset', targetSid: target.sid }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    return null
  }

  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    await sleep(500)
    try {
      const now = await bridgeHealth(config)
      const c = pick(now.clients)
      if (c) return c.sid
    } catch {
      return null
    }
  }
  return null
}

// ------------------------------------------------------------------ 操作分发
async function handleOperation(config, body, policy) {
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
    const next = await writeSettings(config, body.settings || {})
    // 开关一改就立刻生效，不用重启 DSH
    const state = policy && body.settings && body.settings.enforce !== undefined ? policy.set(next.enforce, 'panel') : policy ? policy.state() : null
    return { ok: true, settings: next, policy: state }
  }
  if (action === 'policy.get') {
    return { ok: true, policy: policy ? policy.state() : null }
  }
  if (action === 'policy.set') {
    if (!policy) return { ok: false, error: '规则约束不可用：systemPrompt 服务未注入' }
    const state = policy.set(Boolean(body.enabled), 'api')
    const next = await writeSettings(config, { enforce: Boolean(body.enabled) })
    return { ok: true, policy: state, settings: next }
  }
  if (action === 'test') {
    const startedAt = Date.now()
    try {
      if (config.stealFocus === true) await focusEdgeWindow(config)
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
    const task = { type: 'ask', payload: text, text, question: text, newChat: config.newChat !== false, ephemeral: true, deleteDelay: config.deleteDelay, deleteDelayDeep: config.deleteDelayDeep, timeout: Math.round(config.askTimeoutMs / 1000), ...taskExtras(config, body.deep) }
    if (typeof body.deep === 'boolean') task.deep = body.deep
    try {
      if (config.stealFocus === true) await focusEdgeWindow(config)
      const sid = await ensureHomeClient(config)
      if (sid) task.targetSid = sid
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
  if (action === 'browser.info') {
    const running = await runningEdge(config)
    let exists = true
    try {
      await fs.stat(config.edgeExe)
    } catch {
      exists = false
    }
    return { ok: true, pinned: { exe: config.edgeExe, exists, profileAlias: config.edgeProfile, profileDir: resolveEdgeProfile(config.edgeProfile), url: config.deepseekUrl }, profiles: edgeProfiles(), running }
  }
  if (action === 'browser.ensure') {
    try {
      return { ok: true, ...(await ensureBrowser(config, { url: body.url })) }
    } catch (error) {
      return { ok: false, error: message(error) }
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

function register(config, policy) {
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
            const result = await handleOperation(config, body, policy)
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
      const task = { type: 'ask', payload: question, text: question, question, newChat: true, ephemeral: true, deleteDelay: config.deleteDelay, deleteDelayDeep: config.deleteDelayDeep, timeout: Math.round(config.askTimeoutMs / 1000), ...taskExtras(config, options.deep) }
      if (typeof options.deep === 'boolean') task.deep = options.deep

      let data = null
      let bridgeError = null
      try {
        if (config.stealFocus === true) await focusEdgeWindow(config)
        const sid = await ensureHomeClient(config)
        if (sid) task.targetSid = sid
        const out = await bridgeSubmit(config, task, config.askTimeoutMs)
        const d = out.data || {}
        const text = String(d.answer || out.text || '').trim()
        if (text) data = { ...d, answer: text }
      } catch (error) {
        bridgeError = error
      }

      // 脚本通道不可用（标签不可见 / 停在死链 / bridge 无客户端）→ 走 CDP 兜底
      if (!data) {
        try {
          data = (await cliAskCdp(config, question, { deep: options.deep, timeoutMs: config.askTimeoutMs, stealFocus: config.stealFocus === true })).data
        } catch (error) {
          const first = bridgeError ? `${message(bridgeError)}｜` : ''
          throw new Error(`${first}${message(error)}`)
        }
      }

      const full = String(data.answer || '')
      if (!full) {
        throw new Error('网页端返回了空答案：确认 DeepSeek 标签页停在首页且可见，或先跑 node dsask.mjs launch 让 CDP 通道可用')
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

// ------------------------------------------------------------------ 规则约束的挂载/卸载
/**
 * 规则约束开关：开时把 POLICY_TEXT 注册成 systemPrompt 的一个 section，
 * 关时 dispose 掉。不用重启进程——section 增删会触发 system-prompt/change。
 */
function createPolicy(config, log) {
  let sctx = null
  let dispose = null
  let enabled = false

  const state = () => ({ enabled, mounted: Boolean(dispose), section: POLICY_SECTION, order: POLICY_ORDER })

  function set(next, reason) {
    enabled = Boolean(next)
    if (!sctx) return state()
    try {
      if (enabled && !dispose) {
        dispose = sctx.systemPrompt.section({ name: POLICY_SECTION, order: POLICY_ORDER, text: POLICY_TEXT })
        log.info?.(`[dsh-offload] 规则约束已启用${reason ? `（${reason}）` : ''}`)
      } else if (!enabled && dispose) {
        const fn = dispose
        dispose = null
        fn()
        log.info?.(`[dsh-offload] 规则约束已停用${reason ? `（${reason}）` : ''}`)
      }
    } catch (error) {
      dispose = null
      log.warn?.(`[dsh-offload] 规则约束切换失败: ${message(error)}`)
    }
    return state()
  }

  return {
    state,
    set,
    /** 在 systemPrompt 注入成功时调用；boot 参数表示按持久化设置恢复。 */
    attach(context, bootEnabled) {
      sctx = context
      if (bootEnabled || config.enforce) set(true, 'boot')
      return () => {
        sctx = null
        if (dispose) {
          const fn = dispose
          dispose = null
          try {
            fn()
          } catch {}
        }
      }
    },
  }
}

// ------------------------------------------------------------------ 插件入口
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const log = ctx.logger || console
  const policy = createPolicy(config, log)

  try {
    ctx.inject(['fs', 'webServer'], register(config, policy))
  } catch (error) {
    log.warn?.(`[dsh-offload] 路由注册失败: ${message(error)}`)
  }

  // systemPrompt 是可选依赖：拿不到就退化成「只有工具、没有强制规则」
  try {
    ctx.inject(['systemPrompt'], (sctx) =>
      sctx.effect(() => {
        const detach = policy.attach(sctx, false)
        // 启动时按 panel.json 里保存的开关恢复
        readSettings(config)
          .then((s) => {
            if (s.enforce) policy.set(true, 'boot')
            else policy.set(false, 'boot')
          })
          .catch(() => {})
        return detach
      }),
    )
  } catch (error) {
    log.warn?.(`[dsh-offload] 规则约束不可用（systemPrompt 未就绪）: ${message(error)}`)
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
