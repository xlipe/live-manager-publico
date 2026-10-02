/*
  Servidor local dos widgets — substitui o StreamElements.
  - Lê o chat da live do YouTube (lib/youtube.js)
  - Serve os widgets para o OBS emulando os eventos do StreamElements
  - Página de configuração no navegador (substitui o painel do StreamElements)

  Uso: node server.js   (ou iniciar.bat)
*/

const http = require('http')
const fs = require('fs')
const path = require('path')
const { YouTubeChat } = require('./lib/youtube')
const { TwitchChat } = require('./lib/twitch')
const { KickChat } = require('./lib/kick')
const { TwitchConta } = require('./lib/twitchconta')
const { LivePix } = require('./lib/livepix')
const { PixGG } = require('./lib/pixgg')
const { GoogleConta } = require('./lib/google')
const { Crm } = require('./lib/crm')

const ROOT = __dirname
const PROJECT = path.resolve(ROOT, '..')
const CONFIG_DIR = path.join(ROOT, 'config')
const SOUNDS_DIR = path.join(ROOT, 'sounds')
const PUBLIC_DIR = path.join(ROOT, 'public')

fs.mkdirSync(CONFIG_DIR, { recursive: true })
fs.mkdirSync(SOUNDS_DIR, { recursive: true })

/* Widgets disponíveis: id -> pasta com widget.html/css/js/json */
// Só a Dynamic Island é servida: o chat (na ilha ou em balões) é uma opção dela,
// em "Chat > Onde mostrar as mensagens". O widget Chat em balão da raiz fica no
// repositório como referência e para colar no StreamElements, mas não tem aba
// nem overlay aqui — servir os dois duplicava o chat na tela.
// A ordem importa na cena completa: o último fica por cima (as telas cobrem tudo).
const WIDGETS = {
  island: { name: 'Dynamic Island', dir: path.join(PROJECT, 'notch-participantes'), jquery: false },
  sons: { name: 'Botões de som', dir: path.join(PROJECT, 'sons'), jquery: false },
  telas: { name: 'Telas (Volto já / Tá começando)', dir: path.join(PROJECT, 'telas'), jquery: false },
}

/* ---------- utilidades ---------- */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return fallback
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8')
}

function readText(file) {
  return fs.readFileSync(file, 'utf8')
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra })
  res.end(body)
}

function json(res, obj, status = 200) {
  send(res, status, JSON.stringify(obj))
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.jpeg': 'image/jpeg',
}

function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'não encontrado', 'text/plain')
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  send(res, 200, fs.readFileSync(file), type)
}

/* ---------- configuração ---------- */

const serverConfigFile = path.join(CONFIG_DIR, 'server.json')
let serverConfig = readJson(serverConfigFile, { target: '', port: 8787 })

function widgetFields(id) {
  return readJson(path.join(WIDGETS[id].dir, 'widget.json'), {})
}

function widgetDefaults(id) {
  const out = {}
  for (const [key, def] of Object.entries(widgetFields(id))) {
    if (def && def.value !== undefined) out[key] = def.value
  }
  return out
}

function widgetConfig(id) {
  return readJson(path.join(CONFIG_DIR, `${id}.json`), {})
}

function widgetFieldData(id) {
  // as telas de intervalo não têm config própria: o que vale é a cena ativa
  if (id === 'telas') return { ...widgetDefaults(id), ...(cenaAtiva()?.campos || {}) }
  return { ...widgetDefaults(id), ...widgetConfig(id) }
}

/* ---------- cenas ----------
   Uma cena é um preset completo do widget `telas` (título, template, cores,
   imagem…). "principal" é a cena sem tela: só os overlays normais. Ativar uma
   cena recarrega o overlay das telas com o preset dela. Fica em
   config/cenas.json. */

const cenasFile = path.join(CONFIG_DIR, 'cenas.json')

function cenasPadrao() {
  return {
    ativa: 'principal',
    lista: [
      { id: 'volto-ja', nome: 'Volto já', campos: { titulo: 'VOLTO JÁ', subtitulo: 'já já estou de volta', template: 'gradiente', animacao: 'pulsar', cor1: '#8b7cff', cor2: '#3ef2d0' } },
      { id: 'ta-comecando', nome: 'Tá começando', campos: { titulo: 'TÁ COMEÇANDO', subtitulo: 'a live vai começar em instantes', template: 'grade-retro', animacao: 'saltando', cor1: '#ff4655', cor2: '#0f1923' } },
    ],
  }
}

let cenas = readJson(cenasFile, null) || cenasPadrao()
if (!Array.isArray(cenas.presets)) cenas.presets = []
if (!fs.existsSync(cenasFile)) writeJson(cenasFile, cenas)

// o que um preset guarda: o visual da cena, não o texto nem a imagem de fundo
const CAMPOS_FORA_DO_PRESET = new Set(['titulo', 'subtitulo', 'fundo'])
function estiloDe(campos) {
  return Object.fromEntries(Object.entries(campos || {}).filter(([k]) => !CAMPOS_FORA_DO_PRESET.has(k)))
}

function cenaAtiva() {
  return cenas.lista.find(c => c.id === cenas.ativa) || null
}

function estadoDaTela() {
  return { tela: cenas.ativa === 'principal' || !cenaAtiva() ? 'none' : 'on', cena: cenas.ativa }
}

function slug(nome) {
  return String(nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cena'
}

/* ---------- eventos (SSE) para os overlays ---------- */

const clients = new Set()

function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) {
    try {
      res.write(line)
    } catch (e) {
      clients.delete(res)
    }
  }
}

function emit(listener, event) {
  broadcast({ kind: 'event', listener, event })
}

/* ---------- YouTube -> formato do StreamElements ---------- */

const recentEvents = []

function toStreamElements(ev) {
  const author = ev.flags || {}
  const badges = (ev.badges || []).map(b => ({ ...b }))

  if (ev.type === 'message' || ev.type === 'superchat') {
    const data = {
      time: ev.time,
      nick: ev.name.toLowerCase(),
      userId: ev.channelId,
      displayName: ev.name,
      channel: serverConfig.target,
      text: ev.text,
      isAction: false,
      msgId: ev.id,
      badges,
      emotes: ev.emotes || [],
      tags: {},
      avatar: ev.avatar,
      author,
    }
    emit('message', { service: 'youtube', data })
  }

  if (ev.type === 'superchat') {
    emit('superchat-latest', {
      service: 'youtube',
      name: ev.name,
      amount: ev.amount,
      currency: ev.currency,
      message: ev.text,
      avatar: ev.avatar,
      displayString: ev.amountText,
    })
  }

  if (ev.type === 'membership') {
    emit('sponsor-latest', {
      service: 'youtube',
      name: ev.name,
      amount: ev.months || 1,
      message: ev.text,
      avatar: ev.avatar,
      header: ev.header,
    })
  }

  if (ev.type === 'giftmembership') {
    emit('sponsor-latest', {
      service: 'youtube',
      name: ev.name,
      amount: ev.count,
      message: ev.text,
      avatar: ev.avatar,
      gifted: true,
      sender: ev.name,
    })
  }
}

/* ---------- painel da live: números da transmissão em andamento ----------
   Tudo em memória, zerado quando o leitor conecta em outra live. Serve o
   /api/live e a aba "Painel da live". Sem espectadores nem inscritos: esses
   dois exigem a API oficial com login (ver docs/ROADMAP.md). */

function novaLive(videoId) {
  return {
    videoId,
    inicio: Date.now(),
    mensagens: 0,
    participantes: new Map(), // channelId -> { nome, avatar, mensagens, ultima, cargos }
    porMinuto: new Map(), // minuto (epoch/60000) -> quantidade
    chat: [], // últimas 200 mensagens
    eventos: [], // últimos 100 Super Chats, membros e presentes
    superchats: { quantidade: 0, porMoeda: {} },
    membros: { novos: 0, presentes: 0 },
  }
}

let live = novaLive(null)

function cargos(ev) {
  const f = ev.flags || {}
  const c = []
  if (f.isChatOwner) c.push('dono')
  if (f.isChatModerator) c.push('moderador')
  if (f.isChatSponsor) c.push('membro')
  if (f.isVerified) c.push('verificado')
  return c
}

function registrarNaLive(ev) {
  const agora = Date.now()
  if (ev.type === 'message' || ev.type === 'superchat') {
    live.mensagens++
    const minuto = Math.floor(agora / 60000)
    live.porMinuto.set(minuto, (live.porMinuto.get(minuto) || 0) + 1)
    for (const m of live.porMinuto.keys()) if (m < minuto - 60) live.porMinuto.delete(m)
    const id = ev.channelId || ev.name
    const p = live.participantes.get(id) || { channelId: ev.channelId || null, nome: ev.name, avatar: ev.avatar, mensagens: 0, cargos: [] }
    p.mensagens++
    p.ultima = agora
    p.cargos = cargos(ev)
    live.participantes.set(id, p)
    live.chat.push({ at: agora, id: ev.id, channelId: ev.channelId || null, nome: ev.name, avatar: ev.avatar, texto: ev.text, cargos: p.cargos, superchat: ev.type === 'superchat' ? ev.amountText : null })
    if (live.chat.length > 200) live.chat.shift()
  }
  if (ev.type === 'superchat') {
    live.superchats.quantidade++
    if (ev.currency) live.superchats.porMoeda[ev.currency] = (live.superchats.porMoeda[ev.currency] || 0) + (Number(ev.amount) || 0)
  }
  if (ev.type === 'membership') live.membros.novos++
  if (ev.type === 'giftmembership') live.membros.presentes += Number(ev.count) || 1
  if (ev.type !== 'message') {
    live.eventos.push({ at: agora, tipo: ev.type, nome: ev.name, avatar: ev.avatar, texto: ev.text, valor: ev.amountText || ev.header || (ev.count ? `${ev.count} presente(s)` : ''), meses: ev.months })
    if (live.eventos.length > 100) live.eventos.shift()
  }
}

function resumoDaLive() {
  const agora = Date.now()
  const minuto = Math.floor(agora / 60000)
  const ultimos5 = [4, 3, 2, 1, 0].reduce((s, i) => s + (live.porMinuto.get(minuto - i) || 0), 0)
  const serie = []
  for (let i = 29; i >= 0; i--) serie.push(live.porMinuto.get(minuto - i) || 0)
  const participantes = [...live.participantes.values()].sort((a, b) => b.mensagens - a.mensagens)
  return {
    status,
    videoId: live.videoId,
    inicio: live.inicio,
    mensagens: live.mensagens,
    mensagensPorMinuto: Math.round((ultimos5 / 5) * 10) / 10,
    serie,
    participantes: participantes.length,
    ativosUltimos5: participantes.filter(p => agora - p.ultima < 5 * 60000).length,
    maisAtivos: participantes.slice(0, 10),
    superchats: live.superchats,
    membros: live.membros,
    eventos: live.eventos.slice().reverse(),
    chat: live.chat.slice(-100).reverse(),
    overlays: clients.size,
    espectadores,
    inscritos: { recentes: inscritos.recentes, erro: inscritos.erro },
    google: google.status(),
    crm: { totais: crm.totais(), pendentes: crm.lista({ filtro: 'pendentes', limite: 10 }) },
  }
}

/* ---------- CRM: fichas dos viewers (config/crm.db, volume persistente) ---------- */
const crm = new Crm(path.join(CONFIG_DIR, 'crm.db'))

/* ---------- ponte com a rede (ravoque.com.br) ----------
   REDE_URL + REDE_TOKEN no .env; o mesmo token vive no .env.producao da rede
   como LIVE_MANAGER_TOKEN. Sem eles, aprovar na catraca só marca a fila. */
const REDE_URL = (process.env.REDE_URL || '').replace(/\/$/, '')
const REDE_TOKEN = process.env.REDE_TOKEN || ''
const redeConfigurada = () => Boolean(REDE_URL && REDE_TOKEN)

async function rede(caminho, init = {}) {
  const r = await fetch(`${REDE_URL}${caminho}`, { ...init, headers: { 'content-type': 'application/json', 'x-live-token': REDE_TOKEN, ...(init.headers || {}) }, signal: AbortSignal.timeout(15000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok && !j.erro) j.erro = `HTTP ${r.status}`
  return j
}

// pede o convite à rede pra uma ficha aprovada; grava o resultado na ficha
async function enviarConvite(id) {
  const f = crm.ficha(id)
  if (!f) return { ok: false, erro: 'ficha não encontrada' }
  if (!f.email || f.emailStatus !== 'confirmado') return { ok: false, erro: 'sem e-mail confirmado' }
  if (!f.aprovadoEm) return { ok: false, erro: 'ainda não aprovado na catraca' }
  if (!redeConfigurada()) return { ok: false, erro: 'ponte com a rede não configurada (REDE_URL / REDE_TOKEN)' }
  let r
  try {
    r = await rede('/api/interno/live/convite', { method: 'POST', body: JSON.stringify({ email: f.email, nome: f.nome, channelId: id, consentimentoEm: f.consentimentoEm }) })
  } catch (e) {
    return { ok: false, erro: `rede fora do alcance: ${e.message}` }
  }
  if (!r.ok) return { ok: false, erro: r.erro || 'a rede recusou' }
  crm.marcarConvidado(id)
  // o link fica na ficha (histórico) como plano B, caso o e-mail não saia
  crm.registrarAtividade(id, 'convite-link', r.avisou ? 'e-mail enviado' : `e-mail NÃO saiu: ${r.porqueNaoAvisou || '?'}`, r.url)
  return { ok: true, url: r.url, avisou: r.avisou, porqueNaoAvisou: r.porqueNaoAvisou }
}
setInterval(() => crm.limparPendentes(), 15000)
// retenção: uma vez por hora, e-mail confirmado sem conta criada em N dias some
setInterval(() => { try { const n = crm.expirarEmails(crmConfig().retencaoDias); if (n) console.log(`crm: ${n} e-mail(s) expirado(s)`) } catch (e) {} }, 3600000)

/* ---------- pontos: valores editáveis em Configurações → CRM ---------- */
const PONTOS_PADRAO = {
  mensagem: 1, cooldownMensagemSeg: 60, primeiraDoDia: 5, superchat: 20, superchatPorReal: 1,
  membro: 30, presente: 15, inscreveu: 10, entrouNaRede: 25, retencaoDias: 30,
}
function crmConfig() {
  return { ...PONTOS_PADRAO, ...(serverConfig.crmPontos || {}) }
}
function pontuarEvento(ev) {
  const c = crmConfig()
  const id = ev.channelId
  if (!id) return
  if (ev.type === 'message' || ev.type === 'superchat') {
    if (crm.primeiraDoDia(id) && c.primeiraDoDia) crm.pontuar(id, c.primeiraDoDia, 'primeira mensagem do dia')
    else if (c.mensagem) crm.pontuar(id, c.mensagem, 'mensagem no chat', 'msg', (c.cooldownMensagemSeg || 0) * 1000)
  }
  if (ev.type === 'superchat') crm.pontuar(id, (c.superchat || 0) + Math.round((Number(ev.amount) || 0) * (c.superchatPorReal || 0)), `Super Chat ${ev.amountText || ''}`.trim())
  if (ev.type === 'membership') crm.pontuar(id, c.membro, 'virou membro')
  if (ev.type === 'giftmembership') crm.pontuar(id, (c.presente || 0) * (Number(ev.count) || 1), `presenteou ${ev.count || 1} membro(s)`)
}

/* ---------- consentimento pelo chat (fase 2 do CRM, decidida em 23/09) ----------
   E-mail no chat → fica PENDENTE e a conta do canal pede SIM. SIM em 1 minuto
   → e-mail confirmado (com hora, texto e id da mensagem como prova) e o convite
   entra na fila. Sem SIM, o pendente é apagado. `!sair` apaga tudo da pessoa.
   Um pedido por viewer por live; cada resposta custa 50 unidades de cota. */

const BOTS = new Set(['streamelements', 'nightbot', 'streamlabs', 'sery_bot', 'moobot', 'fossabot'])
function ehBot(nome) {
  return BOTS.has(String(nome || '').replace(/^@/, '').toLowerCase())
}

const TEXTOS_PADRAO = {
  pedido: 'Opa, {nome}! Parece que você quer fazer parte da turma! Digita SIM pra consentir com o registro do seu e-mail e pra receber um e-mail de convite pra nossa rede 💜',
  confirmacao: 'Fechado, {nome}! Registrei aqui. Vou dar uma olhada e, se estiver tudo certo, o convite chega no seu e-mail 📬 Se mudar de ideia, é só digitar !sair que eu apago tudo.',
  saida: 'Feito, {nome}: apaguei tudo que eu tinha sobre você por aqui.',
}
function textosCrm() {
  return { ...TEXTOS_PADRAO, ...(serverConfig.crmTextos || {}) }
}

const pedidosNaLive = new Map() // channelId -> videoId em que já pedimos SIM
const REGEX_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i

async function responderNoChat(texto, nome) {
  if (!google.conectado || !status.videoId) return false
  try {
    await google.enviarNoChat(status.videoId, texto.replace(/\{nome\}/g, '@' + String(nome || '').replace(/^@/, '')))
    return true
  } catch (e) {
    console.error('resposta no chat:', e.message)
    return false
  }
}

/* ---------- comandos do chat (!algo → resposta pela conta do canal) ---------- */
const cooldownComandos = new Map()
function tratarComando(ev) {
  const texto = String(ev.text || '').trim()
  const m = texto.match(/^(![\wÀ-ÿ-]+)/)
  if (!m) return false
  const gatilho = m[1].toLowerCase()
  const cmd = (serverConfig.comandos || []).find(c => c.ativo !== false && String(c.gatilho || '').toLowerCase() === gatilho)
  if (!cmd || !cmd.resposta) return false
  const ultimo = cooldownComandos.get(gatilho) || 0
  const cooldown = (Number(cmd.cooldownSeg) || 30) * 1000
  if (Date.now() - ultimo < cooldown) return true
  cooldownComandos.set(gatilho, Date.now())
  responderNoChat(cmd.resposta, ev.name)
  return true
}

function tratarConsentimento(ev) {
  const id = ev.channelId
  const texto = String(ev.text || '').trim()
  if (!id || !texto) return
  const t = textosCrm()

  if (!/^!sair\b/i.test(texto) && tratarComando(ev)) return

  if (/^!sair\b/i.test(texto)) {
    crm.apagar(id)
    pedidosNaLive.delete(id)
    responderNoChat(t.saida, ev.name)
    return
  }

  const ficha = crm.ficha(id)
  if (!ficha) return

  if (/^sim\b/i.test(texto) && ficha.temPendente) {
    const ok = crm.confirmarSim(id, ev.id, texto)
    if (ok) {
      responderNoChat(t.confirmacao, ev.name)
      broadcast({ kind: 'crm', evento: 'consentiu', channelId: id, nome: ficha.nome })
      // o envio do convite em si é a ponte com a rede (fase 3); fica marcado como confirmado sem convidadoEm
    }
    return
  }

  const m = texto.match(REGEX_EMAIL)
  if (m && ficha.emailStatus !== 'confirmado') {
    if (pedidosNaLive.get(id) === status.videoId) return // já pedimos nesta live; não insistir
    crm.emailPendente(id, m[0].toLowerCase())
    pedidosNaLive.set(id, status.videoId)
    responderNoChat(t.pedido, ev.name)
    broadcast({ kind: 'crm', evento: 'pendente', channelId: id, nome: ficha.nome })
  }
}

let status = { state: 'parado' }
function aoReceberEvento(ev) {
    recentEvents.push({ at: Date.now(), type: ev.type, name: ev.name, text: ev.text })
    if (recentEvents.length > 30) recentEvents.shift()
    registrarNaLive(ev)
    if (!ehBot(ev.name) && ev.channelId) {
      try {
        if (ev.type === 'message' || ev.type === 'superchat') { crm.registrarMensagem(ev, status.videoId); tratarConsentimento(ev) }
        else crm.garantirFicha(ev, status.videoId) // membro/presente também abre ficha, sem contar mensagem
        if (ev.type === 'superchat') crm.registrarAtividade(ev.channelId, 'superchat', ev.amountText || `${ev.currency || ''} ${ev.amount || ''}`.trim(), ev.text)
        if (ev.type === 'membership') crm.registrarAtividade(ev.channelId, 'membro', ev.months ? `${ev.months} meses` : (ev.header || 'novo membro'), ev.text)
        if (ev.type === 'giftmembership') crm.registrarAtividade(ev.channelId, 'presente', `${ev.count || 1} presente(s)`, ev.text)
        pontuarEvento(ev)
      } catch (e) { console.error('crm:', e.message) }
    }
    toStreamElements(ev)
}
const chat = new YouTubeChat({
  onEvent: aoReceberEvento,
  onStatus: s => {
    // live nova (ou outra) zera o painel; oscilação do leitor na mesma live não
    if (s.videoId && s.videoId !== live.videoId) live = novaLive(s.videoId)
    const conectouAgora = s.state === 'conectado' && status.state !== 'conectado'
    status = s
    // espectadores na hora em que conecta, sem esperar o próximo ciclo de 30 s
    if (conectouAgora) setTimeout(lerEspectadores, 1500)
    broadcast({ kind: 'status', status: s })
  },
})

/* ---------- Twitch e Kick (chat sem login) ----------
   Entram no painel e nos overlays como o YouTube. Não passam pelo CRM, que é
   indexado por canal do YouTube; o id do usuário ganha prefixo da plataforma
   para não colidir nas estatísticas da live. */

let plataformas = { twitch: { platform: 'twitch', state: 'parado' }, kick: { platform: 'kick', state: 'parado' } }

const EVENTOS_DO_CHAT_TWITCH = ['sub', 'subgift', 'massgift', 'cheer', 'raid']

function valorDoEvento(ev) {
  if (ev.type === 'donation') return `${ev.currency === 'BRL' ? 'R$' : ev.currency || ''} ${(Number(ev.amount) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`.trim()
  if (ev.type === 'cheer') return `${ev.amount} bits`
  if (ev.type === 'raid') return `${ev.viewers} pessoas`
  if (ev.type === 'massgift') return `${ev.count} presente(s)`
  if (ev.type === 'redemption') return `${ev.reward} (${ev.cost})`
  return ''
}

function aoReceberEventoExterno(ev) {
  const nome = ev.name || ''
  if (ehBot(nome)) return
  // com a conta Twitch conectada, subs/bits/raids vêm pelo EventSub; os do chat anônimo são descartados para não duplicar
  if (ev.platform === 'twitch' && !ev.viaEventSub && EVENTOS_DO_CHAT_TWITCH.includes(ev.type) && twitchConta.eventsub.state === 'conectado') return
  const evLive = { ...ev, channelId: ev.channelId ? `${ev.platform}:${ev.channelId}` : null }
  if (ev.type === 'message') {
    recentEvents.push({ at: Date.now(), type: ev.type, name: nome, text: ev.text, plataforma: ev.platform })
    if (recentEvents.length > 30) recentEvents.shift()
    registrarNaLive(evLive)
  } else if (['sub', 'subgift', 'massgift', 'cheer', 'raid', 'follow', 'redemption', 'donation'].includes(ev.type)) {
    recentEvents.push({ at: Date.now(), type: ev.type, name: nome, text: ev.text || '', plataforma: ev.platform })
    if (recentEvents.length > 30) recentEvents.shift()
    live.eventos.push({ at: Date.now(), tipo: ev.type, nome, avatar: ev.avatar, texto: ev.text || '', valor: valorDoEvento(ev), meses: ev.months, plataforma: ev.platform })
    if (live.eventos.length > 100) live.eventos.shift()
  }
  toStreamElementsExterno(ev)
}

function toStreamElementsExterno(ev) {
  const service = ev.platform
  const author = ev.flags || {}
  if (ev.type === 'message') {
    emit('message', {
      service,
      data: {
        time: ev.time,
        nick: ev.login || String(ev.name || '').toLowerCase(),
        userId: ev.channelId,
        displayName: ev.name,
        displayColor: ev.color || undefined,
        channel: service === 'twitch' ? serverConfig.twitch : serverConfig.kick,
        text: ev.text,
        isAction: !!ev.isAction,
        msgId: ev.id,
        badges: ev.badges || [],
        emotes: ev.emotes || [],
        tags: {},
        avatar: ev.avatar,
        author,
      },
    })
  }
  if (ev.type === 'cheer') emit('cheer-latest', { service, name: ev.name, amount: ev.amount, message: ev.text, avatar: ev.avatar })
  if (ev.type === 'sub') emit('subscriber-latest', { service, name: ev.name, amount: ev.months || 1, tier: ev.tier || '', message: ev.text || '', avatar: ev.avatar })
  if (ev.type === 'subgift') emit('subscriber-latest', { service, name: ev.recipient || ev.name, sender: ev.sender, gifted: true, amount: ev.months || 1, tier: ev.tier || '', message: '', avatar: ev.avatar })
  if (ev.type === 'massgift') emit('subscriber-latest', { service, name: ev.sender, sender: ev.sender, gifted: true, bulkGifted: true, amount: ev.count || 1, tier: ev.tier || '', message: '', avatar: ev.avatar })
  if (ev.type === 'raid') emit('raid-latest', { service, name: ev.name, amount: ev.viewers || 0, avatar: ev.avatar })
  if (ev.type === 'follow') emit('follower-latest', { service, name: ev.name, avatar: ev.avatar })
  if (ev.type === 'donation') emit('tip-latest', { service, name: ev.name, amount: Number(ev.amount) || 0, currency: ev.currency === 'BRL' ? 'R$' : ev.currency || '', message: ev.text || '', avatar: ev.avatar, audio: ev.audio || null })
  if (ev.type === 'redemption') emit('redemption-latest', { service, name: ev.name, reward: ev.reward, amount: ev.cost, message: ev.text || '', avatar: ev.avatar })
  if (ev.type === 'delete-message') emit('delete-message', { service, msgId: ev.msgId })
  if (ev.type === 'delete-messages') emit('delete-messages', { service, userId: `${service}:${ev.userId}` })
}

function statusExterno(s) {
  plataformas = { ...plataformas, [s.platform]: s }
  broadcast({ kind: 'status', status, plataformas })
}

const twitch = new TwitchChat({ onEvent: aoReceberEventoExterno, onStatus: statusExterno })
const kick = new KickChat({ onEvent: aoReceberEventoExterno, onStatus: statusExterno })

/* conta Twitch (EventSub: seguidores, subs, bits, raids, resgates) e doações por Pix */
const twitchConta = new TwitchConta(path.join(CONFIG_DIR, 'twitch.json'), {
  onEvent: ev => aoReceberEventoExterno({ ...ev, viaEventSub: true }),
  onStatus: s => statusExterno({ platform: 'twitch-eventos', ...s }),
})
const livepix = new LivePix(path.join(CONFIG_DIR, 'livepix.json'), { onEvent: aoReceberEventoExterno, onStatus: statusExterno })
const pixgg = new PixGG(path.join(CONFIG_DIR, 'pixgg.json'), { onEvent: aoReceberEventoExterno, onStatus: statusExterno })

function ehLocal(req) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers['x-forwarded-host'] || req.headers.host || ''))
}

function startChat() {
  if (serverConfig.target) chat.start(serverConfig.target)
  else chat.stop()
  if (serverConfig.twitch) twitch.start(serverConfig.twitch)
  else twitch.stop()
  if (serverConfig.kick) kick.start(serverConfig.kick)
  else kick.stop()
  if (twitchConta.conectado && twitchConta.eventsub.state === 'parado') twitchConta.iniciarEventSub()
  if (livepix.configurado && !livepix.timer) livepix.start()
}

/* ---------- conta Google: espectadores e inscritos ----------
   Só roda com a conta conectada e a live no ar. Espectadores a cada 30 s
   (1 unidade), inscritos a cada 60 s (1 unidade): ~4.300 unidades num dia
   inteiro de live, dentro das 10.000 da cota. */

const google = new GoogleConta(path.join(CONFIG_DIR, 'google.json'))
let espectadores = null
let inscritos = { vistos: new Set(), recentes: [], primeiraLeitura: true, erro: null }

function urlBase(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
}

async function lerEspectadores() {
  if (!google.conectado || status.state !== 'conectado' || !status.videoId) { espectadores = null; return }
  try {
    const d = await google.detalhesDaLive(status.videoId)
    espectadores = d.espectadores
  } catch (e) {
    espectadores = null
    console.error('espectadores:', e.message)
  }
}

async function lerInscritos() {
  if (!google.conectado) return
  try {
    const lista = await google.inscritosRecentes()
    inscritos.erro = null
    const novos = lista.filter(i => !inscritos.vistos.has(i.channelId))
    for (const i of lista) {
      inscritos.vistos.add(i.channelId)
      try {
        const antes = crm.ficha(i.channelId)
        const jaTinha = antes && antes.atividades.some(a => a.tipo === 'inscreveu')
        crm.registrarAtividadeUnica(i.channelId, 'inscreveu', null, null, Date.parse(i.em) || Date.now())
        if (antes && !jaTinha && !inscritos.primeiraLeitura) crm.pontuar(i.channelId, crmConfig().inscreveu, 'se inscreveu no canal')
      } catch (e) {}
    }
    // a primeira leitura só popula; não dispara alerta de quem já era inscrito
    if (!inscritos.primeiraLeitura) {
      for (const i of novos.reverse()) {
        inscritos.recentes.unshift({ ...i, em: Date.now() })
        emit('subscriber-latest', { service: 'youtube', name: i.nome, avatar: i.avatar, message: '' })
      }
    } else {
      inscritos.recentes = lista.slice(0, 20).map(i => ({ ...i, em: Date.parse(i.em) || Date.now() }))
    }
    inscritos.primeiraLeitura = false
    inscritos.recentes = inscritos.recentes.slice(0, 50)
  } catch (e) {
    inscritos.erro = e.message
  }
}

setInterval(lerEspectadores, 30000)
setInterval(lerInscritos, 60000)
setTimeout(() => { lerEspectadores(); lerInscritos() }, 5000)

/* ---------- página do overlay (emula o StreamElements) ---------- */

function substitute(text, fieldData) {
  return text.replace(/\{\{?([a-zA-Z0-9_]+)\}?\}/g, (m, key) =>
    key in fieldData ? String(fieldData[key]) : m,
  )
}

function overlayPage(id, key = '', opts = {}) {
  const w = WIDGETS[id]
  let fieldData = widgetFieldData(id)
  // prévia de uma cena específica no painel: carrega o preset dela e já mostra
  if (id === 'telas' && opts.cena) {
    const c = cenas.lista.find(c => c.id === opts.cena)
    if (c) fieldData = { ...widgetDefaults('telas'), ...c.campos }
  }
  const forcarTela = id === 'telas' && opts.mostrar ? `fire('onEventReceived', { listener: 'tela', event: { tela: 'on' } });` : ''
  const html = substitute(readText(path.join(w.dir, 'widget.html')), fieldData)
  const css = substitute(readText(path.join(w.dir, 'widget.css')), fieldData)
  const js = readText(path.join(w.dir, 'widget.js'))
  const jquery = w.jquery ? '<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>' : ''

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${w.name}</title>
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}</style>
${jquery}
<style>${css}</style>
</head><body>
${html}
<script>
(function(){
  var fieldData = ${JSON.stringify(fieldData)};
  var channel = { username: ${JSON.stringify(String(serverConfig.target || '').replace(/^@/, ''))}, provider: 'youtube' };
  function fire(name, detail){ window.dispatchEvent(new CustomEvent(name, { detail: detail })); }
  function visivel(on){ document.documentElement.style.visibility = on ? '' : 'hidden'; }
  visivel(${serverConfig.overlaysOn !== false});
  window.addEventListener('load', function(){
    fire('onWidgetLoad', { fieldData: fieldData, channel: channel, overlay: { isEditorMode: false } });
    ${forcarTela}
    var es = new EventSource('/events?widget=${id}&key=${encodeURIComponent(key)}');
    es.onmessage = function(m){
      try {
        var p = JSON.parse(m.data);
        if (p.kind === 'event') { if (${forcarTela ? 'p.listener === \'tela\'' : 'false'}) return; fire('onEventReceived', { listener: p.listener, event: p.event }); }
        if (p.kind === 'reload' && (!p.widget || p.widget === '${id}') && !${forcarTela ? 'true' : 'false'}) location.reload();
        if (p.kind === 'visibility') visivel(p.on);
      } catch (e) {}
    };
  });
})();
</script>
<script>${js}</script>
</body></html>`
}

/* Cena completa: todos os widgets em uma única fonte de navegador. Cada widget
   continua sendo a própria página (/overlay/:id) dentro de um iframe
   transparente que cobre a tela; a posição de cada um segue vindo dos seus
   campos. Assim nenhum CSS ou id de um widget encosta no outro. */
function scenePage(key = '') {
  const k = key ? `&key=${encodeURIComponent(key)}` : ''
  const frames = Object.keys(WIDGETS)
    .filter(id => id !== 'telas')
    .map(id => `<iframe class="fixo" src="/overlay/${id}?${k.slice(1)}" title="${WIDGETS[id].name}" allowtransparency="true"></iframe>`)
    .join('\n')
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Cena completa</title>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none}
iframe.tela{opacity:0;transition:opacity .6s ease}
iframe.tela.on{opacity:1}
</style></head><body>
${frames}
<div id="telas"></div>
<script>
// As telas de intervalo são trocadas AQUI, por crossfade: a cena nova carrega
// num iframe escondido (já forçada a aparecer) e só então some a antiga. Sem
// isso, o recarregamento deixava um instante transparente e o OBS mostrava o
// que estava embaixo.
(function(){
  var box = document.getElementById('telas');
  var atual = null; // { id, iframe }
  function mostrar(id){
    if (atual && atual.id === id && !atual.recarregar) return;
    var novo = document.createElement('iframe');
    novo.className = 'tela';
    novo.title = 'Tela de intervalo';
    novo.setAttribute('allowtransparency', 'true');
    novo.src = '/overlay/telas?cena=' + encodeURIComponent(id) + '&mostrar=1' + ${JSON.stringify(k)};
    var antigo = atual;
    atual = { id: id, iframe: novo };
    novo.addEventListener('load', function(){
      requestAnimationFrame(function(){ novo.classList.add('on'); });
      if (antigo) setTimeout(function(){ antigo.iframe.remove(); }, 700);
    });
    box.appendChild(novo);
  }
  function esconder(){
    if (!atual) return;
    var velho = atual; atual = null;
    velho.iframe.classList.remove('on');
    setTimeout(function(){ velho.iframe.remove(); }, 700);
  }
  var es = new EventSource('/events?widget=cena' + ${JSON.stringify(k)});
  var primeira = true;
  es.onopen = function(){ if (!primeira) location.reload(); primeira = false; };
  es.onmessage = function(m){
    try {
      var p = JSON.parse(m.data);
      if (p.kind === 'event' && p.listener === 'tela') {
        if (p.event.tela === 'on' && p.event.cena) mostrar(p.event.cena); else esconder();
      }
      if (p.kind === 'reload' && p.widget === 'telas' && atual) { atual.recarregar = true; mostrar(atual.id); }
      if (p.kind === 'reload' && !p.widget) location.reload();
      if (p.kind === 'visibility') document.documentElement.style.visibility = p.on ? '' : 'hidden';
    } catch (e) {}
  };
})();
</script>
</body></html>`
}

/* ---------- servidor HTTP ---------- */

/* ---------- segurança (para uso em servidor público) ----------
   ADMIN_PASSWORD: protege a página de configuração e a API (HTTP Basic).
   OVERLAY_KEY: exige ?key=... nos overlays e no fluxo de eventos.
   Sem as variáveis, tudo fica aberto (uso local). */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const OVERLAY_KEY = process.env.OVERLAY_KEY || ''
const HOST = process.env.HOST || '127.0.0.1'

function isAdmin(req) {
  if (!ADMIN_PASSWORD) return true
  const h = req.headers.authorization || ''
  if (!h.startsWith('Basic ')) return false
  const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8')
  const pass = decoded.slice(decoded.indexOf(':') + 1)
  return pass === ADMIN_PASSWORD
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Live Manager"', 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Acesso restrito.')
  return false
}

function hasOverlayKey(req, url) {
  if (!OVERLAY_KEY) return true
  if (url.searchParams.get('key') === OVERLAY_KEY) return true
  return isAdmin(req) // a prévia da página de configuração também pode abrir o overlay
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const p = url.pathname

  try {
    if (p === '/') return send(res, 302, '', 'text/plain', { Location: '/config' })

    // área administrativa
    // a rede avisa que alguém que veio da live criou a conta (token, não senha)
    if (p === '/api/interno/rede/vinculo' && req.method === 'POST') {
      if (!REDE_TOKEN || req.headers['x-live-token'] !== REDE_TOKEN) return json(res, { ok: false, erro: 'não autorizado' }, 401)
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const f = crm.vincularRede(body.channelId, body)
      if (f) { crm.pontuar(body.channelId, crmConfig().entrouNaRede, 'entrou na rede'); broadcast({ kind: 'crm', evento: 'entrou-na-rede', channelId: body.channelId, nome: f.nome }) }
      return json(res, { ok: Boolean(f) })
    }

    // postbacks das plataformas de doação (abertos; cada um valida do seu jeito)
    if (p.startsWith('/webhooks/') && req.method === 'POST') {
      const lp = p.match(/^\/webhooks\/livepix\/([a-f0-9]+)$/)
      if (lp) {
        await readBody(req)
        return livepix.aoReceberWebhook(lp[1]) ? json(res, { ok: true }) : send(res, 404, 'não encontrado', 'text/plain')
      }
      if (p === '/webhooks/pixgg') {
        const bruto = await readBody(req)
        const r = pixgg.aoReceberPostback(bruto, req.headers['x-pixgg-signature-256'])
        return r.ok ? json(res, { ok: true }) : send(res, 401, r.motivo || 'recusado', 'text/plain; charset=utf-8')
      }
      return send(res, 404, 'não encontrado', 'text/plain')
    }

    if (p === '/config' || p.startsWith('/public/') || p.startsWith('/api/')) {
      if (!requireAdmin(req, res)) return
    }

    // overlays e eventos exigem a chave quando configurada
    if ((p.startsWith('/overlay/') || p === '/events') && !hasOverlayKey(req, url)) {
      return send(res, 403, 'Chave do overlay inválida.', 'text/plain; charset=utf-8')
    }

    if (p === '/config') return serveFile(res, path.join(PUBLIC_DIR, 'config.html'))
    if (p.startsWith('/public/')) return serveFile(res, path.join(PUBLIC_DIR, p.slice('/public/'.length)))
    if (p.startsWith('/sounds/')) return serveFile(res, path.join(SOUNDS_DIR, decodeURIComponent(p.slice('/sounds/'.length))))
    // a marca é pública: os overlays (no OBS, sem sessão) usam a logo
    if (p.startsWith('/marca/')) return serveFile(res, path.join(PUBLIC_DIR, 'marca', path.basename(decodeURIComponent(p))))

    // overlays
    if (p === '/overlay/cena') return send(res, 200, scenePage(url.searchParams.get('key') || ''), 'text/html; charset=utf-8')
    const ov = p.match(/^\/overlay\/(\w+)$/)
    if (ov && WIDGETS[ov[1]]) return send(res, 200, overlayPage(ov[1], url.searchParams.get('key') || '', { cena: url.searchParams.get('cena'), mostrar: url.searchParams.get('mostrar') === '1' }), 'text/html; charset=utf-8')
    // widget que deixou de existir: página transparente vazia, para uma fonte
    // antiga no OBS (ou um iframe da cena) não mostrar erro em texto na tela
    if (ov) return send(res, 200, '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head><body></body></html>', 'text/html; charset=utf-8')

    // eventos em tempo real
    if (p === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      })
      res.write(`data: ${JSON.stringify({ kind: 'status', status, plataformas })}\n\n`)
      // overlay de um widget que não existe mais (página antiga presa no OBS):
      // manda recarregar, e ele cai na página transparente vazia
      const w = url.searchParams.get('widget')
      if (w && !WIDGETS[w] && !['cena', 'painel'].includes(w)) res.write(`data: ${JSON.stringify({ kind: 'reload', widget: w })}\n\n`)
      // estado atual das telas de intervalo, para o overlay que acabou de abrir
      res.write(`data: ${JSON.stringify({ kind: 'event', listener: 'tela', event: estadoDaTela() })}\n\n`)
      clients.add(res)
      const ping = setInterval(() => res.write(': ping\n\n'), 25000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(res)
      })
      return
    }

    // API
    if (p === '/api/live') return json(res, resumoDaLive())

    // CRM de viewers
    // simula uma mensagem do chat passando pelo caminho inteiro (CRM, consentimento, overlays)
    if (p === '/api/crm/simular' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const nome = String(body.nome || 'Teste').trim()
      aoReceberEvento({ type: 'message', id: 'sim_' + Date.now(), time: Date.now(), channelId: body.channelId || 'UC_teste_' + nome.toLowerCase(), name: nome, text: String(body.texto || ''), avatar: '', badges: [], emotes: [], flags: {} })
      return json(res, { ok: true })
    }
    // busca de perfis na rede, pra vincular uma ficha na mão
    if (p === '/api/crm/rede/membros') {
      if (!redeConfigurada()) return json(res, { ok: false, erro: 'ponte com a rede não configurada', membros: [] })
      try { return json(res, await rede(`/api/interno/live/membros?q=${encodeURIComponent(url.searchParams.get('q') || '')}`)) } catch (e) { return json(res, { ok: false, erro: e.message, membros: [] }) }
    }
    // botões de som: lista (nome, arquivo, volume) e disparo
    if (p === '/api/sons') {
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        serverConfig = { ...serverConfig, sons: (body.sons || []).map(x => ({ id: x.id || slug(x.nome) + '-' + Date.now().toString(36), nome: String(x.nome || 'som').slice(0, 40), url: x.url, volume: Math.max(0, Math.min(100, Number(x.volume ?? 100))), cor: x.cor || '' })).filter(x => x.url) }
        writeJson(serverConfigFile, serverConfig)
      }
      return json(res, { sons: serverConfig.sons || [] })
    }
    if (p === '/api/som' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const som = (serverConfig.sons || []).find(x => x.id === body.id)
      if (!som) return json(res, { error: 'som não encontrado' }, 404)
      emit('som', { url: som.url, volume: som.volume, nome: som.nome })
      return json(res, { ok: true })
    }
    // comandos do chat
    if (p === '/api/comandos') {
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        serverConfig = { ...serverConfig, comandos: (body.comandos || []).map(c => ({ gatilho: '!' + String(c.gatilho || '').replace(/^!+/, '').trim().toLowerCase().slice(0, 30), resposta: String(c.resposta || '').slice(0, 200), cooldownSeg: Math.max(5, Number(c.cooldownSeg) || 30), ativo: c.ativo !== false })).filter(c => c.gatilho.length > 1 && c.resposta && c.gatilho !== '!sair' && c.gatilho !== '!sim') }
        writeJson(serverConfigFile, serverConfig)
      }
      return json(res, { comandos: serverConfig.comandos || [] })
    }
    if (p === '/api/crm/pontos') {
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        const limpo = {}
        for (const k of Object.keys(PONTOS_PADRAO)) if (body[k] !== undefined && body[k] !== '') limpo[k] = Number(body[k])
        serverConfig = { ...serverConfig, crmPontos: limpo }
        writeJson(serverConfigFile, serverConfig)
      }
      return json(res, { valores: crmConfig(), padrao: PONTOS_PADRAO, ranking: crm.ranking(50) })
    }
    if (p === '/api/crm/textos') {
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        serverConfig = { ...serverConfig, crmTextos: { pedido: body.pedido, confirmacao: body.confirmacao, saida: body.saida } }
        writeJson(serverConfigFile, serverConfig)
      }
      return json(res, { textos: textosCrm(), padrao: TEXTOS_PADRAO })
    }
    if (p === '/api/crm/viewers') return json(res, { totais: crm.totais(), lista: crm.lista({ q: url.searchParams.get('q') || '', filtro: url.searchParams.get('filtro') || '', limite: Number(url.searchParams.get('limite')) || 100 }) })
    const cv = p.match(/^\/api\/crm\/viewer\/([^/]+)(?:\/(nota|nota\/(\d+)|mesclar|aprovar|recusar|convidar|vincular|zerar-pontos))?$/)
    if (cv) {
      const id = decodeURIComponent(cv[1])
      if (!cv[2]) {
        if (req.method === 'GET') { const f = crm.ficha(id); return f ? json(res, f) : json(res, { error: 'não encontrado' }, 404) }
        if (req.method === 'POST') { const body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); return json(res, crm.editar(id, body)) }
        if (req.method === 'DELETE') { crm.apagar(id); return json(res, { ok: true }) }
      }
      if (cv[2] === 'nota' && req.method === 'POST') { const body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); const f = crm.nota(id, body.texto); return f ? json(res, f) : json(res, { error: 'não encontrado' }, 404) }
      if (cv[3] && req.method === 'DELETE') return json(res, crm.apagarNota(id, Number(cv[3])))
      if (cv[2] === 'aprovar' && req.method === 'POST') { crm.aprovar(id); const envio = await enviarConvite(id); return json(res, { ...crm.ficha(id), envio }) }
      if (cv[2] === 'convidar' && req.method === 'POST') { const envio = await enviarConvite(id); return json(res, { ...crm.ficha(id), envio }) }
      if (cv[2] === 'zerar-pontos' && req.method === 'POST') { const body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); return json(res, crm.zerarPontos(id, body.motivo)) }
      if (cv[2] === 'vincular' && req.method === 'POST') { const body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); return json(res, crm.vincularRede(id, body) || { error: 'não encontrado' }) }
      if (cv[2] === 'recusar' && req.method === 'POST') { const body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); return json(res, crm.recusar(id, body.motivo)) }
      if (cv[2] === 'mesclar' && req.method === 'POST') { const body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); return json(res, crm.mesclar(id, body.some)) }
    }

    // conta Google (OAuth) e o que ela permite
    if (p === '/api/google/status') return json(res, google.status())
    if (p === '/api/google/login') {
      if (!google.configurado) return send(res, 400, 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET não configurados no servidor.', 'text/plain; charset=utf-8')
      res.writeHead(302, { Location: google.urlDeLogin(`${urlBase(req)}/api/google/callback`) })
      return res.end()
    }
    if (p === '/api/google/callback') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const erro = url.searchParams.get('error')
      if (erro || !code) {
        res.writeHead(302, { Location: `/config#config/contas?erro=${encodeURIComponent(erro || 'sem código')}` })
        return res.end()
      }
      try {
        await google.concluirLogin(code, state, `${urlBase(req)}/api/google/callback`)
        inscritos = { vistos: new Set(), recentes: [], primeiraLeitura: true, erro: null }
        lerEspectadores(); lerInscritos()
        res.writeHead(302, { Location: '/config#config/contas' })
      } catch (e) {
        res.writeHead(302, { Location: `/config#config/contas?erro=${encodeURIComponent(e.message)}` })
      }
      return res.end()
    }
    if (p === '/api/google/logout' && req.method === 'POST') {
      await google.desconectar()
      espectadores = null
      inscritos = { vistos: new Set(), recentes: [], primeiraLeitura: true, erro: null }
      return json(res, { ok: true })
    }

    // conta Twitch (OAuth + EventSub)
    if (p === '/api/twitch/status') return json(res, twitchConta.status())
    if (p === '/api/twitch/login') {
      if (!twitchConta.configurado) return send(res, 400, 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET não configurados no servidor.', 'text/plain; charset=utf-8')
      res.writeHead(302, { Location: twitchConta.urlDeLogin(`${urlBase(req)}/api/twitch/callback`) })
      return res.end()
    }
    if (p === '/api/twitch/callback') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const erro = url.searchParams.get('error_description') || url.searchParams.get('error')
      if (erro || !code) {
        res.writeHead(302, { Location: `/config#config/contas?erro=${encodeURIComponent(erro || 'sem código')}` })
        return res.end()
      }
      try {
        await twitchConta.concluirLogin(code, state, `${urlBase(req)}/api/twitch/callback`)
        res.writeHead(302, { Location: '/config#config/contas' })
      } catch (e) {
        res.writeHead(302, { Location: `/config#config/contas?erro=${encodeURIComponent(e.message)}` })
      }
      return res.end()
    }
    if (p === '/api/twitch/logout' && req.method === 'POST') {
      await twitchConta.desconectar()
      return json(res, { ok: true })
    }

    // LivePix e PixGG (credenciais coladas no painel)
    if (p === '/api/livepix/status') return json(res, livepix.status())
    if (p === '/api/livepix/config' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      livepix.configurar(body)
      let webhook = null
      if (!ehLocal(req)) { try { webhook = await livepix.registrarWebhook(urlBase(req)) } catch (e) { webhook = `erro: ${e.message}` } }
      return json(res, { ok: true, webhook, status: livepix.status() })
    }
    if (p === '/api/livepix/logout' && req.method === 'POST') { livepix.limpar(); return json(res, { ok: true }) }

    if (p === '/api/pixgg/status') return json(res, { ...pixgg.status(), webhookEsperado: `${urlBase(req)}/webhooks/pixgg`, local: ehLocal(req) })
    if (p === '/api/pixgg/config' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      pixgg.configurar(body)
      let webhook = null
      if (!ehLocal(req)) { try { webhook = await pixgg.registrarWebhook(urlBase(req)) } catch (e) { webhook = `erro: ${e.message}` } }
      return json(res, { ok: true, webhook, status: pixgg.status() })
    }
    if (p === '/api/pixgg/logout' && req.method === 'POST') { pixgg.limpar(); return json(res, { ok: true }) }
    // mandar mensagem no chat da live como o dono do canal
    if (p === '/api/chat/enviar' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      if (!google.conectado) return json(res, { error: 'Conecte a conta Google em Configurações → Contas.' }, 400)
      if (status.state !== 'conectado' || !status.videoId) return json(res, { error: 'Nenhuma live no ar agora.' }, 400)
      try {
        await google.enviarNoChat(status.videoId, body.texto)
        return json(res, { ok: true, cotaHoje: google.status().cotaHoje })
      } catch (e) {
        return json(res, { error: e.message }, 400)
      }
    }

    if (p === '/api/status') {
      return json(res, { status, plataformas, recent: recentEvents.slice(-15).reverse(), target: serverConfig.target, twitch: serverConfig.twitch || '', kick: serverConfig.kick || '', port: serverConfig.port, overlays: clients.size, overlaysOn: serverConfig.overlaysOn !== false, cena: cenas.ativa, cenas: cenas.lista.map(c => ({ id: c.id, nome: c.nome })) })
    }
    if (p === '/api/server-config') {
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        const target = String(body.target ?? serverConfig.target ?? '').trim()
        const tw = String(body.twitch ?? serverConfig.twitch ?? '').trim()
        const kk = String(body.kick ?? serverConfig.kick ?? '').trim()
        const restart = target !== serverConfig.target || tw !== (serverConfig.twitch || '') || kk !== (serverConfig.kick || '')
        serverConfig = { ...serverConfig, target, twitch: tw, kick: kk }
        writeJson(serverConfigFile, serverConfig)
        if (restart) startChat()
        return json(res, { ok: true, config: serverConfig })
      }
      return json(res, { ...serverConfig, overlayKey: OVERLAY_KEY })
    }
    // liga/desliga todos os overlays de uma vez, sem mexer no OBS
    if (p === '/api/overlays' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      serverConfig = { ...serverConfig, overlaysOn: body.on !== false }
      writeJson(serverConfigFile, serverConfig)
      broadcast({ kind: 'visibility', on: serverConfig.overlaysOn })
      return json(res, { ok: true, on: serverConfig.overlaysOn })
    }
    // cenas: listar, ativar, criar, renomear, salvar campos, apagar
    if (p === '/api/cenas') {
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        const acao = body.acao
        if (acao === 'ativar') {
          const id = body.id === 'principal' || cenas.lista.some(c => c.id === body.id) ? body.id : 'principal'
          cenas.ativa = id
          writeJson(cenasFile, cenas)
          emit('tela', estadoDaTela()) // a cena completa faz o crossfade a partir disto
          if (id !== 'principal') broadcast({ kind: 'reload', widget: 'telas' }) // overlay avulso das telas recarrega com o preset
        } else if (acao === 'criar') {
          let id = slug(body.nome)
          while (cenas.lista.some(c => c.id === id) || id === 'principal') id += '-2'
          const base = cenas.lista.find(c => c.id === body.copiarDe)
          const padrao = cenas.presets.find(pr => pr.id === cenas.presetPadrao)
          cenas.lista.push({ id, nome: String(body.nome || 'Nova cena').trim() || 'Nova cena', campos: base ? { ...base.campos } : padrao ? { ...padrao.campos } : {} })
          writeJson(cenasFile, cenas)
          return json(res, { ok: true, id, ...cenas })
        } else if (acao === 'renomear') {
          const c = cenas.lista.find(c => c.id === body.id)
          if (c) c.nome = String(body.nome || c.nome).trim() || c.nome
          writeJson(cenasFile, cenas)
        } else if (acao === 'salvar') {
          const c = cenas.lista.find(c => c.id === body.id)
          if (c) c.campos = body.campos || {}
          writeJson(cenasFile, cenas)
          if (body.id === cenas.ativa) broadcast({ kind: 'reload', widget: 'telas' })
        } else if (acao === 'preset-salvar') {
          const c = cenas.lista.find(c => c.id === body.cenaId)
          let id = slug(body.nome)
          while (cenas.presets.some(pr => pr.id === id)) id += '-2'
          cenas.presets.push({ id, nome: String(body.nome || 'Preset').trim() || 'Preset', campos: estiloDe(c ? c.campos : body.campos) })
          if (!cenas.presetPadrao) cenas.presetPadrao = id
          writeJson(cenasFile, cenas)
        } else if (acao === 'preset-aplicar') {
          const c = cenas.lista.find(c => c.id === body.cenaId)
          const pr = cenas.presets.find(pr => pr.id === body.id)
          if (c && pr) {
            const texto = { titulo: c.campos.titulo, subtitulo: c.campos.subtitulo, fundo: c.campos.fundo }
            c.campos = { ...pr.campos, ...Object.fromEntries(Object.entries(texto).filter(([, v]) => v !== undefined)) }
            writeJson(cenasFile, cenas)
            if (c.id === cenas.ativa) broadcast({ kind: 'reload', widget: 'telas' })
          }
        } else if (acao === 'preset-padrao') {
          cenas.presetPadrao = cenas.presets.some(pr => pr.id === body.id) ? body.id : null
          writeJson(cenasFile, cenas)
        } else if (acao === 'preset-apagar') {
          cenas.presets = cenas.presets.filter(pr => pr.id !== body.id)
          if (cenas.presetPadrao === body.id) cenas.presetPadrao = null
          writeJson(cenasFile, cenas)
        } else if (acao === 'apagar') {
          cenas.lista = cenas.lista.filter(c => c.id !== body.id)
          if (cenas.ativa === body.id) { cenas.ativa = 'principal'; emit('tela', estadoDaTela()) }
          writeJson(cenasFile, cenas)
        }
        return json(res, { ok: true, ...cenas })
      }
      return json(res, { ...cenas, campos: widgetFields('telas'), padroes: widgetDefaults('telas') })
    }
    if (p === '/api/widgets') {
      return json(res, Object.entries(WIDGETS).map(([id, w]) => ({ id, name: w.name, url: `/overlay/${id}` })))
    }
    const wf = p.match(/^\/api\/widget\/(\w+)\/(fields|config)$/)
    if (wf && WIDGETS[wf[1]]) {
      const id = wf[1]
      if (wf[2] === 'fields') return json(res, widgetFields(id))
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        writeJson(path.join(CONFIG_DIR, `${id}.json`), body)
        broadcast({ kind: 'reload', widget: id })
        return json(res, { ok: true })
      }
      if (req.method === 'DELETE') {
        try { fs.unlinkSync(path.join(CONFIG_DIR, `${id}.json`)) } catch (e) {}
        broadcast({ kind: 'reload', widget: id })
        return json(res, { ok: true })
      }
      return json(res, { defaults: widgetDefaults(id), values: widgetConfig(id) })
    }
    if (p === '/api/test' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      if (body.listener) emit(body.listener, body.event || {})
      return json(res, { ok: true })
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const name = String(url.searchParams.get('name') || 'som').replace(/[^\w.\-() ]/g, '_')
      const data = await readBody(req)
      const file = path.join(SOUNDS_DIR, `${Date.now()}_${name}`)
      fs.writeFileSync(file, data)
      return json(res, { url: `/sounds/${encodeURIComponent(path.basename(file))}` })
    }

    send(res, 404, 'não encontrado', 'text/plain')
  } catch (err) {
    json(res, { error: err.message }, 500)
  }
})

const PORT = Number(process.env.PORT) || serverConfig.port || 8787
server.listen(PORT, HOST, () => {
  const k = OVERLAY_KEY ? `?key=${OVERLAY_KEY}` : ''
  console.log('')
  console.log('  Live Manager — servidor dos widgets')
  console.log(`  Configuração:   http://localhost:${PORT}/config${ADMIN_PASSWORD ? '  (com senha)' : ''}`)
  console.log(`  Dynamic Island: http://localhost:${PORT}/overlay/island${k}`)
  console.log(`  Cena completa:  http://localhost:${PORT}/overlay/cena${k}`)
  console.log('')
  startChat()
})
