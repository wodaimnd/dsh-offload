// @local/dsh-offload —— 浏览器半：侧栏入口（sidebar.panellist）+ 中央工作台（main）。
// 契约：window.__ModuleLoader__.load({ id: '<包名>', factory(require) {...} })。
// 只 require React；样式只用 --dsw-alias-* 主题 token，取不到时用兜底色。
window.__ModuleLoader__.load({
  id: '@local/dsh-offload',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const ENDPOINT = '/api/ds-offload'
    const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
    const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'

    const DEFAULTS = {
      bridge: 'http://127.0.0.1:8788',
      autoDelete: true,
      newChat: true,
      deep: 'auto',
      simpleChars: 500,
      deepChars: 1200,
      processChars: 800,
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

    const css = {
      page: { padding: '22px 26px 44px', minHeight: '100%', fontFamily: SANS, color: 'var(--dsw-alias-label-primary, #1c1d21)', background: 'var(--dsw-alias-bg-base, #fff)' },
      h1: { fontSize: 17, fontWeight: 600, margin: 0 },
      sub: { fontSize: 12.5, lineHeight: '19px', color: 'var(--dsw-alias-label-secondary, #6b6f7b)', margin: '4px 0 18px', maxWidth: 760 },
      card: { border: '1px solid var(--dsw-alias-border-l1, #e3e5ea)', borderRadius: 10, padding: '13px 15px', marginBottom: 13, background: 'var(--dsw-alias-bg-layer-1, #fafbfc)' },
      cardTitle: { fontSize: 12.5, fontWeight: 600, marginBottom: 9 },
      row: { display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0', fontSize: 12.5 },
      key: { width: 104, flex: '0 0 auto', color: 'var(--dsw-alias-label-secondary, #6b6f7b)' },
      val: { fontFamily: MONO, fontSize: 11.5, wordBreak: 'break-all' },
      btn: (primary) => ({
        appearance: 'none',
        border: '1px solid ' + (primary ? 'transparent' : 'var(--dsw-alias-border-l2, #d3d6dd)'),
        background: primary ? 'var(--dsw-alias-bg-accent, #2f6feb)' : 'transparent',
        color: primary ? '#fff' : 'inherit',
        borderRadius: 7,
        padding: '5px 13px',
        fontSize: 12.5,
        fontFamily: SANS,
        cursor: 'pointer',
        marginRight: 8,
      }),
      input: { width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2, #d3d6dd)', background: 'var(--dsw-alias-bg-base, #fff)', color: 'inherit', fontFamily: SANS, fontSize: 12.5 },
      textarea: { width: '100%', boxSizing: 'border-box', minHeight: 74, padding: '8px 10px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2, #d3d6dd)', background: 'var(--dsw-alias-bg-base, #fff)', color: 'inherit', fontFamily: SANS, fontSize: 12.5, resize: 'vertical' },
      dot: (state) => ({ width: 8, height: 8, borderRadius: 4, flex: '0 0 auto', background: state === 'ok' ? '#22a06b' : state === 'warn' ? '#d9a400' : '#d64545' }),
      pre: { margin: '8px 0 0', padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-2, #f1f2f5)', borderRadius: 8, fontFamily: SANS, fontSize: 12.5, lineHeight: '20px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      small: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary, #6b6f7b)' },
    }

    function Row(props) {
      return h('div', { style: css.row }, h('div', { style: css.key }, props.label), h('div', { style: { ...css.val, ...(props.style || {}) } }, props.children))
    }

    function Workbench() {
      const [health, setHealth] = React.useState(null)
      const [healthError, setHealthError] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [probe, setProbe] = React.useState(null)
      const [stats, setStats] = React.useState(null)
      const [settings, setSettings] = React.useState({ ...DEFAULTS })
      const [saved, setSaved] = React.useState('')
      const [question, setQuestion] = React.useState('')
      const [answer, setAnswer] = React.useState(null)

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
          .then((r) => {
            if (alive && r.ok) setSettings({ ...DEFAULTS, ...r.settings })
          })
          .catch(() => {})
        refreshStatus()
        refreshStats()
        const timer = setInterval(refreshStatus, 15000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [refreshStatus, refreshStats])

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

      return h(
        'div',
        { style: css.page },
        h('div', { style: css.h1 }, 'DS 外接'),
        h('div', { style: css.sub }, '把「想一下就能答」的子问题外包给网页版 chat.deepseek.com，本地只读回压缩后的结论。对话里的 ds_offload 工具也走这条链路。'),

        h(
          'div',
          { style: css.card },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
            h('span', { style: css.dot(state) }),
            h('span', { style: { fontSize: 12.5, fontWeight: 600 } }, health ? (online > 0 ? `已联通 · ${online} 个标签页在轮询` : 'bridge 在线，但没有网页标签在轮询') : '未联通'),
            h('span', { style: { ...css.small, marginLeft: 'auto' } }, health ? `pid ${health.pid} · :${health.port}` : ''),
          ),
          health
            ? h(
                'div',
                null,
                h(Row, { label: 'bridge' }, settings.bridge),
                h(Row, { label: '版本闸门' }, `min ${health.minVersion || '-'}`),
                h(Row, { label: '队列' }, String(health.queued || 0)),
                (health.clients || []).map((c) => h(Row, { key: c.sid, label: c.sid }, `v${c.v} · ${c.ageSec}s 前 · ${c.url}`)),
              )
            : h('div', { style: css.small }, healthError || '先启动 bridge：node scripts/dsask.mjs bridge'),
          h(
            'div',
            { style: { marginTop: 10 } },
            h('button', { style: css.btn(true), disabled: busy === 'test', onClick: runTest }, busy === 'test' ? '测试中…' : '测试连接'),
            h('button', { style: css.btn(false), onClick: () => { refreshStatus(); refreshStats() } }, '刷新'),
          ),
          probe
            ? h(
                'div',
                { style: { ...css.small, marginTop: 8 } },
                probe.ok
                  ? `✓ 往返 ${probe.ms}ms · 脚本 v${probe.data.version} · ${probe.data.loggedIn ? '已登录' : '未登录'} · 页面 ${probe.data.path} · 历史 ${probe.data.sessions} 条`
                  : `✗ ${probe.error}`,
              )
            : null,
        ),

        h(
          'div',
          { style: css.card },
          h('div', { style: css.cardTitle }, '直接问一句'),
          h('textarea', { style: css.textarea, value: question, placeholder: '要问网页版的问题，写完整、自包含', onChange: (e) => setQuestion(e.target.value) }),
          h(
            'div',
            { style: { marginTop: 8 } },
            h('button', { style: css.btn(true), disabled: busy === 'ask' || !question.trim(), onClick: runAsk }, busy === 'ask' ? '提问中…' : '发到网页版'),
          ),
          answer
            ? answer.ok
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    { style: { ...css.small, marginTop: 8 } },
                    `${answer.chars} 字 → 读回 ${answer.shownChars} 字 · ${answer.elapsedMs}ms · ${answer.deep ? '深度思考' : '快答'}${answer.search ? ' · 联网' : ''}${answer.deleted ? ' · 会话已清理' : ''}`,
                  ),
                  h('pre', { style: css.pre }, answer.answer),
                )
              : h('div', { style: { ...css.small, marginTop: 8, color: '#d64545' } }, answer.error)
            : null,
        ),

        h(
          'div',
          { style: css.card },
          h('div', { style: css.cardTitle }, '设置'),
          h(Row, { label: 'bridge' }, h('input', { style: css.input, value: settings.bridge, onChange: (e) => setSettings({ ...settings, bridge: e.target.value }) })),
          h(
            Row,
            { label: '深度思考' },
            h(
              'select',
              { style: { ...css.input, width: 180 }, value: settings.deep, onChange: (e) => setSettings({ ...settings, deep: e.target.value }) },
              h('option', { value: 'auto' }, '自动（按难度）'),
              h('option', { value: 'on' }, '总是开'),
              h('option', { value: 'off' }, '总是关'),
            ),
          ),
          h(Row, { label: '浅答预算' }, h('input', { style: { ...css.input, width: 120 }, type: 'number', value: settings.simpleChars, onChange: (e) => setSettings({ ...settings, simpleChars: Number(e.target.value) || 0 }) })),
          h(Row, { label: '深答预算' }, h('input', { style: { ...css.input, width: 120 }, type: 'number', value: settings.deepChars, onChange: (e) => setSettings({ ...settings, deepChars: Number(e.target.value) || 0 }) })),
          h(Row, { label: '过程预算' }, h('input', { style: { ...css.input, width: 120 }, type: 'number', value: settings.processChars, onChange: (e) => setSettings({ ...settings, processChars: Number(e.target.value) || 0 }) })),
          h(
            Row,
            { label: '问完即删' },
            h(
              'label',
              { style: { display: 'flex', alignItems: 'center', gap: 6, fontFamily: SANS, fontSize: 12.5 } },
              h('input', { type: 'checkbox', checked: settings.autoDelete !== false, onChange: (e) => setSettings({ ...settings, autoDelete: e.target.checked }) }),
              '临时会话用完就清理，不把网页里的对话列表搞乱',
            ),
          ),
          h(
            'div',
            { style: { marginTop: 8 } },
            h('button', { style: css.btn(true), disabled: busy === 'save', onClick: saveSettings }, busy === 'save' ? '保存中…' : '保存设置'),
            saved ? h('span', { style: css.small }, saved) : null,
          ),
        ),

        h(
          'div',
          { style: css.card },
          h('div', { style: css.cardTitle }, '账本'),
          stats
            ? h(
                'div',
                null,
                h(Row, { label: '已外包' }, `${stats.runs} 次`),
                h(Row, { label: '网页产出' }, `${stats.answerChars} 字`),
                h(Row, { label: '读回上下文' }, `${stats.shownChars} 字（约 ${Math.round(stats.shownChars / 1.6)} token）`),
                h(Row, { label: '清理会话' }, `${stats.deleted} 个`),
              )
            : h('div', { style: css.small }, '还没有记录。'),
        ),
      )
    }

    const Icon = () =>
      h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M8 2.2v3.1' }),
        h('path', { d: 'M3.4 4.6l2.2 2.2' }),
        h('path', { d: 'M12.6 4.6l-2.2 2.2' }),
        h('path', { d: 'M2.4 9.4h11.2' }),
        h('path', { d: 'M4.6 9.4c0 2.2 1.5 3.9 3.4 3.9s3.4-1.7 3.4-3.9' }),
      )

    return {
      inject: ['slots'],
      apply(ctx) {
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
