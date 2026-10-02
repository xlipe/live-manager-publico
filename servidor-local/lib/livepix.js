/*
  LivePix (doações por Pix): API oficial com client_credentials.
  O streamer cria um aplicativo nas configurações da conta LivePix e cola
  client_id e client_secret no painel (ficam em config/livepix.json, fora do
  git). O módulo consulta /v2/messages de tempos em tempos e, se houver URL
  pública, registra um webhook que antecipa a consulta.
*/

const fs = require('fs')
const crypto = require('crypto')

const API = 'https://api.livepix.gg/'
const OAUTH = 'https://oauth.livepix.gg/oauth2/token'
const ESCOPOS = 'account:read messages:read payments:read webhooks'
const INTERVALO_MS = 15000

class LivePix {
  constructor(arquivo, { onEvent, onStatus } = {}) {
    this.arquivo = arquivo
    this.dados = this.ler() || {}
    this.onEvent = onEvent || (() => {})
    this.onStatus = onStatus || (() => {})
    this.token = null
    this.tokenExpira = 0
    this.timer = null
    this.vistos = new Set(this.dados.vistos || [])
    this.primeira = true
    this.estado = { platform: 'livepix', state: 'parado', error: null, conta: this.dados.conta || null, doacoes: 0, webhook: this.dados.webhookId || null }
  }

  ler() {
    try { return JSON.parse(fs.readFileSync(this.arquivo, 'utf8')) } catch (e) { return null }
  }

  gravar() {
    this.dados.vistos = [...this.vistos].slice(-500)
    fs.writeFileSync(this.arquivo, JSON.stringify(this.dados, null, 2), 'utf8')
  }

  get configurado() {
    return Boolean(this.dados.clientId && this.dados.clientSecret)
  }

  get segredoWebhook() {
    if (!this.dados.webhookToken) {
      this.dados.webhookToken = crypto.randomBytes(16).toString('hex')
      this.gravar()
    }
    return this.dados.webhookToken
  }

  status() {
    return { ...this.estado, configurado: this.configurado, clientId: this.dados.clientId || '', webhookUrl: this.dados.webhookUrl || null }
  }

  setStatus(patch) {
    this.estado = { ...this.estado, ...patch }
    this.onStatus(this.estado)
  }

  /* credenciais vindas do painel */
  configurar({ clientId, clientSecret }) {
    this.dados.clientId = String(clientId || '').trim()
    if (clientSecret) this.dados.clientSecret = String(clientSecret).trim()
    this.dados.conta = null
    this.token = null
    this.gravar()
    this.start()
  }

  limpar() {
    this.stop()
    this.dados = { vistos: [...this.vistos].slice(-500) }
    this.gravar()
    this.setStatus({ state: 'parado', error: null, conta: null, webhook: null })
  }

  start() {
    this.stop()
    if (!this.configurado) return
    this.setStatus({ state: 'conectando', error: null })
    this.ciclo()
  }

  stop() {
    clearTimeout(this.timer)
    this.timer = null
  }

  async tokenDeAcesso() {
    if (this.token && Date.now() < this.tokenExpira) return this.token
    const r = await fetch(OAUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.dados.clientId, client_secret: this.dados.clientSecret, scope: ESCOPOS }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error(j.error_description || j.error || `HTTP ${r.status}`)
      err.definitivo = r.status === 400 || r.status === 401
      throw err
    }
    this.token = j.access_token
    this.tokenExpira = Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000
    return this.token
  }

  async api(caminho, init = {}) {
    const token = await this.tokenDeAcesso()
    const r = await fetch(API + caminho, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
    if (r.status === 401) { this.token = null }
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error((j.error && (j.error.message || j.error)) || j.message || `HTTP ${r.status}`)
      err.status = r.status
      throw err
    }
    return j
  }

  async ciclo() {
    try {
      if (!this.dados.conta) {
        const a = await this.api('v2/account')
        const c = a.data || a
        this.dados.conta = { id: c.id, username: c.username, nome: c.displayName || c.username, avatar: c.avatar || null }
        this.gravar()
      }
      await this.lerMensagens()
      this.setStatus({ state: 'conectado', error: null, conta: this.dados.conta })
      this.timer = setTimeout(() => this.ciclo(), INTERVALO_MS)
    } catch (err) {
      if (err.definitivo) return this.setStatus({ state: 'credenciais recusadas', error: err.message })
      const espera = err.status === 429 ? 60000 : 20000
      this.setStatus({ state: 'erro, tentando de novo', error: err.message })
      this.timer = setTimeout(() => this.ciclo(), espera)
    }
  }

  async lerMensagens() {
    const r = await this.api('v2/messages?limit=50')
    const lista = Array.isArray(r.data) ? r.data : []
    lista.sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))
    for (const item of lista) {
      if (!item || !item.id || this.vistos.has(item.id)) continue
      this.vistos.add(item.id)
      if (this.primeira) continue // na primeira leitura só marca o que já existia
      this.emitir(item)
    }
    if (this.primeira) { this.primeira = false; this.gravar() }
    else if (lista.length) this.gravar()
  }

  emitir(item) {
    const centavos = Number(item.amount) || 0
    const nome = String(item.username || '').trim() || 'Anônimo'
    this.setStatus({ doacoes: this.estado.doacoes + 1 })
    this.onEvent({
      type: 'donation',
      platform: 'livepix',
      id: `livepix_${item.id}`,
      time: Date.parse(item.createdAt) || Date.now(),
      login: nome.toLowerCase(),
      name: nome,
      channelId: `livepix:${nome.toLowerCase()}`,
      amount: centavos / 100,
      currency: item.currency || 'BRL',
      text: String(item.message || ''),
      avatar: null,
    })
  }

  /* webhook: a LivePix só avisa que há algo novo; a leitura continua pela API */
  async registrarWebhook(urlPublica) {
    const url = `${urlPublica.replace(/\/$/, '')}/webhooks/livepix/${this.segredoWebhook}`
    if (this.dados.webhookUrl === url && this.dados.webhookId) return this.dados.webhookId
    try {
      const lista = await this.api('v2/webhooks')
      for (const w of (lista.data || [])) {
        if (w.url && w.url.includes('/webhooks/livepix/')) {
          try { await this.api(`v2/webhooks/${w.id}`, { method: 'DELETE' }) } catch (e) { /* ignora */ }
        }
      }
    } catch (e) { /* lista indisponível: segue */ }
    const r = await this.api('v2/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
    this.dados.webhookId = (r.data && r.data.id) || null
    this.dados.webhookUrl = url
    this.gravar()
    this.setStatus({ webhook: this.dados.webhookId })
    return this.dados.webhookId
  }

  /* chamado pela rota /webhooks/livepix/:token */
  aoReceberWebhook(token) {
    if (token !== this.dados.webhookToken) return false
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.ciclo(), 500)
    return true
  }
}

module.exports = { LivePix }
