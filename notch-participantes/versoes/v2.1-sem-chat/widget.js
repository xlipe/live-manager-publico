/* =========================================================
   Dynamic Island — StreamElements Custom Widget
   - Estado compacto: avatares de quem falou no chat recentemente
   - Estado expandido: alertas do canal (inscrição, membro, Super Chat,
     doação, seguidor, bits, raid) com som e fila
   Funciona com YouTube e Twitch.
   ========================================================= */

let F = {}
const State = {
  users: new Map(), // userId -> { id, el, name, lastSeen, role }
  loadedAt: 0,
  announceTimer: null,
  expireTimer: null,
  avatarCache: {},
  ignoreUsers: [],
  ignorePrefixes: [],
  alertQueue: [],
  alerting: false,
  alertTimer: null,
  soundCache: {},
  warmAudio: null,
}

const PALETTE = [
  '#FF4A80', '#FF7070', '#FA8E4B', '#F5C518', '#3DDC84',
  '#00D1C1', '#00BBF9', '#4371FB', '#9B5DE5', '#F670DD',
]

const ICONS = {
  owner:
    'M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z',
  mod:
    'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  member:
    'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  bell:
    'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  heart:
    'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  money:
    'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z',
  star:
    'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  gem:
    'M12 2L2 9l10 13 10-13-10-7zm0 3.3L17.6 9H6.4L12 5.3zM7 11h10l-5 6.5L7 11z',
  raid:
    'M13 2L3 14h7v8l10-12h-7l0-8z',
}

const ROLE_SYNONYMS = {
  owner: ['broadcaster', 'owner', 'streamer', 'host', 'channel_owner'],
  mod: ['moderator', 'mod'],
  member: ['subscriber', 'founder', 'sponsor', 'member', 'membership', 'sub'],
}

/* Tipos de alerta: listener do StreamElements -> chave dos campos */
const ALERT_TYPES = {
  'subscriber-latest': { key: 'sub', icon: 'bell' },
  'sponsor-latest': { key: 'member', icon: 'star' },
  'superchat-latest': { key: 'superchat', icon: 'money' },
  'tip-latest': { key: 'tip', icon: 'money' },
  'follower-latest': { key: 'follow', icon: 'heart' },
  'cheer-latest': { key: 'cheer', icon: 'gem' },
  'raid-latest': { key: 'raid', icon: 'raid' },
}

/* ---------- Utilidades ---------- */

const $id = id => document.getElementById(id)

function list(str) {
  return String(str || '')
    .split(/[\n,;]+/)
    .map(s => s.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
}

function bool(v) {
  return v === true || v === 'true'
}

function num(v, fallback) {
  const n = Number(v)
  return isNaN(n) ? fallback : n
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function colorFor(name) {
  const sum = String(name || '')
    .split('')
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return PALETTE[sum % PALETTE.length]
}

function initialOf(name) {
  const clean = String(name || '?').replace(/^@/, '').trim()
  const first = [...clean][0] || '?'
  return first.toUpperCase()
}

function icon(name) {
  const path = ICONS[name]
  if (!path) return ''
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`
}

function fill(template, vars) {
  return escapeHtml(template).replace(/\{(\w+)\}/g, (m, key) =>
    key in vars ? escapeHtml(vars[key]) : '',
  )
}

/* ---------- Cargo ---------- */

function getRole(data = {}) {
  const roles = new Set()
  for (const badge of data.badges || []) {
    const type = String((badge && badge.type) || badge || '').toLowerCase()
    for (const [role, synonyms] of Object.entries(ROLE_SYNONYMS)) {
      if (synonyms.includes(type)) roles.add(role)
    }
  }
  const author = data.author || {}
  if (author.isChatOwner) roles.add('owner')
  if (author.isChatModerator) roles.add('mod')
  if (author.isChatSponsor) roles.add('member')
  const tags = data.tags || {}
  if (tags.mod === '1' || tags.mod === true) roles.add('mod')
  if (tags.subscriber === '1' || tags.subscriber === true) roles.add('member')
  if (typeof tags.badges === 'string' && tags.badges.includes('broadcaster'))
    roles.add('owner')

  if (roles.has('owner')) return 'owner'
  if (roles.has('mod')) return 'mod'
  if (roles.has('member')) return 'member'
  return 'viewer'
}

/* ---------- Avatar ---------- */

function directAvatar(data = {}) {
  const author = data.author || {}
  const tags = data.tags || {}
  return (
    data.avatar ||
    data.profileImage ||
    data.profileImageUrl ||
    author.profileImageUrl ||
    author.avatar ||
    tags.avatar ||
    null
  )
}

async function resolveAvatar(data, service) {
  const direct = directAvatar(data)
  if (direct) return direct

  const nick = String(data.nick || data.displayName || data.name || '').toLowerCase()
  const key = `${service}:${nick}`
  if (State.avatarCache[key] !== undefined) return State.avatarCache[key]

  let url = null
  if (service === 'twitch' && nick) {
    try {
      const res = await fetch(`https://decapi.me/twitch/avatar/${nick}`)
      const text = res.ok ? (await res.text()).trim() : ''
      if (text.startsWith('http')) url = text
    } catch (e) {
      url = null
    }
  }
  State.avatarCache[key] = url
  return url
}

/* ---------- Inicialização ---------- */

window.addEventListener('onWidgetLoad', obj => {
  F = obj.detail.fieldData || {}
  State.loadedAt = Date.now()
  State.service = (obj.detail.channel && obj.detail.channel.providerId) ? '' : ''
  State.ignoreUsers = list(F.ignoreUserList)
  State.ignorePrefixes = String(F.ignorePrefixList || '')
    .split(/[,;]+/)
    .map(s => s.trim())
    .filter(Boolean)

  clearInterval(State.expireTimer)
  State.expireTimer = setInterval(expireInactive, 5000)

  preloadSounds()
  if (bool(F.keepAudioWarm)) keepAudioWarm()
  // no editor do StreamElements o navegador exige um clique antes do áudio
  document.addEventListener('click', () => audioContext(), { once: true })

  render()

  if (bool(F.previewMode)) {
    sendTestMessages(4, 700)
    setTimeout(() => testAlert('sub'), 4200)
  }
})

window.addEventListener('onEventReceived', obj => {
  const { listener, event } = obj.detail
  if (listener === 'message') return onMessage(event)
  if (listener === 'event:test') return onButton(event)
  if (ALERT_TYPES[listener]) return onAlertEvent(listener, event)
})

function onButton(event) {
  if (event.listener !== 'widget-button') return
  if (event.value !== 'notch_participantes') return
  switch (event.field) {
    case 'testMessageButton':
      return sendTestMessages(1)
    case 'clearButton':
      return clearAll()
    case 'testSubButton':
      return testAlert('sub')
    case 'testMemberButton':
      return testAlert('member')
    case 'testSuperchatButton':
      return testAlert('superchat')
    case 'testTipButton':
      return testAlert('tip')
    default:
      return
  }
}

/* ---------- Mensagens do chat ---------- */

function isBacklog(data) {
  if (!bool(F.ignoreBacklog)) return false
  const time = Number(data.time)
  if (time && !isNaN(time)) return time < State.loadedAt - 2000
  return Date.now() - State.loadedAt < 3000
}

function onMessage(event, isTest = false) {
  const data = event.data || {}
  const service = event.service || ''
  const name = data.displayName || data.nick || ''
  const lower = name.toLowerCase().replace(/^@/, '')
  const text = String(data.text || '').trim()

  if (!name) return
  if (!isTest && isBacklog(data)) return
  if (State.ignoreUsers.includes(lower)) return
  if (State.ignorePrefixes.some(p => text.startsWith(p))) return

  const role = getRole(data)
  if (role === 'owner' && !bool(F.includeOwner)) return

  const id = String(data.userId || lower)
  const now = Date.now()
  const existing = State.users.get(id)

  if (existing) {
    existing.lastSeen = now
    existing.el.classList.remove('leaving')
    if (role !== existing.role) setRole(existing, role)
    bump(existing)
    if (bool(F.sortRecentFirst)) moveToFront(existing.el)
  } else {
    const user = { id, name, role, lastSeen: now, el: null }
    user.el = createAvatar(user)
    State.users.set(id, user)
    const container = $id('avatars')
    if (bool(F.sortRecentFirst)) container.prepend(user.el)
    else container.appendChild(user.el)
    trim()
    announce(name)
    resolveAvatar(data, service).then(url => {
      if (url && user.el && user.el.isConnected) setImage(user.el, url)
    })
  }

  render()
}

/* ---------- DOM dos participantes ---------- */

function createAvatar(user) {
  const el = document.createElement('div')
  el.className = `avatar role-${user.role}`
  el.dataset.userId = user.id
  el.title = user.name
  el.innerHTML = `
    <div class="pic" style="--letter-bg:${colorFor(user.name)}">
      <span>${escapeHtml(initialOf(user.name))}</span>
    </div>
    <div class="role-badge">${icon(user.role)}</div>
  `
  return el
}

function setRole(user, role) {
  user.el.classList.remove(`role-${user.role}`)
  user.role = role
  user.el.classList.add(`role-${role}`)
  user.el.querySelector('.role-badge').innerHTML = icon(role)
}

function setImage(el, url) {
  const pic = el.querySelector('.pic')
  const img = document.createElement('img')
  img.alt = ''
  img.referrerPolicy = 'no-referrer'
  img.onload = () => el.classList.add('has-img')
  img.onerror = () => img.remove()
  img.src = url
  pic.appendChild(img)
}

function bump(user) {
  const el = user.el
  el.classList.remove('bump')
  void el.offsetWidth // reinicia a animação
  el.classList.add('bump')
  el.addEventListener('animationend', () => el.classList.remove('bump'), {
    once: true,
  })
}

function moveToFront(el) {
  const container = $id('avatars')
  if (container.firstChild !== el) {
    el.style.animation = 'none'
    container.prepend(el)
    requestAnimationFrame(() => (el.style.animation = ''))
  }
}

function removeUser(user) {
  const el = user.el
  State.users.delete(user.id)
  if (!el) return
  el.classList.add('leaving')
  const done = () => {
    el.remove()
    render()
  }
  el.addEventListener('animationend', done, { once: true })
  setTimeout(done, 700)
}

function trim() {
  const max = Math.max(1, num(F.maxAvatars, 12))
  if (State.users.size <= max) return
  const sorted = [...State.users.values()].sort(
    (a, b) => a.lastSeen - b.lastSeen,
  )
  for (let i = 0; i < State.users.size - max; i++) removeUser(sorted[i])
}

function expireInactive() {
  const minutes = num(F.inactiveMinutes, 10)
  if (minutes <= 0) return
  const limit = Date.now() - minutes * 60 * 1000
  for (const user of [...State.users.values()]) {
    if (user.lastSeen < limit) removeUser(user)
  }
  render()
}

function clearAll() {
  for (const user of [...State.users.values()]) removeUser(user)
}

function announce(name) {
  if (!bool(F.announceNew)) return
  const el = $id('announce')
  el.innerHTML = fill(String(F.announceText || '{name} chegou'), {}).replace(
    /\{name\}/g,
    '',
  )
  // recoloca o nome com destaque
  el.innerHTML = escapeHtml(String(F.announceText || '{name} chegou')).replace(
    /\{name\}/g,
    `<span class="name">${escapeHtml(name)}</span>`,
  )
  el.classList.add('show')
  clearTimeout(State.announceTimer)
  State.announceTimer = setTimeout(
    () => el.classList.remove('show'),
    Math.max(1, num(F.announceSeconds, 3)) * 1000,
  )
}

function render() {
  const count = State.users.size
  const wrap = $id('wrap')
  wrap.classList.toggle('empty', count === 0)
  const label = String(F.countLabel || '').trim()
  $id('count').innerHTML =
    count === 0
      ? escapeHtml(F.emptyText || '')
      : `<b>${count}</b>${label ? ' ' + escapeHtml(label) : ''}`
}

/* ---------- Alertas (ilha expandida) ---------- */

function onAlertEvent(listener, event = {}) {
  const type = ALERT_TYPES[listener]
  if (!type) return
  if (!bool(F[`${type.key}Enabled`])) return

  // ignora eventos de sessão reenviados ao carregar (mesma regra do chat)
  if (bool(F.ignoreBacklog) && Date.now() - State.loadedAt < 3000 && !event.isTest) {
    return
  }

  const name = event.name || event.displayName || event.username || event.sender || ''
  if (!name) return

  const amount = event.amount ?? ''
  const vars = {
    name,
    amount: formatAmount(type.key, amount, event),
    months: amount,
    message: event.message || '',
    sender: event.sender || '',
    tier: event.tier || '',
  }

  let title = String(F[`${type.key}Title`] || '')
  let sub = String(F[`${type.key}Subtitle`] || '')
  if (type.key === 'sub' && event.gifted && event.sender) {
    title = String(F.subGiftTitle || title)
  }

  enqueueAlert({
    key: type.key,
    icon: type.icon,
    color: F[`${type.key}Color`] || F.accentColor,
    title: fill(title, vars),
    name,
    sub: buildSubtitle(sub, vars),
    avatar: event.avatar || null,
    lookup: { nick: name, name },
    service: event.service || guessService(listener),
  })
}

function guessService(listener) {
  if (listener === 'superchat-latest' || listener === 'sponsor-latest') return 'youtube'
  if (listener === 'cheer-latest' || listener === 'raid-latest') return 'twitch'
  return ''
}

function formatAmount(key, amount, event) {
  if (amount === '' || amount === null || amount === undefined) return ''
  if (key === 'superchat' || key === 'tip') {
    const n = Number(amount)
    const value = isNaN(n) ? String(amount) : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const symbol = event.currency || String(F.currencySymbol || 'R$')
    return `${symbol} ${value}`.trim()
  }
  return String(amount)
}

function buildSubtitle(template, vars) {
  const text = fill(template, vars).trim()
  if (bool(F.alertShowMessage) && vars.message) {
    const msg = escapeHtml(vars.message)
    return text ? `${text} · “${msg}”` : `“${msg}”`
  }
  return text
}

function enqueueAlert(alert) {
  const max = 6
  if (State.alertQueue.length >= max) State.alertQueue.shift()
  State.alertQueue.push(alert)
  if (!State.alerting) showNextAlert()
}

function showNextAlert() {
  const alert = State.alertQueue.shift()
  if (!alert) {
    State.alerting = false
    return
  }
  State.alerting = true

  const wrap = $id('wrap')
  wrap.style.setProperty('--alert-color', alert.color)
  $id('alertTitle').innerHTML = alert.title
  $id('alertName').textContent = alert.name
  $id('alertSub').innerHTML = alert.sub

  const av = $id('alertAvatar')
  av.className = 'alert-avatar'
  av.innerHTML = `
    <div class="pic" style="--letter-bg:${colorFor(alert.name)}">
      <span>${escapeHtml(initialOf(alert.name))}</span>
    </div>
    <div class="alert-icon">${icon(alert.icon)}</div>
  `
  if (alert.avatar) {
    setImage(av, alert.avatar)
  } else {
    resolveAvatar({ nick: alert.lookup.nick, displayName: alert.name }, alert.service).then(
      url => {
        if (url && State.alerting) setImage(av, url)
      },
    )
  }

  // força reinício das animações internas
  wrap.classList.remove('alerting')
  void wrap.offsetWidth
  wrap.classList.add('alerting')

  playSound(alert.key)

  const seconds = Math.max(2, num(F.alertDuration, 7))
  clearTimeout(State.alertTimer)
  State.alertTimer = setTimeout(() => {
    wrap.classList.remove('alerting')
    // espera a ilha encolher antes do próximo
    setTimeout(showNextAlert, 800)
  }, seconds * 1000)
}

/* ---------- Som ---------- */

function soundsFor(key) {
  const value = F[`${key}Sound`]
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value) return [value]
  return []
}

function preloadSounds() {
  State.soundCache = {}
  const keys = Object.values(ALERT_TYPES).map(t => t.key)
  for (const key of keys) {
    for (const url of soundsFor(key)) {
      if (State.soundCache[url]) continue
      const audio = new Audio()
      audio.preload = 'auto'
      audio.src = url
      audio.load()
      State.soundCache[url] = audio
    }
  }
}

function volume() {
  return Math.min(1, Math.max(0, num(F.alertVolume, 60) / 100))
}

function playSound(key) {
  const urls = soundsFor(key)
  if (urls.length) {
    const url = urls[Math.floor(Math.random() * urls.length)]
    const cached = State.soundCache[url]
    const audio = cached ? cached.cloneNode(true) : new Audio(url)
    audio.volume = volume()
    audio.play().catch(() => {})
    return
  }
  if ((F.defaultSound || 'chime') !== 'none') playChime(key)
}

/* Som embutido: pequenos "chimes" sintetizados, um perfil por tipo de alerta.
   Não depende de arquivo nenhum. */
const CHIMES = {
  sub:       { notes: [[523.25, 0], [783.99, .12], [1046.5, .24]], dur: .9,  wave: 'sine' },
  member:    { notes: [[659.25, 0], [830.61, .14], [987.77, .28], [1318.5, .42]], dur: 1.1, wave: 'triangle' },
  superchat: { notes: [[783.99, 0], [987.77, .1], [1174.7, .2], [1568, .3], [1568, .5]], dur: 1.3, wave: 'sine' },
  tip:       { notes: [[698.46, 0], [880, .12], [1108.7, .24], [1396.9, .36]], dur: 1.1, wave: 'sine' },
  follow:    { notes: [[880, 0], [1108.7, .1]], dur: .6, wave: 'sine' },
  cheer:     { notes: [[1046.5, 0], [1318.5, .08], [1568, .16]], dur: .8, wave: 'triangle' },
  raid:      { notes: [[392, 0], [523.25, .1], [659.25, .2], [783.99, .3], [1046.5, .4]], dur: 1.2, wave: 'sawtooth' },
}

function audioContext() {
  if (!State.ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    State.ctx = new Ctx()
  }
  if (State.ctx.state === 'suspended') State.ctx.resume().catch(() => {})
  return State.ctx
}

function playChime(key) {
  const ctx = audioContext()
  if (!ctx) return
  const chime = CHIMES[key] || CHIMES.sub
  const master = ctx.createGain()
  master.gain.value = volume() * 0.5
  master.connect(ctx.destination)

  const now = ctx.currentTime + 0.02
  for (const [freq, at] of chime.notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = chime.wave
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, now + at)
    gain.gain.linearRampToValueAtTime(1, now + at + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, now + at + chime.dur * 0.6)
    osc.connect(gain)
    gain.connect(master)
    osc.start(now + at)
    osc.stop(now + at + chime.dur * 0.6 + 0.05)

    // harmônico suave para dar brilho
    const shine = ctx.createOscillator()
    const shineGain = ctx.createGain()
    shine.type = 'sine'
    shine.frequency.value = freq * 2
    shineGain.gain.setValueAtTime(0, now + at)
    shineGain.gain.linearRampToValueAtTime(0.25, now + at + 0.01)
    shineGain.gain.exponentialRampToValueAtTime(0.001, now + at + chime.dur * 0.4)
    shine.connect(shineGain)
    shineGain.connect(master)
    shine.start(now + at)
    shine.stop(now + at + chime.dur * 0.4 + 0.05)
  }
}

// Mantém um áudio silencioso em loop para o dispositivo de saída não
// "dormir" e cortar o começo do próximo som (Windows/OBS).
function keepAudioWarm() {
  try {
    const sampleRate = 8000
    const dataLength = sampleRate * 2
    const buffer = new ArrayBuffer(44 + dataLength)
    const view = new DataView(buffer)
    const writeString = (offset, text) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
    }
    writeString(0, 'RIFF')
    view.setUint32(4, 36 + dataLength, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate, true)
    view.setUint16(32, 1, true)
    view.setUint16(34, 8, true)
    writeString(36, 'data')
    view.setUint32(40, dataLength, true)
    for (let i = 0; i < dataLength; i++) view.setUint8(44 + i, 128)
    const silent = new Audio(URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })))
    silent.loop = true
    silent.volume = 0.01
    State.warmAudio = silent
    const start = () => silent.play().catch(() => {})
    start()
    document.addEventListener('click', start, { once: true })
  } catch (e) {
    /* sem suporte: segue sem aquecimento */
  }
}

/* ---------- Teste ---------- */

const TEST_NAMES = [
  ['Carla', 'viewer'], ['Lucas', 'member'], ['Bia', 'viewer'],
  ['Rafa', 'mod'], ['Duda', 'viewer'], ['Pedro', 'member'],
  ['Nina', 'viewer'], ['Theo', 'owner'], ['Malu', 'viewer'],
]

function sendTestMessages(amount = 1, delay = 500) {
  for (let i = 0; i < amount; i++) {
    setTimeout(() => {
      const [name, role] = TEST_NAMES[Math.floor(Math.random() * TEST_NAMES.length)]
      const badges =
        role === 'mod' ? [{ type: 'moderator' }]
        : role === 'member' ? [{ type: 'sponsor' }]
        : role === 'owner' ? [{ type: 'owner' }]
        : []
      onMessage(
        {
          service: 'youtube',
          data: {
            userId: `teste_${name}`,
            displayName: name,
            nick: name.toLowerCase(),
            text: 'teste',
            badges,
            time: Date.now(),
          },
        },
        true,
      )
    }, i * delay)
  }
}

function testAlert(key) {
  const [name] = TEST_NAMES[Math.floor(Math.random() * TEST_NAMES.length)]
  const listener = Object.keys(ALERT_TYPES).find(l => ALERT_TYPES[l].key === key)
  const event = { name, isTest: true, message: 'Boa live! Vim pelo short.' }
  if (key === 'superchat' || key === 'tip') event.amount = 20
  if (key === 'member') event.amount = 3
  if (key === 'raid' || key === 'cheer') event.amount = 150
  onAlertEvent(listener, event)
}
