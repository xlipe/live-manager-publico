/*
  Conta Twitch do dono do canal: OAuth (authorization code) e EventSub por
  WebSocket, para os eventos que o chat anônimo não entrega (seguidores) e
  para subs, bits, raids e resgates de pontos com dados oficiais.

  Exige um aplicativo registrado em dev.twitch.tv (TWITCH_CLIENT_ID e
  TWITCH_CLIENT_SECRET no .env) com a URL de retorno
  https://SEU-DOMINIO/api/twitch/callback. O refresh_token fica em
  config/twitch.json (fora do git). Só módulos nativos.
*/

const fs = require('fs')
const crypto = require('crypto')
const { avatarOf } = require('./twitch')

const CLIENT_ID = process.env.TWITCH_CLIENT_ID || ''
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || ''
const ESCOPOS = [
  'moderator:read:followers',
  'channel:read:subscriptions',
  'bits:read',
  'channel:read:redemptions',
]
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws'

class TwitchConta {
  constructor(arquivo, { onEvent, onStatus } = {}) {
    this.arquivo = arquivo
    this.dados = this.ler()
    this.estados = new Set()
    this.onEvent = onEvent || (() => {})
    this.onStatus = onStatus || (() => {})
    this.ws = null
    this.sessionId = null
    this.keepaliveTimer = null
    this.reconnectTimer = null
    this.running = false
    this.eventsub = { state: 'parado', error: null, inscricoes: 0, eventos: 0 }
  }

  get configurado() {
    return Boolean(CLIENT_ID && CLIENT_SECRET)
  }

  get conectado() {
    return Boolean(this.dados && this.dados.refresh_token)
  }

  ler() {
    try {
      return JSON.parse(fs.readFileSync(this.arquivo, 'utf8'))
    } catch (e) {
      return null
    }
  }

  gravar() {
    if (this.dados) fs.writeFileSync(this.arquivo, JSON.stringify(this.dados, null, 2), 'utf8')
    else if (fs.existsSync(this.arquivo)) fs.unlinkSync(this.arquivo)
  }

  status() {
    return {
      configurado: this.configurado,
      conectado: this.conectado,
      conta: this.dados ? this.dados.conta || null : null,
      escopos: this.dados ? this.dados.scope || '' : '',
      erro: this.dados ? this.dados.erro || null : null,
      eventsub: this.eventsub,
    }
  }

  setEventsub(patch) {
    this.eventsub = { ...this.eventsub, ...patch }
    this.onStatus(this.eventsub)
  }

  /* ---------- OAuth ---------- */

  urlDeLogin(redirect) {
    const state = crypto.randomBytes(16).toString('hex')
    this.estados.add(state)
    setTimeout(() => this.estados.delete(state), 10 * 60 * 1000)
    const q = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirect,
      response_type: 'code',
      scope: ESCOPOS.join(' '),
      force_verify: 'true',
      state,
    })
    return `https://id.twitch.tv/oauth2/authorize?${q}`
  }

  async concluirLogin(code, state, redirect) {
    if (!this.estados.has(state)) throw new Error('Sessão de login expirada ou inválida. Tente de novo.')
    this.estados.delete(state)
    const r = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: redirect }),
    })
    const tok = await r.json()
    if (!r.ok) throw new Error(tok.message || tok.error || 'A Twitch recusou o código.')
    this.dados = {
      refresh_token: tok.refresh_token,
      access_token: tok.access_token,
      expira_em: Date.now() + (tok.expires_in || 3600) * 1000 - 60000,
      scope: Array.isArray(tok.scope) ? tok.scope.join(' ') : String(tok.scope || ''),
      conectado_em: new Date().toISOString(),
    }
    try {
      const me = await this.api('https://api.twitch.tv/helix/users')
      const u = me.data && me.data[0]
      if (u) this.dados.conta = { id: u.id, login: u.login, nome: u.display_name, foto: u.profile_image_url }
    } catch (e) {
      /* sem a conta identificada o EventSub não sobe; o status mostra o erro */
      this.dados.erro = e.message
    }
    this.gravar()
    this.iniciarEventSub()
    return this.status()
  }

  async desconectar() {
    this.pararEventSub()
    if (this.dados && this.dados.access_token) {
      try {
        await fetch(`https://id.twitch.tv/oauth2/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: CLIENT_ID, token: this.dados.access_token }),
        })
      } catch (e) { /* ignora */ }
    }
    this.dados = null
    this.gravar()
  }

  async tokenDeAcesso() {
    if (!this.conectado) throw new Error('Conta Twitch não conectada.')
    if (this.dados.access_token && Date.now() < (this.dados.expira_em || 0)) return this.dados.access_token
    const r = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: this.dados.refresh_token }),
    })
    const tok = await r.json()
    if (!r.ok) {
      this.dados.erro = tok.message || tok.error || 'não consegui renovar o acesso'
      this.gravar()
      throw new Error(`Acesso à Twitch expirou (${this.dados.erro}). Entre de novo na aba Contas.`)
    }
    this.dados.access_token = tok.access_token
    if (tok.refresh_token) this.dados.refresh_token = tok.refresh_token
    this.dados.expira_em = Date.now() + (tok.expires_in || 3600) * 1000 - 60000
    this.dados.erro = null
    this.gravar()
    return tok.access_token
  }

  async api(url, init = {}) {
    const token = await this.tokenDeAcesso()
    const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, 'Client-Id': CLIENT_ID } })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`)
    return j
  }

  /* ---------- EventSub por WebSocket ---------- */

  iniciarEventSub() {
    if (!this.conectado || !this.dados.conta) return
    this.pararEventSub()
    this.running = true
    this.setEventsub({ state: 'conectando', error: null, inscricoes: 0 })
    this.conectar(EVENTSUB_URL)
  }

  pararEventSub() {
    this.running = false
    clearTimeout(this.keepaliveTimer)
    clearTimeout(this.reconnectTimer)
    if (this.ws) {
      try { this.ws.close() } catch (e) { /* ignora */ }
      this.ws = null
    }
    this.sessionId = null
    this.setEventsub({ state: 'parado' })
  }

  conectar(url, substituindo = null) {
    if (!this.running) return
    let ws
    try {
      ws = new WebSocket(url)
    } catch (err) {
      return this.tentarDeNovo(err.message)
    }
    ws.onmessage = e => this.receber(ws, e.data, substituindo)
    ws.onerror = () => { /* onclose cuida */ }
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null
        if (this.running) this.tentarDeNovo('conexão fechada')
      }
    }
    if (!substituindo) this.ws = ws
    return ws
  }

  tentarDeNovo(motivo) {
    this.setEventsub({ state: 'reconectando', error: motivo })
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.conectar(EVENTSUB_URL), 5000)
  }

  armarKeepalive(segundos) {
    clearTimeout(this.keepaliveTimer)
    this.keepaliveTimer = setTimeout(() => {
      if (this.ws) { try { this.ws.close() } catch (e) { /* ignora */ } }
    }, (segundos + 5) * 1000)
  }

  async receber(ws, raw, substituindo) {
    let msg
    try { msg = JSON.parse(raw) } catch (e) { return }
    const tipo = msg.metadata && msg.metadata.message_type
    const payload = msg.payload || {}

    if (tipo === 'session_welcome') {
      const sess = payload.session || {}
      if (substituindo) {
        // reconexão pedida pela Twitch: a sessão nova substitui a antiga
        try { substituindo.close() } catch (e) { /* ignora */ }
        this.ws = ws
        this.sessionId = sess.id
        this.armarKeepalive(sess.keepalive_timeout_seconds || 10)
        this.setEventsub({ state: 'conectado', error: null })
        return
      }
      this.sessionId = sess.id
      this.armarKeepalive(sess.keepalive_timeout_seconds || 10)
      try {
        await this.inscrever()
        this.setEventsub({ state: 'conectado', error: null })
      } catch (err) {
        this.setEventsub({ state: 'erro ao inscrever', error: err.message })
      }
      return
    }
    if (tipo === 'session_keepalive') return this.armarKeepalive(10)
    if (tipo === 'session_reconnect') {
      const url = payload.session && payload.session.reconnect_url
      if (url) this.conectar(url, ws)
      return
    }
    if (tipo === 'revocation') {
      return this.setEventsub({ state: 'acesso revogado', error: (payload.subscription && payload.subscription.status) || 'revoked' })
    }
    if (tipo === 'notification') {
      this.armarKeepalive(10)
      const sub = payload.subscription || {}
      await this.notificacao(sub.type, payload.event || {})
    }
  }

  async inscrever() {
    const b = this.dados.conta.id
    const tipos = [
      ['channel.follow', '2', { broadcaster_user_id: b, moderator_user_id: b }],
      ['channel.subscribe', '1', { broadcaster_user_id: b }],
      ['channel.subscription.gift', '1', { broadcaster_user_id: b }],
      ['channel.subscription.message', '1', { broadcaster_user_id: b }],
      ['channel.cheer', '1', { broadcaster_user_id: b }],
      ['channel.raid', '1', { to_broadcaster_user_id: b }],
      ['channel.channel_points_custom_reward_redemption.add', '1', { broadcaster_user_id: b }],
    ]
    let ok = 0
    const erros = []
    for (const [type, version, condition] of tipos) {
      try {
        await this.api('https://api.twitch.tv/helix/eventsub/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, version, condition, transport: { method: 'websocket', session_id: this.sessionId } }),
        })
        ok++
      } catch (err) {
        erros.push(`${type}: ${err.message}`)
      }
    }
    this.setEventsub({ inscricoes: ok, error: erros.length ? erros.join(' | ') : null })
    if (!ok) throw new Error(erros.join(' | ') || 'nenhuma inscrição aceita')
  }

  async notificacao(type, ev) {
    this.setEventsub({ eventos: this.eventsub.eventos + 1 })
    const base = (login, name, id) => ({
      platform: 'twitch',
      id: `${type}_${Date.now()}_${Math.random()}`,
      time: Date.now(),
      login: login || '',
      name: name || login || 'Anônimo',
      channelId: id || login || '',
      badges: [],
      flags: {},
    })
    const anon = ev.is_anonymous
    const login = anon ? '' : ev.user_login
    const nome = anon ? 'Anônimo' : ev.user_name
    const avatar = login ? await avatarOf(login) : null

    switch (type) {
      case 'channel.follow':
        return this.onEvent({ type: 'follow', ...base(ev.user_login, ev.user_name, ev.user_id), avatar })
      case 'channel.subscribe':
        if (ev.is_gift) return // o presente chega por channel.subscription.gift
        return this.onEvent({ type: 'sub', ...base(login, nome, ev.user_id), months: 1, tier: ev.tier || '', text: '', avatar })
      case 'channel.subscription.message':
        return this.onEvent({ type: 'sub', ...base(login, nome, ev.user_id), months: Number(ev.cumulative_months || 1), tier: ev.tier || '', text: (ev.message && ev.message.text) || '', avatar, streak: ev.streak_months || 0 })
      case 'channel.subscription.gift':
        return this.onEvent({ type: 'massgift', ...base(login, nome, ev.user_id), sender: nome, count: Number(ev.total || 1), tier: ev.tier || '', avatar })
      case 'channel.cheer':
        return this.onEvent({ type: 'cheer', ...base(login, nome, ev.user_id), amount: Number(ev.bits || 0), text: ev.message || '', avatar })
      case 'channel.raid':
        return this.onEvent({ type: 'raid', ...base(ev.from_broadcaster_user_login, ev.from_broadcaster_user_name, ev.from_broadcaster_user_id), viewers: Number(ev.viewers || 0), avatar: await avatarOf(ev.from_broadcaster_user_login) })
      case 'channel.channel_points_custom_reward_redemption.add':
        return this.onEvent({ type: 'redemption', ...base(ev.user_login, ev.user_name, ev.user_id), reward: (ev.reward && ev.reward.title) || '', cost: Number(ev.reward && ev.reward.cost) || 0, text: ev.user_input || '', avatar })
      default:
        return
    }
  }
}

module.exports = { TwitchConta }
