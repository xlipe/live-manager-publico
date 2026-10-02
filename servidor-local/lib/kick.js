/*
  Leitor do chat do Kick, sem login.
  Descobre a sala de chat pela API pública do canal e assina o socket
  (Pusher) que o próprio site do Kick usa. Entrega mensagens (com emotes e
  cargos), novas assinaturas, presentes e hosts.
*/

const https = require('https')

const PUSHER_URL = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=7.6.0&flash=false'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/* A proteção do Kick (Cloudflare) devolve 403 para o fetch do Node, mas aceita
   o módulo https. Por isso a chamada é feita com https.request. */
function getJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' } }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} em ${url}`))
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (e) {
          reject(new Error('resposta inválida do Kick'))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
    req.end()
  })
}

async function channelInfo(slug) {
  const data = await getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`)
  if (!data || !data.chatroom || !data.chatroom.id) throw new Error('Canal do Kick não encontrado ou sem chat.')
  return {
    id: data.id,
    slug: data.slug || slug,
    chatroomId: data.chatroom.id,
    username: data.user && data.user.username,
    avatar: data.user && data.user.profile_pic,
    live: !!data.livestream,
  }
}

/* avatar do remetente pela API pública, com cache */
const avatarCache = new Map()
async function avatarOf(slug) {
  const key = String(slug || '').toLowerCase()
  if (!key) return null
  const hit = avatarCache.get(key)
  if (hit && hit.expire > Date.now()) return hit.url
  let url = null
  try {
    const data = await getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(key)}`, 2500)
    url = (data && data.user && data.user.profile_pic) || null
  } catch (e) {
    url = null
  }
  avatarCache.set(key, { url, expire: Date.now() + 60 * 60 * 1000 })
  return url
}

/* [emote:37226:KEKW] -> texto "KEKW" + entrada de emote */
function parseContent(content) {
  let text = ''
  const emotes = []
  const re = /\[emote:(\d+):([^\]]+)\]/g
  let last = 0
  let m
  while ((m = re.exec(content))) {
    text += content.slice(last, m.index)
    const start = text.length
    text += m[2]
    const url = `https://files.kick.com/emotes/${m[1]}/fullsize`
    emotes.push({ type: 'kick', name: m[2], id: m[1], gif: false, urls: { 1: url, 2: url, 4: url }, start, end: text.length - 1 })
    last = re.lastIndex
  }
  text += content.slice(last)
  return { text, emotes }
}

function parseBadges(identity) {
  const badges = []
  for (const b of (identity && identity.badges) || []) {
    if (!b || !b.type) continue
    badges.push({ type: String(b.type), version: String(b.count || '1'), url: '', description: b.text || b.type })
  }
  return badges
}

function flagsFromBadges(badges) {
  const types = badges.map(b => b.type)
  return {
    isChatOwner: types.includes('broadcaster'),
    isChatModerator: types.includes('moderator'),
    isChatSponsor: types.includes('subscriber') || types.includes('founder'),
    isVerified: types.includes('verified'),
  }
}

class KickChat {
  constructor({ onEvent, onStatus }) {
    this.onEvent = onEvent || (() => {})
    this.onStatus = onStatus || (() => {})
    this.ws = null
    this.running = false
    this.timer = null
    this.status = { platform: 'kick', state: 'parado', channel: null, messages: 0, lastMessageAt: null, error: null }
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.status)
  }

  start(channel) {
    this.stop()
    this.slug = String(channel || '').trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\/(www\.)?kick\.com\//, '').replace(/\/.*$/, '')
    if (!this.slug) return
    this.running = true
    this.setStatus({ state: 'procurando canal', channel: this.slug, error: null })
    this.resolve()
  }

  stop() {
    this.running = false
    clearTimeout(this.timer)
    if (this.ws) {
      try { this.ws.close() } catch (e) { /* ignora */ }
      this.ws = null
    }
    this.setStatus({ state: 'parado' })
  }

  async resolve() {
    if (!this.running) return
    try {
      this.info = await channelInfo(this.slug)
      this.setStatus({ state: 'conectando' })
      this.connect()
    } catch (err) {
      this.setStatus({ state: 'erro ao achar o canal', error: err.message })
      this.timer = setTimeout(() => this.resolve(), 20000)
    }
  }

  connect() {
    if (!this.running) return
    let ws
    try {
      ws = new WebSocket(PUSHER_URL)
    } catch (err) {
      return this.retry(err.message)
    }
    this.ws = ws
    ws.onmessage = e => this.handle(e.data)
    ws.onerror = () => { /* onclose cuida */ }
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      if (this.running) this.retry('conexão fechada')
    }
  }

  retry(reason) {
    this.setStatus({ state: 'reconectando', error: reason })
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.connect(), 5000)
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj))
  }

  async handle(raw) {
    let msg
    try { msg = JSON.parse(raw) } catch (e) { return }
    const { event } = msg
    let data = msg.data
    if (typeof data === 'string') { try { data = JSON.parse(data) } catch (e) { data = {} } }

    if (event === 'pusher:connection_established') {
      this.send({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${this.info.chatroomId}.v2` } })
      this.send({ event: 'pusher:subscribe', data: { auth: '', channel: `channel.${this.info.id}` } })
      return
    }
    if (event === 'pusher_internal:subscription_succeeded') return this.setStatus({ state: 'conectado', error: null })
    if (event === 'pusher:ping') return this.send({ event: 'pusher:pong', data: {} })
    if (event === 'pusher:error') return this.retry(String((data && data.message) || 'erro do socket'))

    const name = event.replace(/^App\\Events\\/, '')

    if (name === 'ChatMessageEvent') {
      const s = data.sender || {}
      const badges = parseBadges(s.identity)
      const { text, emotes } = parseContent(String(data.content || ''))
      const avatar = await avatarOf(s.slug || s.username)
      this.setStatus({ messages: this.status.messages + 1, lastMessageAt: Date.now() })
      return this.onEvent({
        type: 'message',
        platform: 'kick',
        id: data.id || `${Date.now()}_${Math.random()}`,
        time: data.created_at ? Date.parse(data.created_at) || Date.now() : Date.now(),
        login: s.slug || String(s.username || '').toLowerCase(),
        name: s.username || s.slug || '',
        channelId: String(s.id || s.slug || ''),
        color: (s.identity && s.identity.color) || '',
        badges,
        flags: flagsFromBadges(badges),
        text,
        emotes,
        avatar,
      })
    }

    if (name === 'SubscriptionEvent') {
      const login = String(data.username || '').toLowerCase()
      return this.onEvent({ type: 'sub', platform: 'kick', id: `${Date.now()}`, time: Date.now(), login, name: data.username || '', channelId: login, months: Number(data.months || 1), text: '', avatar: await avatarOf(login) })
    }

    if (name === 'GiftedSubscriptionsEvent') {
      const sender = data.gifter_username || 'Anônimo'
      const list = Array.isArray(data.gifted_usernames) ? data.gifted_usernames : []
      return this.onEvent({ type: 'massgift', platform: 'kick', id: `${Date.now()}`, time: Date.now(), login: sender.toLowerCase(), name: sender, channelId: sender.toLowerCase(), sender, count: list.length || 1, recipients: list, avatar: await avatarOf(sender) })
    }

    if (name === 'StreamHostEvent') {
      const host = data.host_username || ''
      return this.onEvent({ type: 'raid', platform: 'kick', id: `${Date.now()}`, time: Date.now(), login: host.toLowerCase(), name: host, channelId: host.toLowerCase(), viewers: Number(data.number_viewers || 0), avatar: await avatarOf(host) })
    }

    if (name === 'MessageDeletedEvent') {
      return this.onEvent({ type: 'delete-message', platform: 'kick', msgId: (data.message && data.message.id) || data.id || '' })
    }
    if (name === 'UserBannedEvent') {
      const u = data.user || {}
      return this.onEvent({ type: 'delete-messages', platform: 'kick', userId: String(u.id || u.slug || ''), login: u.slug || '' })
    }
  }
}

module.exports = { KickChat, channelInfo, parseContent }
