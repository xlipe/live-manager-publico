/*
  Leitor do chat ao vivo do YouTube.
  Usa o mesmo caminho interno que a página do chat do YouTube usa
  (youtubei/v1/live_chat/get_live_chat), sem API key própria e sem login.
  Entrega mensagens, Super Chats e novos membros em tempo quase real.
*/

const https = require('https')
const { URL } = require('url')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  Cookie: 'CONSENT=YES+cb; SOCS=CAI',
}

function request(url, { method = 'GET', body = null, headers = {} } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          ...BASE_HEADERS,
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
          ...headers,
        },
      },
      res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
          res.resume()
          const next = new URL(res.headers.location, url).toString()
          return resolve(request(next, { method, body, headers }, redirects + 1))
        }
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} em ${url}`))
          resolve({ status: res.statusCode, text, url })
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('timeout')))
    if (body) req.write(body)
    req.end()
  })
}

/* ---------- Descobrir a live ---------- */

function extractVideoId(input) {
  const s = String(input || '').trim()
  if (/^[\w-]{11}$/.test(s)) return s
  const m = s.match(/[?&]v=([\w-]{11})/) || s.match(/youtu\.be\/([\w-]{11})/) || s.match(/\/live\/([\w-]{11})/)
  return m ? m[1] : null
}

async function findLiveVideoId(target) {
  const direct = extractVideoId(target)
  if (direct) return direct

  let s = String(target || '').trim()
  if (!s) throw new Error('Informe o @ do canal, a URL do canal ou a URL da live.')
  if (!/^https?:/i.test(s)) {
    if (!s.startsWith('@')) s = '@' + s
    s = `https://www.youtube.com/${s}`
  }
  s = s.replace(/\/+$/, '')
  if (!/\/live$/.test(s)) s += '/live'

  // 1) /live com canônico: caminho rápido. Sem live no canal, o YouTube responde
  //    /live com uma live RECOMENDADA de outro canal (e de alguns IPs, como o da
  //    VPS, responde assim mesmo com o canal ao vivo). Por isso o canônico só
  //    vale se o dono do vídeo for o canal alvo.
  const { text } = await request(s)
  const canonical = text.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)
  const handle = handleOf(s) || (text.match(/"vanityChannelUrl":"http:\/\/www\.youtube\.com\/@([^"]+)"/) || [])[1]
  if (canonical && (!handle || (await videoBelongsTo(canonical[1], handle)))) return canonical[1]

  // 2) Aba "Ao vivo" do canal: só lista vídeos do próprio canal, lives no topo.
  //    Confirma cada candidato pela página do vídeo ("isLive":true só na live).
  const base = s.replace(/\/live$/, '')
  const { text: streams } = await request(`${base}/streams`)
  const ids = [...new Set([...streams.matchAll(/"videoId":"([\w-]{11})"/g)].map(m => m[1]))].slice(0, 4)
  for (const id of ids) {
    if (await isLiveNow(id)) return id
  }
  throw new Error('Não encontrei uma live ao vivo nesse canal agora.')
}

async function isLiveNow(videoId) {
  try {
    const { text } = await request(`https://www.youtube.com/watch?v=${videoId}`)
    return /"isLive":true|"isLiveNow":true/.test(text)
  } catch (e) {
    return false
  }
}

function handleOf(url) {
  const m = url.match(/youtube\.com\/@([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]) : null
}

// O oembed é público, sem chave, e devolve o canal do vídeo.
async function videoBelongsTo(videoId, handle) {
  try {
    const { text } = await request(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
    )
    const owner = handleOf(JSON.parse(text).author_url || '')
    if (!owner) return true // sem informação, não bloqueia
    return owner.toLowerCase() === handle.toLowerCase()
  } catch (e) {
    return true
  }
}

/* ---------- Contexto do chat ---------- */

function pickJson(text, marker) {
  const idx = text.indexOf(marker)
  if (idx < 0) return null
  let i = text.indexOf('{', idx)
  if (i < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let j = i; j < text.length; j++) {
    const ch = text[j]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(i, j + 1))
        } catch (e) {
          return null
        }
      }
    }
  }
  return null
}

function continuationOf(obj) {
  if (!obj) return null
  const c =
    obj.invalidationContinuationData ||
    obj.timedContinuationData ||
    obj.reloadContinuationData ||
    obj.liveChatReplayContinuationData
  return c ? { continuation: c.continuation, timeoutMs: c.timeoutMs || 2000 } : null
}

async function getChatContext(videoId) {
  const { text } = await request(`https://www.youtube.com/live_chat?v=${videoId}&is_popout=1`)
  const apiKey = (text.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1]
  const clientVersion = (text.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || [])[1] || '2.20240701.00.00'
  const data = pickJson(text, 'ytInitialData')
  if (!apiKey || !data) throw new Error('Não consegui ler a página do chat (o YouTube pode ter mudado o formato).')

  const lcr = data.contents && data.contents.liveChatRenderer
  if (!lcr) throw new Error('Esta live não tem chat disponível (chat desativado ou live encerrada).')

  // prefere "Chat ao vivo" (todas as mensagens) em vez de "Principais mensagens"
  let cont = null
  try {
    const items = lcr.header.liveChatHeaderRenderer.viewSelector.sortFilterSubMenuRenderer.subMenuItems
    const all = items.find(i => !i.selected) || items[items.length - 1]
    cont = continuationOf(all.continuation)
  } catch (e) {
    cont = null
  }
  if (!cont) cont = continuationOf(lcr.continuations && lcr.continuations[0])
  if (!cont) throw new Error('Sem continuação de chat na página.')

  return { apiKey, clientVersion, continuation: cont.continuation, timeoutMs: cont.timeoutMs }
}

/* ---------- Parse dos itens ---------- */

function thumb(thumbs) {
  if (!Array.isArray(thumbs) || !thumbs.length) return null
  return thumbs[thumbs.length - 1].url
}

function runsToMessage(runs = []) {
  let text = ''
  const emotes = []
  for (const run of runs) {
    if (run.text != null) {
      text += run.text
      continue
    }
    if (run.emoji) {
      const e = run.emoji
      const shortcut = (e.shortcuts && e.shortcuts[0]) || e.emojiId || ''
      if (!e.isCustomEmoji && e.emojiId && e.emojiId.length <= 4) {
        text += e.emojiId // emoji padrão: usa o próprio caractere
        continue
      }
      const url = thumb(e.image && e.image.thumbnails)
      const start = text.length
      text += shortcut
      if (url) {
        emotes.push({
          type: 'youtube',
          name: shortcut,
          id: e.emojiId,
          gif: false,
          urls: { 1: url, 2: url, 4: url },
          start,
          end: text.length,
        })
      }
    }
  }
  return { text, emotes }
}

function parseBadges(renderer) {
  const badges = []
  const flags = { isChatOwner: false, isChatModerator: false, isChatSponsor: false, isVerified: false }
  for (const b of renderer.authorBadges || []) {
    const r = b.liveChatAuthorBadgeRenderer
    if (!r) continue
    const tip = r.tooltip || ''
    const iconType = r.icon && r.icon.iconType
    if (iconType === 'MODERATOR') {
      flags.isChatModerator = true
      badges.push({ type: 'moderator', version: '1', url: '', description: tip })
    } else if (iconType === 'OWNER') {
      flags.isChatOwner = true
      badges.push({ type: 'owner', version: '1', url: '', description: tip })
    } else if (iconType === 'VERIFIED') {
      flags.isVerified = true
      badges.push({ type: 'verified', version: '1', url: '', description: tip })
    } else if (r.customThumbnail) {
      flags.isChatSponsor = true
      badges.push({ type: 'member', version: '1', url: thumb(r.customThumbnail.thumbnails) || '', description: tip })
    }
  }
  return { badges, flags }
}

function baseAuthor(r) {
  return {
    name: (r.authorName && r.authorName.simpleText) || '',
    channelId: r.authorExternalChannelId || '',
    avatar: thumb(r.authorPhoto && r.authorPhoto.thumbnails),
    time: r.timestampUsec ? Math.floor(Number(r.timestampUsec) / 1000) : Date.now(),
    id: r.id || `${Date.now()}_${Math.random()}`,
  }
}

function parseAmount(text) {
  const s = String(text || '')
  const currency = (s.match(/^[^\d\s]+/) || [''])[0].trim() || (s.match(/[A-Z]{3}/) || [''])[0]
  let n = s.replace(/[^\d,.]/g, '')
  if (n.includes(',') && n.includes('.')) n = n.replace(/\./g, '').replace(',', '.')
  else if (n.includes(',')) n = n.replace(',', '.')
  return { amount: Number(n) || 0, currency: currency || '' }
}

function parseAction(action) {
  const add = action.addChatItemAction
  if (!add || !add.item) return null
  const item = add.item

  if (item.liveChatTextMessageRenderer) {
    const r = item.liveChatTextMessageRenderer
    const { text, emotes } = runsToMessage(r.message && r.message.runs)
    const { badges, flags } = parseBadges(r)
    return { type: 'message', ...baseAuthor(r), text, emotes, badges, flags }
  }

  if (item.liveChatPaidMessageRenderer || item.liveChatPaidStickerRenderer) {
    const r = item.liveChatPaidMessageRenderer || item.liveChatPaidStickerRenderer
    const { text, emotes } = runsToMessage(r.message && r.message.runs)
    const { badges, flags } = parseBadges(r)
    const amountText = (r.purchaseAmountText && r.purchaseAmountText.simpleText) || ''
    return { type: 'superchat', ...baseAuthor(r), text, emotes, badges, flags, amountText, ...parseAmount(amountText) }
  }

  if (item.liveChatMembershipItemRenderer) {
    const r = item.liveChatMembershipItemRenderer
    const header =
      (r.headerPrimaryText && r.headerPrimaryText.runs && r.headerPrimaryText.runs.map(x => x.text).join('')) ||
      (r.headerSubtext && (r.headerSubtext.simpleText || (r.headerSubtext.runs || []).map(x => x.text).join(''))) ||
      ''
    const { text, emotes } = runsToMessage(r.message && r.message.runs)
    const { badges, flags } = parseBadges(r)
    // "Novo membro" vs. marco de meses: se o cabeçalho cita meses, é renovação
    const months = (header.match(/(\d+)\s*m/) || [])[1]
    return { type: 'membership', ...baseAuthor(r), text, emotes, badges, flags, header, months: months ? Number(months) : 0 }
  }

  if (item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer) {
    const r = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer
    const h = r.header && r.header.liveChatSponsorshipsHeaderRenderer
    if (!h) return null
    const name = (h.authorName && h.authorName.simpleText) || ''
    const primary = (h.primaryText && h.primaryText.runs && h.primaryText.runs.map(x => x.text).join('')) || ''
    const count = (primary.match(/(\d+)/) || [])[1]
    return {
      type: 'giftmembership',
      id: r.id || `${Date.now()}`,
      time: r.timestampUsec ? Math.floor(Number(r.timestampUsec) / 1000) : Date.now(),
      name,
      avatar: thumb(h.authorPhoto && h.authorPhoto.thumbnails),
      count: count ? Number(count) : 1,
      text: primary,
    }
  }

  return null
}

/* ---------- Cliente ---------- */

class YouTubeChat {
  constructor({ onEvent, onStatus }) {
    this.onEvent = onEvent || (() => {})
    this.onStatus = onStatus || (() => {})
    this.running = false
    this.timer = null
    this.status = { state: 'parado', videoId: null, messages: 0, lastMessageAt: null, error: null }
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.status)
  }

  async start(target) {
    this.stop()
    this.running = true
    this.target = target
    this.setStatus({ state: 'procurando live', error: null, videoId: null })
    this.loop()
  }

  stop() {
    this.running = false
    clearTimeout(this.timer)
    this.timer = null
    this.setStatus({ state: 'parado' })
  }

  schedule(fn, ms) {
    clearTimeout(this.timer)
    this.timer = setTimeout(fn, ms)
  }

  async loop() {
    if (!this.running) return
    try {
      const videoId = await findLiveVideoId(this.target)
      this.lastCheck = Date.now()
      this.setStatus({ videoId, state: 'conectando ao chat' })
      this.ctx = await getChatContext(videoId)
      this.setStatus({ state: 'conectado', error: null })
      this.poll()
    } catch (err) {
      this.setStatus({ state: 'aguardando live', error: err.message })
      this.schedule(() => this.loop(), 20000)
    }
  }

  async poll() {
    if (!this.running) return
    try {
      const body = JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: this.ctx.clientVersion, hl: 'pt', gl: 'BR' } },
        continuation: this.ctx.continuation,
      })
      const { text } = await request(
        `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${this.ctx.apiKey}&prettyPrint=false`,
        { method: 'POST', body, headers: { 'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': this.ctx.clientVersion } },
      )
      const json = JSON.parse(text)
      const lcc = json.continuationContents && json.continuationContents.liveChatContinuation
      if (!lcc) {
        // chat encerrado ou continuação inválida: recomeça do zero
        this.setStatus({ state: 'chat encerrado, procurando de novo' })
        return this.schedule(() => this.loop(), 15000)
      }
      for (const action of lcc.actions || []) {
        const ev = parseAction(action)
        if (ev) {
          this.setStatus({ messages: this.status.messages + 1, lastMessageAt: Date.now() })
          this.onEvent(ev)
        }
      }
      const next = continuationOf(lcc.continuations && lcc.continuations[0])
      if (!next) return this.schedule(() => this.loop(), 15000)
      this.ctx.continuation = next.continuation

      // De minuto em minuto confere se o canal está em OUTRA live (a antiga
      // acabou e outra começou, ou o alvo foi corrigido). Se mudou, reconecta.
      if (!extractVideoId(this.target) && Date.now() - (this.lastCheck || 0) > 60000) {
        this.lastCheck = Date.now()
        findLiveVideoId(this.target)
          .then(id => {
            if (this.running && id && id !== this.status.videoId) {
              this.setStatus({ state: 'canal mudou de live, reconectando' })
              this.schedule(() => this.loop(), 0)
            }
          })
          .catch(() => {})
      }
      const wait = Math.min(Math.max(next.timeoutMs || 1500, 800), 8000)
      this.schedule(() => this.poll(), wait)
    } catch (err) {
      this.setStatus({ state: 'erro, tentando de novo', error: err.message })
      this.schedule(() => this.loop(), 8000)
    }
  }
}

module.exports = { YouTubeChat, findLiveVideoId }
