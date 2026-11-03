// @local/dsh-offload —— 浏览器半：侧栏入口（sidebar.panellist）+ 中央工作台（main）。
// 契约：window.__ModuleLoader__.load({ id: '<包名>', factory(require) {...} })。
// 设计基线：对齐 dsh-our-free-model（主题 token + 自带滚动条 + 分区/面板/胶囊层级）。
//   1. 根节点自己是滚动容器（height:100% + overflow-y:auto + thin scrollbar）——
//      宿主 main 区域不会替我们滚，早前内容一多就被裁掉且无处可滚。
//   2. 所有颜色走 --dsw-alias-* token，深浅色切换不用重画。
//   3. 排版分层：hero（标题+状态胶囊）→ tabs → section → panel → field。
window.__ModuleLoader__.load({
  id: '@local/dsh-offload',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const ENDPOINT = '/api/ds-offload'
    const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
    const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

    const DEFAULTS = {
      bridge: 'http://127.0.0.1:8788',
      autoDelete: true,
      newChat: true,
      deep: 'auto',
      simpleChars: 500,
      deepChars: 1200,
      processChars: 800,
      deleteDelay: 900,
      deleteDelayDeep: 3200,
      enforce: false,
      stealFocus: false,
      retryOnBusy: true,
      retryTimes: 2,
      sessionTag: 'dsask',
      edgeExe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      edgeProfile: 'Profile 1',
      deepseekUrl: 'https://chat.deepseek.com/',
    }

    async function call(body) {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        let detail = ''
        try {
          detail = (await res.json()).error || ''
        } catch {
          /* 非 JSON 响应 */
        }
        throw new Error(detail || `HTTP ${res.status}`)
      }
      return res.json()
    }

    // ── 样式：一条 <style> 注入，全部主题 token，带滚动条 ──────────────────
    const CSS = `
.dso_root{
  --dso-gap:14px;
  height:100%;min-height:0;box-sizing:border-box;
  display:flex;flex-direction:column;gap:18px;
  padding:20px 24px 56px;
  overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;
  font:13px/1.55 ${SANS};
  color:var(--dsw-alias-label-primary,#1c1d21);
  background:var(--dsw-alias-bg-base,#fff);
  scrollbar-width:thin;
  scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b8f9e) 34%,transparent) transparent;
}
.dso_root *{box-sizing:border-box}
.dso_root::-webkit-scrollbar{width:10px;height:10px}
.dso_root::-webkit-scrollbar-track{background:transparent}
.dso_root::-webkit-scrollbar-thumb{
  background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b8f9e) 34%,transparent);
  border-radius:99px;border:2.5px solid transparent;background-clip:padding-box;
}
.dso_root::-webkit-scrollbar-thumb:hover{
  background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b8f9e) 56%,transparent);
  background-clip:padding-box;border:2.5px solid transparent;
}
.dso_root ::selection{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#2f6feb) 24%,transparent)}
.dso_root :focus-visible{
  outline:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#2f6feb) 78%,transparent);
  outline-offset:2px;
}

/* ── hero ── */
.dso_hero{
  position:relative;display:flex;flex-direction:column;gap:10px;
  padding:20px 22px;border-radius:18px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d3d6dd) 80%,transparent);
  background:linear-gradient(165deg,
    color-mix(in srgb,var(--dsw-alias-bg-layer-3,#f3f4f7) 90%,transparent),
    color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fafbfc) 84%,transparent));
  overflow:hidden;
}
.dso_hero::before{
  content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(120% 150% at 10% -20%,
    color-mix(in srgb,var(--dsw-alias-state-business-primary,#2f6feb) 12%,transparent),transparent 58%);
}
.dso_hero>*{position:relative}
.dso_head{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
.dso_title{margin:0;font-size:21px;font-weight:740;letter-spacing:-.4px;line-height:1.2}
.dso_sub{margin:0;font-size:12.5px;max-width:72ch;color:var(--dsw-alias-label-secondary,#6b6f7b)}
.dso_pills{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.dso_pill{
  display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1,#e3e5ea);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#f1f2f5) 80%,transparent);
  font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b6f7b);white-space:nowrap;
}
.dso_pill.strong{color:var(--dsw-alias-label-primary,#1c1d21);border-color:var(--dsw-alias-border-l2,#d3d6dd)}
.dso_pill.err{color:var(--dsw-alias-state-error-primary,#d64545);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 40%,transparent)}
.dso_dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#8b8f9e);flex:none}
.dso_dot.ok{background:var(--dsw-alias-state-success-primary,#22a06b);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary,#22a06b) 18%,transparent)}
.dso_dot.warn{background:var(--dsw-alias-state-warning-primary,#d9a400);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d9a400) 18%,transparent)}
.dso_dot.err{background:var(--dsw-alias-state-error-primary,#d64545);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 18%,transparent)}

/* ── tabs ── */
.dso_tabs{display:flex;gap:4px;flex-wrap:wrap;padding:4px;
  border:1px solid var(--dsw-alias-border-l1,#e3e5ea);border-radius:12px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fafbfc) 88%,transparent);align-self:flex-start}
.dso_tab{
  appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#6b6f7b);
  font:inherit;font-size:12.5px;font-weight:580;padding:6px 14px;border-radius:9px;cursor:pointer;
  transition:background .15s ease,color .15s ease,border-color .15s ease;
}
.dso_tab:hover{color:var(--dsw-alias-label-primary,#1c1d21);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
.dso_tab.on{
  color:var(--dsw-alias-label-primary,#1c1d21);
  background:var(--dsw-alias-bg-layer-2,#f1f2f5);
  border-color:var(--dsw-alias-border-l2,#d3d6dd);
  font-weight:680;
}

/* ── section / panel ── */
.dso_sec{display:flex;flex-direction:column;gap:10px}
.dso_sechead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;
  padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l1,#e3e5ea)}
.dso_sectitle{font-size:12px;font-weight:680;letter-spacing:.2px;color:var(--dsw-alias-label-secondary,#6b6f7b);text-transform:uppercase}
.dso_sechint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b8f9e)}
.dso_grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))}
.dso_panel{
  padding:14px 16px;border-radius:14px;
  border:1px solid var(--dsw-alias-border-l2,#d3d6dd);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fafbfc) 84%,transparent);
  min-width:0;
}
.dso_paneltitle{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:680;
  color:var(--dsw-alias-label-secondary,#6b6f7b);margin-bottom:10px}
.dso_paneltitle .dso_sechint{font-weight:400;margin-left:auto}

/* ── rows / fields ── */
.dso_rows{display:flex;flex-direction:column;gap:2px}
.dso_row{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:12.5px;min-width:0}
.dso_key{flex:0 0 auto;width:108px;color:var(--dsw-alias-label-secondary,#6b6f7b)}
.dso_val{flex:1;min-width:0;font-family:${MONO};font-size:11.5px;
  color:var(--dsw-alias-label-primary,#1c1d21);overflow-wrap:anywhere;word-break:break-all}
.dso_field{display:flex;flex-direction:column;gap:5px;min-width:0;padding:6px 0}
.dso_field>span{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b8f9e);font-weight:560}
.dso_field>small{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8f9e);line-height:1.45}
.dso_two{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))}

/* ── controls ── */
.dso_input,.dso_select,.dso_ta{
  width:100%;max-width:100%;font:inherit;font-size:12.5px;
  padding:7px 10px;border-radius:9px;
  border:1px solid var(--dsw-alias-border-l2,#d3d6dd);
  background:var(--dsw-alias-bg-base,#fff);
  color:var(--dsw-alias-label-primary,#1c1d21);
}
.dso_input:hover,.dso_select:hover,.dso_ta:hover{border-color:var(--dsw-alias-border-l3,#c2c6cf)}
.dso_ta{min-height:88px;resize:vertical;line-height:1.55;font-family:${SANS}}
.dso_btn{
  appearance:none;font:inherit;font-size:12px;font-weight:580;
  padding:6px 14px;border-radius:9px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2,#d3d6dd);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#f1f2f5) 92%,transparent);
  color:var(--dsw-alias-label-primary,#1c1d21);
  transition:background .15s ease,border-color .15s ease,opacity .15s ease;
}
.dso_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dso_btn:disabled{opacity:.5;cursor:default}
.dso_btn.primary{
  border-color:var(--dsw-alias-state-business-primary,#2f6feb);
  background:var(--dsw-alias-state-business-primary,#2f6feb);
  color:var(--dsw-alias-label-on-accent,#fff);
}
.dso_btnrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}

/* 开关：一条自绘滑块，比裸 checkbox 好读 */
.dso_switch{display:inline-flex;align-items:center;gap:9px;cursor:pointer;user-select:none;font-size:12.5px}
.dso_switch input{position:absolute;opacity:0;width:0;height:0}
.dso_switch i{
  position:relative;width:34px;height:19px;border-radius:99px;flex:none;
  border:1px solid var(--dsw-alias-border-l2,#d3d6dd);
  background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b8f9e) 22%,transparent);
  transition:background .16s ease,border-color .16s ease;
}
.dso_switch i::after{
  content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;
  background:var(--dsw-alias-label-primary,#1c1d21);opacity:.62;
  transition:transform .16s ease,opacity .16s ease,background .16s ease;
}
.dso_switch input:checked+i{
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#2f6feb) 30%,transparent);
  border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#2f6feb) 62%,transparent);
}
.dso_switch input:checked+i::after{
  transform:translateX(15px);opacity:1;background:var(--dsw-alias-state-business-primary,#2f6feb);
}
.dso_switch input:focus-visible+i{
  outline:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#2f6feb) 70%,transparent);
  outline-offset:2px;
}

/* ── output ── */
.dso_pre{
  margin:10px 0 0;padding:11px 13px;border-radius:10px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#f1f2f5) 92%,transparent);
  border:1px solid var(--dsw-alias-border-l1,#e3e5ea);
  font-family:${SANS};font-size:12.5px;line-height:1.62;
  white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;
  max-height:44vh;overflow-y:auto;
  scrollbar-width:thin;
  scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b8f9e) 34%,transparent) transparent;
}
.dso_pre::-webkit-scrollbar{width:9px}
.dso_pre::-webkit-scrollbar-thumb{
  background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b8f9e) 34%,transparent);
  border-radius:99px;border:2px solid transparent;background-clip:padding-box;
}
.dso_note{margin-top:8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b8f9e);line-height:1.55}
.dso_note.bad{color:var(--dsw-alias-state-error-primary,#d64545)}
.dso_note.good{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dso_kv{font-family:${MONO};font-size:11.5px}

/* ── 保存条 ── */
.dso_savebar{
  position:sticky;bottom:-40px;z-index:1;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  margin-top:2px;padding:10px 14px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l2,#d3d6dd);
  background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 92%,transparent);
  backdrop-filter:blur(8px);
}
.dso_savebar .dso_sechint{margin-left:auto}
`

    // ── 原子组件 ───────────────────────────────────────────────────────────
    const Pill = (props) =>
      h('span', { className: 'dso_pill' + (props.tone === 'err' ? ' err' : props.strong ? ' strong' : '') },
        props.dot ? h('span', { className: 'dso_dot ' + props.dot }) : null,
        props.children)

    const Row = (props) =>
      h('div', { className: 'dso_row' },
        h('div', { className: 'dso_key' }, props.label),
        h('div', { className: 'dso_val', style: props.mono === false ? { fontFamily: SANS } : undefined }, props.children))

    const Panel = (props) =>
      h('div', { className: 'dso_panel' },
        props.title === undefined ? null : h('div', { className: 'dso_paneltitle' }, props.title,
          props.hint === undefined ? null : h('span', { className: 'dso_sechint' }, props.hint)),
        props.children)

    const Section = (props) =>
      h('section', { className: 'dso_sec' },
        h('div', { className: 'dso_sechead' },
          h('span', { className: 'dso_sectitle' }, props.title),
          props.hint === undefined ? null : h('span', { className: 'dso_sechint' }, props.hint)),
        props.children)

    const Field = (props) =>
      h('label', { className: 'dso_field', style: props.style },
        h('span', null, props.label),
        props.children,
        props.hint === undefined ? null : h('small', null, props.hint))

    const Btn = (props) =>
      h('button', {
        type: 'button',
        className: 'dso_btn' + (props.kind ? ' ' + props.kind : ''),
        disabled: props.disabled,
        onClick: props.onClick,
        title: props.title,
      }, props.children)

    function Switch(props) {
      return h('label', { className: 'dso_switch' },
        h('input', {
          type: 'checkbox',
          checked: props.checked,
          onChange: (e) => props.onChange(e.target.checked),
        }),
        h('i', null),
        h('span', null, props.label))
    }

    const TABS = [
      { id: 'overview', label: '概览' },
      { id: 'ask', label: '提问' },
      { id: 'settings', label: '设置' },
      { id: 'ledger', label: '账本' },
    ]

    function Workbench() {
      const [tab, setTab] = React.useState('overview')
      const [health, setHealth] = React.useState(null)
      const [healthError, setHealthError] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [probe, setProbe] = React.useState(null)
      const [stats, setStats] = React.useState(null)
      const [settings, setSettings] = React.useState({ ...DEFAULTS })
      const [saved, setSaved] = React.useState('')
      const [question, setQuestion] = React.useState('')
      const [answer, setAnswer] = React.useState(null)
      const [browserMsg, setBrowserMsg] = React.useState('')

      const refreshStatus = React.useCallback(async () => {
        try {
          const r = await call({ action: 'status' })
          setHealth(r.ok ? r.health : null)
          setHealthError(r.ok ? '' : r.error || 'bridge 未联通')
        } catch (error) {
          setHealth(null)
          setHealthError(String((error && error.message) || error))
        }
      }, [])

      const refreshStats = React.useCallback(async () => {
        try {
          const r = await call({ action: 'stats' })
          if (r.ok) setStats(r.stats)
        } catch {
          setStats(null)
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        call({ action: 'settings.get' })
          .then((r) => { if (alive && r.ok) setSettings({ ...DEFAULTS, ...r.settings }) })
          .catch(() => {})
        refreshStatus()
        refreshStats()
        const timer = setInterval(refreshStatus, 15000)
        return () => { alive = false; clearInterval(timer) }
      }, [refreshStatus, refreshStats])

      const patch = (key, value) => setSettings((cur) => ({ ...cur, [key]: value }))

      const runTest = async () => {
        setBusy('test')
        setProbe(null)
        try {
          setProbe(await call({ action: 'test' }))
        } catch (error) {
          setProbe({ ok: false, error: String((error && error.message) || error) })
        } finally {
          setBusy('')
        }
      }

      const runAsk = async () => {
        const text = question.trim()
        if (!text) return
        setBusy('ask')
        setAnswer(null)
        try {
          const deep = settings.deep === 'on' ? true : settings.deep === 'off' ? false : undefined
          setAnswer(await call({ action: 'ask', text, deep }))
          refreshStats()
        } catch (error) {
          setAnswer({ ok: false, error: String((error && error.message) || error) })
        } finally {
          setBusy('')
        }
      }

      const openBrowser = async () => {
        setBusy('browser')
        setBrowserMsg('')
        try {
          const r = await call({ action: 'browser.ensure' })
          setBrowserMsg(r.ok
            ? `${r.existed ? '复用已在跑的实例' : '已启动'} · ${r.profile} · 钉死实例 ${r.running} 个`
            : `✗ ${r.error}`)
        } catch (error) {
          setBrowserMsg(`✗ ${String((error && error.message) || error)}`)
        } finally {
          setBusy('')
        }
      }

      const saveSettings = async () => {
        setBusy('save')
        try {
          const r = await call({ action: 'settings.set', settings })
          if (r.ok) {
            setSettings({ ...DEFAULTS, ...r.settings })
            setSaved('已保存')
            setTimeout(() => setSaved(''), 2500)
          }
        } catch (error) {
          setSaved(String((error && error.message) || error))
        } finally {
          setBusy('')
        }
      }

      const online = health ? Number(health.online || 0) : 0
      const state = health ? (online > 0 ? 'ok' : 'warn') : 'err'
      const stateText = health
        ? (online > 0 ? `已联通 · ${online} 个标签` : 'bridge 在线，无标签轮询')
        : '未联通'

      // ── 概览 ────────────────────────────────────────────────────────────
      const overview = h(
        'div',
        { className: 'dso_grid' },
        h(Section, { title: '链路状态', hint: 'bridge ↔ 浏览器标签' },
          h(Panel, { title: 'bridge', hint: health ? `pid ${health.pid} · :${health.port}` : '' },
            health
              ? h('div', { className: 'dso_rows' },
                  h(Row, { label: '地址' }, settings.bridge),
                  h(Row, { label: '版本闸门' }, health.minVersion || '-'),
                  h(Row, { label: '队列' }, String(health.queued || 0)),
                  h(Row, { label: '标签数' }, String(online)),
                )
              : h('div', { className: 'dso_note bad' },
                  healthError || '先启动 bridge：node scripts/dsask.mjs bridge'),
            h('div', { className: 'dso_btnrow' },
              h(Btn, { kind: 'primary', disabled: busy === 'test', onClick: runTest },
                busy === 'test' ? '测试中…' : '测试连接'),
              h(Btn, { onClick: () => { refreshStatus(); refreshStats() } }, '刷新')),
            probe
              ? h('div', { className: probe.ok ? 'dso_note good' : 'dso_note bad' },
                  probe.ok
                    ? `✓ 往返 ${probe.ms}ms · 脚本 v${probe.data.version} · ${probe.data.loggedIn ? '已登录' : '未登录'} · 页面 ${probe.data.path} · 历史 ${probe.data.sessions} 条`
                    : `✗ ${probe.error}`)
              : null,
          ),
        ),
        h(Section, { title: '浏览器', hint: '固定路径 + 固定配置，不落默认浏览器' },
          h(Panel, { title: '钉死的实例', hint: settings.edgeProfile },
            h('div', { className: 'dso_rows' },
              h(Row, { label: '可执行文件' }, settings.edgeExe),
              h(Row, { label: '配置目录' }, settings.edgeProfile),
              h(Row, { label: '首页' }, settings.deepseekUrl),
            ),
            h('div', { className: 'dso_btnrow' },
              h(Btn, { disabled: busy === 'browser', onClick: openBrowser },
                busy === 'browser' ? '打开中…' : '在指定浏览器打开'),
              h(Btn, { onClick: () => setTab('settings') }, '改配置')),
            browserMsg ? h('div', { className: 'dso_note' }, browserMsg) : null,
          ),
        ),
        health && (health.clients || []).length
          ? h(Section, { title: '在线标签', hint: `${(health.clients || []).length} 个客户端` },
              h(Panel, { title: '轮询中的页面' },
                h('div', { className: 'dso_rows' },
                  (health.clients || []).map((c) => h(Row, { key: c.sid, label: c.sid },
                    `v${c.v} · ${c.ageSec}s 前 · ${c.url}`)))))
          : null,
      )

      // ── 提问 ────────────────────────────────────────────────────────────
      const askView = h(
        Section,
        { title: '直接问一句', hint: '答案会按预算截断后再读回' },
        h(Panel, { title: '发到网页版' },
          h('textarea', {
            className: 'dso_ta',
            value: question,
            placeholder: '要问网页版的问题，写完整、自包含',
            onChange: (e) => setQuestion(e.target.value),
          }),
          h('div', { className: 'dso_btnrow' },
            h(Btn, { kind: 'primary', disabled: busy === 'ask' || !question.trim(), onClick: runAsk },
              busy === 'ask' ? '提问中…' : '发送'),
            h(Btn, { onClick: () => { setQuestion(''); setAnswer(null) } }, '清空')),
          answer
            ? (answer.ok
                ? h('div', null,
                    h('div', { className: 'dso_note' },
                      `${answer.chars} 字 → 读回 ${answer.shownChars} 字 · ${answer.elapsedMs}ms · ${answer.deep ? '深度思考' : '快答'}${answer.search ? ' · 联网' : ''}${answer.deleted ? ' · 会话已清理' : ''}`),
                    h('pre', { className: 'dso_pre' }, answer.answer))
                : h('div', { className: 'dso_note bad' }, answer.error))
            : null,
        ),
      )

      // ── 设置 ────────────────────────────────────────────────────────────
      const settingsView = h(
        React.Fragment,
        null,
        h(Section, { title: '连接', hint: '改完记得保存' },
          h('div', { className: 'dso_grid' },
            h(Panel, { title: 'bridge' },
              h(Field, { label: 'bridge 地址', hint: '默认 127.0.0.1:8788' },
                h('input', { className: 'dso_input', value: settings.bridge, onChange: (e) => patch('bridge', e.target.value) })),
              h(Field, { label: '规则约束', hint: settings.enforce === true ? '已写进系统提示，立即起作用' : '关闭时只靠模型自行判断' },
                h(Switch, { checked: settings.enforce === true, onChange: (v) => patch('enforce', v), label: '强制优先调用 ds_offload' })),
            ),
            h(Panel, { title: '浏览器', hint: '钉死路径与配置' },
              h(Field, { label: '浏览器路径' },
                h('input', { className: 'dso_input', value: settings.edgeExe, onChange: (e) => patch('edgeExe', e.target.value) })),
              h(Field, { label: '配置目录', hint: '支持 "Profile 1"、显示名 "KOF" 或索引 "1"' },
                h('input', { className: 'dso_input', value: settings.edgeProfile, onChange: (e) => patch('edgeProfile', e.target.value) })),
              h(Field, { label: 'DeepSeek 首页' },
                h('input', { className: 'dso_input', value: settings.deepseekUrl, onChange: (e) => patch('deepseekUrl', e.target.value) })),
            ),
          ),
        ),
        h(Section, { title: '网页端行为', hint: '不打扰你正在做的事' },
          h('div', { className: 'dso_grid' },
            h(Panel, { title: '打扰程度' },
              h(Field, { label: '抢前台', hint: settings.stealFocus === true ? '提问时会把浏览器顶到最前，会打断你正在做的事' : '默认后台提问，不抢焦点' },
                h(Switch, { checked: settings.stealFocus === true, onChange: (v) => patch('stealFocus', v), label: '把浏览器顶到最前' })),
              h(Field, { label: '自动重试', hint: '遇到「服务器繁忙」或没发出去时，页面自己重发' },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                  h(Switch, { checked: settings.retryOnBusy !== false, onChange: (v) => patch('retryOnBusy', v), label: '自动重发' }),
                  h('input', {
                    className: 'dso_input',
                    style: { width: 72 },
                    type: 'number', min: 0, max: 5,
                    value: settings.retryTimes,
                    onChange: (e) => patch('retryTimes', Number(e.target.value) || 0),
                  }),
                  h('span', { className: 'dso_sechint' }, '次')),
              ),
            ),
            h(Panel, { title: '会话' },
              h(Field, { label: '前缀', hint: '在网页版侧边栏里认出外接会话；留空则不加' },
                h('input', { className: 'dso_input', value: settings.sessionTag, placeholder: '留空则不加', onChange: (e) => patch('sessionTag', e.target.value) })),
              h(Field, { label: '每次新开会话' },
                h(Switch, { checked: settings.newChat !== false, onChange: (v) => patch('newChat', v), label: '提问前先开新会话' })),
              h(Field, { label: '问完即删', hint: '临时会话用完就清理，不把网页里的对话列表搞乱' },
                h(Switch, { checked: settings.autoDelete !== false, onChange: (v) => patch('autoDelete', v), label: '自动清理临时会话' })),
            ),
          ),
        ),
        h(Section, { title: '回答预算', hint: '读回上下文的字数上限' },
          h('div', { className: 'dso_grid' },
            h(Panel, { title: '深度思考' },
              h(Field, { label: '策略' },
                h('select', { className: 'dso_select', value: settings.deep, onChange: (e) => patch('deep', e.target.value) },
                  h('option', { value: 'auto' }, '自动（按难度）'),
                  h('option', { value: 'on' }, '总是开'),
                  h('option', { value: 'off' }, '总是关'))),
            ),
            h(Panel, { title: '字数上限' },
              h('div', { className: 'dso_two' },
                h(Field, { label: '浅答' },
                  h('input', { className: 'dso_input', type: 'number', value: settings.simpleChars, onChange: (e) => patch('simpleChars', Number(e.target.value) || 0) })),
                h(Field, { label: '深答' },
                  h('input', { className: 'dso_input', type: 'number', value: settings.deepChars, onChange: (e) => patch('deepChars', Number(e.target.value) || 0) })),
                h(Field, { label: '过程' },
                  h('input', { className: 'dso_input', type: 'number', value: settings.processChars, onChange: (e) => patch('processChars', Number(e.target.value) || 0) })),
              ),
            ),
          ),
        ),
        h(Section, { title: '清理时序', hint: '答案没写完就删会出现「回答突然消失」' },
          h(Panel, { title: '删除冷却' },
            h('div', { className: 'dso_two' },
              h(Field, { label: '快答 (ms)' },
                h('input', { className: 'dso_input', type: 'number', value: settings.deleteDelay, onChange: (e) => patch('deleteDelay', Number(e.target.value) || 0) })),
              h(Field, { label: '深答 (ms)' },
                h('input', { className: 'dso_input', type: 'number', value: settings.deleteDelayDeep, onChange: (e) => patch('deleteDelayDeep', Number(e.target.value) || 0) })),
            ),
          ),
        ),
        h('div', { className: 'dso_savebar' },
          h(Btn, { kind: 'primary', disabled: busy === 'save', onClick: saveSettings },
            busy === 'save' ? '保存中…' : '保存设置'),
          h(Btn, { onClick: () => call({ action: 'settings.get' }).then((r) => r.ok && setSettings({ ...DEFAULTS, ...r.settings })).catch(() => {}) }, '重新读取'),
          saved ? h('span', { className: 'dso_sechint' }, saved) : null,
        ),
      )

      // ── 账本 ────────────────────────────────────────────────────────────
      const ledgerView = h(
        Section,
        { title: '账本', hint: '读回的字才花钱，网页版烧的是免费的' },
        h(Panel, { title: '累计' },
          stats
            ? h('div', { className: 'dso_rows' },
                h(Row, { label: '已外包' }, `${stats.runs} 次`),
                h(Row, { label: '网页产出' }, `${stats.answerChars} 字`),
                h(Row, { label: '读回上下文' }, `${stats.shownChars} 字（约 ${Math.round(stats.shownChars / 1.6)} token）`),
                h(Row, { label: '思考过程' }, `${stats.thinkingChars} 字`),
                h(Row, { label: '清理会话' }, `${stats.deleted} 个`),
                h(Row, { label: '最近更新' }, String(stats.updatedAt || '-')))
            : h('div', { className: 'dso_note' }, '还没有记录。'),
          h('div', { className: 'dso_btnrow' }, h(Btn, { onClick: refreshStats }, '刷新账本')),
        ),
      )

      const body = tab === 'overview' ? overview : tab === 'ask' ? askView : tab === 'settings' ? settingsView : ledgerView

      return h(
        'div',
        { className: 'dso_root' },
        h('div', { className: 'dso_hero' },
          h('div', { className: 'dso_head' },
            h('div', { className: 'dso_title' }, 'DS 外接'),
            h('div', { className: 'dso_pills' },
              h(Pill, { dot: state, strong: true }, stateText),
              health ? h(Pill, null, `min v${health.minVersion || '-'}`) : null,
              h(Pill, null, settings.stealFocus === true ? '会抢前台' : '后台运行'))),
          h('p', { className: 'dso_sub' },
            '把「想一下就能答」的子问题外包给网页版 chat.deepseek.com，本地只读回压缩后的结论；对话里的 ds_offload 工具也走这条链路。'),
        ),
        h('div', { className: 'dso_tabs', role: 'tablist' },
          TABS.map((t) => h('button', {
            key: t.id,
            type: 'button',
            role: 'tab',
            'aria-selected': tab === t.id ? 'true' : 'false',
            className: 'dso_tab' + (tab === t.id ? ' on' : ''),
            onClick: () => setTab(t.id),
          }, t.label))),
        body,
      )
    }

    const Icon = () =>
      h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('path', { d: 'M8 2.2v3.1' }),
        h('path', { d: 'M3.4 4.6l2.2 2.2' }),
        h('path', { d: 'M12.6 4.6l-2.2 2.2' }),
        h('path', { d: 'M2.4 9.4h11.2' }),
        h('path', { d: 'M4.6 9.4c0 2.2 1.5 3.9 3.4 3.9s3.4-1.7 3.4-3.9' }),
      )

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', '@local/dsh-offload')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-offload: styles')

        ctx.effect(() =>
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register({ name: 'sidebar.panellist', id: 'ds-offload', order: 60, label: () => 'DS 外接' }, Icon),
          ),
        )
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'ds-offload' }, Workbench)))
      },
    }
  },
})
