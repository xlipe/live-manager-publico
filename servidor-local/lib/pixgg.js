/*
  PixGG (doações por Pix): API oficial de aplicações, só por webhook.
  O streamer cria uma aplicação no painel da PixGG (Aplicações), copia
  clientId e clientSecret e cola no painel do Live Manager (ficam em
  config/pixgg.json, fora do git). A PixGG manda um POST assinado para
  /webhooks/pixgg a cada doação; não há endpoint de consulta.
  Exige URL pública: só funciona no servidor, não no PC.
*/

const fs = require('fs')
const crypto = require('crypto')

const API = 'https://app.pixgg.com'

class PixGG {
  constructor(arquivo, { onEvent, onStatus } = {}) {
    this.arquivo = arquivo
    this.dados = this.ler() || {}
    this.onEvent = onEvent || (() => {})
    this.onStatus = onStatus || (() => {})
    this.vistos = new Set(this.dados.vistos || [])
    this.estado = { platform: 'pixgg', state: this.configurado ? 'aguardando doações' : 'parado', error: null, doacoes: 0, webhookUrl: this.dados.webhookUrl || null, ultimaEm: null }
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

  status() {
    return { ...this.estado, configurado: this.configurado, clientId: this.dados.clientId || '' }
  }

  setStatus(patch) {
    this.estado = { ...this.estado, ...patch }
    this.onStatus(this.estado)
  }

  configurar({ clientId, clientSecret }) {
    this.dados.clientId = String(clientId || '').trim()
    if (clientSecret) this.dados.clientSecret = String(clientSecret).trim()
    this.gravar()
    this.setStatus({ state: this.configurado ? 'aguardando doações' : 'parado', error: null })
  }

  limpar() {
    this.dados = { vistos: [...this.vistos].slice(-500) }
    this.gravar()
    this.setStatus({ state: 'parado', error: null, webhookUrl: null })
  }

  /* registra a URL do postback na aplicação; se a API recusar, a URL pode ser
     colada à mão na aba Aplicações da PixGG */
  async registrarWebhook(urlPublica) {
    if (!this.configurado) throw new Error('clientId e clientSecret da PixGG não configurados.')
    const url = `${urlPublica.replace(/\/$/, '')}/webhooks/pixgg`
    const r = await fetch(`${API}/Applications/set-webhook-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': this.dados.clientId, 'X-Client-Secret': this.dados.clientSecret },
      body: JSON.stringify({ webhookUrl: url }),
    })
    const texto = await r.text()
    if (!r.ok) throw new Error(`PixGG respondeu HTTP ${r.status}${texto ? ': ' + texto.slice(0, 120) : ''}`)
    this.dados.webhookUrl = url
    this.gravar()
    this.setStatus({ webhookUrl: url, error: null })
    return url
  }

  assinaturaConfere(corpoBruto, cabecalho) {
    if (!this.configurado || !cabecalho) return false
    const esperado = 'sha256=' + crypto.createHmac('sha256', this.dados.clientSecret).update(corpoBruto).digest('hex')
    const a = Buffer.from(String(cabecalho).trim())
    const b = Buffer.from(esperado)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  /* chamado pela rota POST /webhooks/pixgg com o corpo bruto */
  aoReceberPostback(corpoBruto, cabecalhoAssinatura) {
    if (!this.assinaturaConfere(corpoBruto, cabecalhoAssinatura)) return { ok: false, motivo: 'assinatura inválida' }
    let body
    try { body = JSON.parse(corpoBruto.toString('utf8')) } catch (e) { return { ok: false, motivo: 'JSON inválido' } }
    const d = body.data || {}
    const id = d.transactionPublicId || ''
    if (body.event !== 'donation.paid') return { ok: true, ignorado: body.event }
    if (id && this.vistos.has(id)) return { ok: true, repetido: true }
    if (id) { this.vistos.add(id); this.gravar() }
    const nome = String(d.donatorUsername || '').trim() || 'Anônimo'
    this.setStatus({ doacoes: this.estado.doacoes + 1, ultimaEm: Date.now(), state: 'recebendo' })
    this.onEvent({
      type: 'donation',
      platform: 'pixgg',
      id: `pixgg_${id || Date.now()}`,
      time: Date.parse(body.timestamp) || Date.now(),
      login: nome.toLowerCase(),
      name: nome,
      channelId: `pixgg:${nome.toLowerCase()}`,
      amount: Number(d.totalAmount) || 0,
      currency: 'BRL',
      text: String(d.message || ''),
      audio: d.audioLink || null,
      avatar: null,
    })
    return { ok: true }
  }
}

module.exports = { PixGG }
