/*
  Conta Google do dono do canal: OAuth, tokens e as chamadas à YouTube Data
  API v3 que o painel usa (escrever no chat, espectadores, inscritos).
  Só módulos nativos (fetch, crypto, fs). Sem chave configurada, `configurado`
  é false e nada aqui é chamado.

  Escopos: youtube.readonly (espectadores, inscritos) e youtube.force-ssl
  (mandar mensagem no chat), mais openid/email/profile para identificar a
  conta. O refresh_token fica em config/google.json (fora do git).
*/

const fs = require('fs')
const crypto = require('crypto')

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const ESCOPOS = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
]

class GoogleConta {
  constructor(arquivo) {
    this.arquivo = arquivo
    this.dados = this.ler()
    this.estados = new Set() // `state` do OAuth em andamento
    this.cota = { dia: hoje(), unidades: 0 } // contagem própria, aproximada
    this.liveChat = { videoId: null, id: null }
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
      canal: this.dados ? this.dados.canal || null : null,
      escopos: this.dados ? this.dados.scope || '' : '',
      cotaHoje: this.cota.dia === hoje() ? this.cota.unidades : 0,
      erro: this.dados ? this.dados.erro || null : null,
    }
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
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
  }

  async concluirLogin(code, state, redirect) {
    if (!this.estados.has(state)) throw new Error('Sessão de login expirada ou inválida. Tente de novo.')
    this.estados.delete(state)
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }),
    })
    const tok = await r.json()
    if (!r.ok) throw new Error(tok.error_description || tok.error || 'Google recusou o código.')
    if (!tok.refresh_token) throw new Error('O Google não devolveu refresh_token; refaça o login marcando o consentimento.')
    this.dados = {
      refresh_token: tok.refresh_token,
      access_token: tok.access_token,
      expira_em: Date.now() + (tok.expires_in || 3600) * 1000 - 60000,
      scope: tok.scope || '',
      conectado_em: new Date().toISOString(),
    }
    // quem é a conta e qual é o canal
    try {
      const me = await this.api('https://www.googleapis.com/oauth2/v3/userinfo')
      this.dados.conta = { email: me.email, nome: me.name, foto: me.picture }
    } catch (e) {}
    try {
      const c = await this.api('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true')
      const item = c.items && c.items[0]
      if (item) {
        this.dados.canal = {
          id: item.id,
          titulo: item.snippet.title,
          handle: item.snippet.customUrl || '',
          foto: item.snippet.thumbnails && item.snippet.thumbnails.default && item.snippet.thumbnails.default.url,
          inscritos: Number(item.statistics && item.statistics.subscriberCount) || null,
        }
      }
      this.contarCota(1)
    } catch (e) {}
    this.gravar()
    return this.status()
  }

  async desconectar() {
    if (this.dados && this.dados.refresh_token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(this.dados.refresh_token)}`, { method: 'POST' })
      } catch (e) {}
    }
    this.dados = null
    this.gravar()
    this.liveChat = { videoId: null, id: null }
  }

  async tokenDeAcesso() {
    if (!this.conectado) throw new Error('Conta Google não conectada.')
    if (this.dados.access_token && Date.now() < (this.dados.expira_em || 0)) return this.dados.access_token
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: this.dados.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token' }),
    })
    const tok = await r.json()
    if (!r.ok) {
      // refresh_token revogado ou expirado (app em modo teste vence em 7 dias)
      this.dados.erro = tok.error_description || tok.error || 'não consegui renovar o acesso'
      this.gravar()
      throw new Error(`Acesso ao Google expirou (${this.dados.erro}). Entre de novo na aba Contas.`)
    }
    this.dados.access_token = tok.access_token
    this.dados.expira_em = Date.now() + (tok.expires_in || 3600) * 1000 - 60000
    this.dados.erro = null
    this.gravar()
    return tok.access_token
  }

  async api(url, init = {}) {
    const token = await this.tokenDeAcesso()
    const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = (j.error && (j.error.message || j.error.status)) || `HTTP ${r.status}`
      throw new Error(msg)
    }
    return j
  }

  contarCota(unidades) {
    if (this.cota.dia !== hoje()) this.cota = { dia: hoje(), unidades: 0 }
    this.cota.unidades += unidades
  }

  /* ---------- YouTube: o que o painel usa ---------- */

  // liveStreamingDetails da live: liveChatId e espectadores. 1 unidade.
  async detalhesDaLive(videoId) {
    const j = await this.api(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`)
    this.contarCota(1)
    const d = (j.items && j.items[0] && j.items[0].liveStreamingDetails) || {}
    if (d.activeLiveChatId) this.liveChat = { videoId, id: d.activeLiveChatId }
    return { liveChatId: d.activeLiveChatId || null, espectadores: d.concurrentViewers != null ? Number(d.concurrentViewers) : null }
  }

  // manda uma mensagem no chat da live como o dono do canal. 50 unidades.
  async enviarNoChat(videoId, texto) {
    texto = String(texto || '').trim()
    if (!texto) throw new Error('Mensagem vazia.')
    if (texto.length > 200) throw new Error('O YouTube limita a 200 caracteres.')
    if (this.liveChat.videoId !== videoId || !this.liveChat.id) await this.detalhesDaLive(videoId)
    if (!this.liveChat.id) throw new Error('Esta live não tem chat ativo.')
    const j = await this.api('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { liveChatId: this.liveChat.id, type: 'textMessageEvent', textMessageDetails: { messageText: texto } } }),
    })
    this.contarCota(50)
    return j
  }

  // inscritos mais recentes (só os públicos). 1 unidade.
  async inscritosRecentes() {
    const j = await this.api('https://www.googleapis.com/youtube/v3/subscriptions?part=subscriberSnippet&myRecentSubscribers=true&maxResults=50')
    this.contarCota(1)
    return (j.items || []).map(it => ({
      channelId: it.subscriberSnippet && it.subscriberSnippet.channelId,
      nome: it.subscriberSnippet && it.subscriberSnippet.title,
      avatar: it.subscriberSnippet && it.subscriberSnippet.thumbnails && it.subscriberSnippet.thumbnails.default && it.subscriberSnippet.thumbnails.default.url,
      em: it.snippet && it.snippet.publishedAt,
    })).filter(x => x.channelId)
  }
}

function hoje() {
  return new Date().toISOString().slice(0, 10)
}

module.exports = { GoogleConta }
