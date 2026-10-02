/*
  Leitor do chat da Twitch por IRC anônimo (WebSocket), sem login.
  Entrega mensagens (com emotes e cargos), bits, subs, presentes e raids,
  que a Twitch envia pelo próprio chat. Seguidores não passam por aqui
  (exigem autorização do dono do canal).
*/

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'

function parseTags(raw) {
  const tags = {}
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    const k = i < 0 ? part : part.slice(0, i)
    const v = i < 0 ? '' : part.slice(i + 1)
    tags[k] = v.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\')
  }
  return tags
}

function parseLine(line) {
  let rest = line
  let tags = {}
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ')
    tags = parseTags(rest.slice(1, sp))
    rest = rest.slice(sp + 1)
  }
  let prefix = ''
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ')
    prefix = rest.slice(1, sp)
    rest = rest.slice(sp + 1)
  }
  let trailing = ''
  const t = rest.indexOf(' :')
  if (t >= 0) {
    trailing = rest.slice(t + 2)
    rest = rest.slice(0, t)
  }
  const params = rest.split(' ').filter(Boolean)
  const command = params.shift() || ''
  return { tags, prefix, command, params, trailing }
}

function parseBadges(tag) {
  const badges = []
  for (const b of String(tag || '').split(',').filter(Boolean)) {
    const [type, version] = b.split('/')
    badges.push({ type, version: version || '1', url: '', description: type })
  }
  return badges
}

function emoteUrl(id, size) {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/${size}`
}

function parseEmotes(tag, text) {
  if (!tag) return []
  const chars = [...text] // posições da Twitch são por code point
  const emotes = []
  for (const group of tag.split('/')) {
    const [id, ranges] = group.split(':')
    if (!id || !ranges) continue
    for (const range of ranges.split(',')) {
      const [a, b] = range.split('-').map(Number)
      if (isNaN(a) || isNaN(b)) continue
      const name = chars.slice(a, b + 1).join('')
      emotes.push({
        type: 'twitch',
        name,
        id,
        gif: false,
        urls: { 1: emoteUrl(id, '1.0'), 2: emoteUrl(id, '2.0'), 4: emoteUrl(id, '3.0') },
        start: a,
        end: b,
      })
    }
  }
  return emotes.sort((x, y) => x.start - y.start)
}

function flagsFromBadges(badges) {
  const types = badges.map(b => b.type)
  return {
    isChatOwner: types.includes('broadcaster'),
    isChatModerator: types.includes('moderator'),
    isChatSponsor: types.includes('subscriber') || types.includes('founder'),
    isVerified: types.includes('partner'),
  }
}

/* avatar via DecAPI (público, sem token), com cache */
const avatarCache = new Map()
async function avatarOf(login) {
  const key = String(login || '').toLowerCase()
  if (!key) return null
  const hit = avatarCache.get(key)
  if (hit && hit.expire > Date.now()) return hit.url
  let url = null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(`https://decapi.me/twitch/avatar/${encodeURIComponent(key)}`, { signal: ctrl.signal })
    clearTimeout(timer)
    const text = res.ok ? (await res.text()).trim() : ''
    if (text.startsWith('http')) url = text
  } catch (e) {
    url = null
  }
  avatarCache.set(key, { url, expire: Date.now() + 60 * 60 * 1000 })
  return url
}

class TwitchChat {
  constructor({ onEvent, onStatus }) {
    this.onEvent = onEvent || (() => {})
    this.onStatus = onStatus || (() => {})
    this.ws = null
    this.running = false
    this.timer = null
    this.status = { platform: 'twitch', state: 'parado', channel: null, messages: 0, lastMessageAt: null, error: null }
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.status)
  }

  start(channel) {
    this.stop()
    this.channel = String(channel || '').trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/\/.*$/, '')
    if (!this.channel) return
    this.running = true
    this.setStatus({ state: 'conectando', channel: this.channel, error: null })
    this.connect()
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

  connect() {
    if (!this.running) return
    let ws
    try {
      ws = new WebSocket(IRC_URL)
    } catch (err) {
      return this.retry(err.message)
    }
    this.ws = ws
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`)
      ws.send(`JOIN #${this.channel}`)
    }
    ws.onmessage = e => {
      for (const line of String(e.data).split('\r\n')) {
        if (line) this.handle(line)
      }
    }
    ws.onerror = () => { /* onclose cuida da reconexão */ }
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

  send(line) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(line)
  }

  async handle(line) {
    if (line.startsWith('PING')) return this.send('PONG :tmi.twitch.tv')
    const msg = parseLine(line)
    const { tags, command, params, trailing } = msg

    if (command === '366') return this.setStatus({ state: 'conectado', error: null })
    if (command === 'RECONNECT') { try { this.ws.close() } catch (e) { /* ignora */ } return }
    if (command === 'NOTICE' && /login|authentication/i.test(trailing)) return this.retry(trailing)

    const base = () => {
      const login = tags.login || (msg.prefix.split('!')[0] || '')
      const name = tags['display-name'] || login
      const badges = parseBadges(tags.badges)
      return {
        id: tags.id || `${Date.now()}_${Math.random()}`,
        time: tags['tmi-sent-ts'] ? Number(tags['tmi-sent-ts']) : Date.now(),
        login,
        name,
        channelId: tags['user-id'] || login,
        color: tags.color || '',
        badges,
        flags: flagsFromBadges(badges),
      }
    }

    if (command === 'PRIVMSG') {
      const b = base()
      let text = trailing
      let isAction = false
      const m = text.match(/^\u0001ACTION (.*)\u0001$/)
      if (m) { text = m[1]; isAction = true }
      const emotes = parseEmotes(tags.emotes, text)
      const avatar = await avatarOf(b.login)
      this.setStatus({ messages: this.status.messages + 1, lastMessageAt: Date.now() })
      this.onEvent({ type: 'message', platform: 'twitch', ...b, text, isAction, emotes, avatar })
      const bits = Number(tags.bits || 0)
      if (bits > 0) this.onEvent({ type: 'cheer', platform: 'twitch', ...b, amount: bits, text, avatar })
      return
    }

    if (command === 'USERNOTICE') {
      const b = base()
      const kind = tags['msg-id'] || ''
      const avatar = await avatarOf(b.login)
      const months = Number(tags['msg-param-cumulative-months'] || tags['msg-param-months'] || 1)
      const tier = String(tags['msg-param-sub-plan'] || '')
      if (kind === 'sub' || kind === 'resub') {
        return this.onEvent({ type: 'sub', platform: 'twitch', ...b, months, tier, text: trailing, avatar, system: tags['system-msg'] || '' })
      }
      if (kind === 'subgift' || kind === 'anonsubgift') {
        const recipient = tags['msg-param-recipient-display-name'] || tags['msg-param-recipient-user-name'] || ''
        return this.onEvent({ type: 'subgift', platform: 'twitch', ...b, recipient, sender: kind === 'anonsubgift' ? 'Anônimo' : b.name, months: Number(tags['msg-param-gift-months'] || 1), tier, avatar })
      }
      if (kind === 'submysterygift' || kind === 'anonsubmysterygift') {
        return this.onEvent({ type: 'massgift', platform: 'twitch', ...b, count: Number(tags['msg-param-mass-gift-count'] || 1), sender: kind.startsWith('anon') ? 'Anônimo' : b.name, tier, avatar })
      }
      if (kind === 'raid') {
        return this.onEvent({ type: 'raid', platform: 'twitch', ...b, name: tags['msg-param-displayName'] || b.name, viewers: Number(tags['msg-param-viewerCount'] || 0), avatar })
      }
      return
    }

    if (command === 'CLEARMSG') {
      return this.onEvent({ type: 'delete-message', platform: 'twitch', msgId: tags['target-msg-id'] || '' })
    }
    if (command === 'CLEARCHAT' && params[1]) {
      return this.onEvent({ type: 'delete-messages', platform: 'twitch', userId: tags['target-user-id'] || '', login: trailing || params[1] })
    }
  }
}

module.exports = { TwitchChat, parseLine, parseEmotes, avatarOf }
