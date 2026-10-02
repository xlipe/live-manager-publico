/*
  Dynamic Chat Bubbles — cópia adaptada para YouTube
  Original: "Chat Bubbles" v2.11.0 por Zaytri (twitch.tv/zaytri, zaytri.com)
  Fonte usada: espelho github.com/TessavWalstijn/se.zaytri-widgets
  (o repositório original github.com/zaytri/stream-elements-widgets foi removido)

  Mudanças em relação ao original (procure por "[YT]" no código):
  - Detecção de dono / moderador / membro pelos dados que o StreamElements
    envia do YouTube (badges com nomes diferentes e flags do autor)
  - Mensagem "destacada" também por palavras-chave (o YouTube não tem
    o recurso de mensagem destacada da Twitch)
  - Fallback de URL de emote quando não existe o tamanho 4x
  - Proteção contra falha da API de pronomes (só funciona na Twitch)
  - Usuários de teste em português
*/

const DEFAULT_COLORS = [
  '#FF4A80',
  '#FF7070',
  '#FA8E4B',
  '#FEE440',
  '#5FFF77',
  '#00F5D4',
  '#00BBF9',
  '#4371FB',
  '#9B5DE5',
  '#F670DD',
]

let FieldData = {}
const Widget = {
  width: 0,
  height: 0,
  cooldown: false,
  raidActive: false,
  raidTimer: null,
  userMessageCount: {},
  soundEffects: [],
  messageCount: 0,
  pronouns: {},
  pronounsCache: {},
  channel: {},
  service: '',
  followCache: {},
  globalEmotes: {},
}

const PRONOUNS_API_BASE = 'https://pronouns.alejo.io/api'
const PRONOUNS_API = {
  user: username => `${PRONOUNS_API_BASE}/users/${username}`,
  pronouns: `${PRONOUNS_API_BASE}/pronouns`,
}

const DEC_API_BASE = 'https://decapi.me/twitch'
const DEC_API = {
  followedSeconds: username =>
    `${DEC_API_BASE}/followed/${Widget.channel.username}/${username}?format=U`,
}

const GLOBAL_EMOTES = {
  ffz: {
    api: 'https://api2.frankerfacez.com/v1/set/global',
    transformer: response => {
      const { default_sets, sets } = response
      const emoteNames = []
      for (const set of default_sets) {
        const { emoticons } = sets[set]
        for (const emote of emoticons) {
          emoteNames.push(emote.name)
        }
      }
      return emoteNames
    },
  },
  bttv: {
    api: 'https://api.betterttv.net/3/cached/emotes/global',
    transformer: response => {
      return response.map(emote => emote.code)
    },
  },
  '7tv': {
    api: 'https://api.7tv.app/v2/emotes/global',
    transformer: response => {
      return response.map(emote => emote.name)
    },
  },
}

// [YT] Nomes de badge que cada plataforma usa para o mesmo "cargo".
// O código original só conhecia os nomes da Twitch.
const ROLE_SYNONYMS = {
  broadcaster: ['broadcaster', 'owner', 'streamer', 'host', 'channel_owner'],
  moderator: ['moderator', 'mod'],
  subscriber: [
    'subscriber',
    'founder',
    'sponsor',
    'member',
    'membership',
    'sub',
  ],
  vip: ['vip', 'og'],
  verified: ['verified'],
}

// ---------------------------
//    Widget Initialization
// ---------------------------

window.addEventListener('onWidgetLoad', async obj => {
  Widget.channel = obj.detail.channel
  Widget.loadedAt = Date.now() // [YT] para ignorar o histórico reenviado
  loadFieldData(obj.detail.fieldData)
  loadGlobalEmotes()

  conditionalMainClass('dark-mode', FieldData.darkMode)
  conditionalMainClass(
    'custom-message-colors',
    FieldData.useCustomMessageColors,
  )
  conditionalMainClass('custom-border-colors', FieldData.useCustomBorderColors)
  conditionalMainClass(
    'custom-pronouns-badge-colors',
    FieldData.pronounsBadgeCustomColors,
  )

  if (FieldData.pronounsMode !== 'off') {
    await getPronouns()
  }

  preloadSounds() // [YT]
  if (FieldData.keepAudioWarm) keepAudioWarm() // [YT]

  if (FieldData.previewMode) sendTestMessage(5, 500)
})

// [YT] Pré-carrega todos os sons configurados para não cortar o início.
function preloadSounds() {
  Widget.soundCache = {}
  const urls = new Set()
  for (const group of Widget.soundEffects) {
    for (const url of group.soundEffects) urls.add(url)
  }
  for (const url of urls) {
    const audio = new Audio()
    audio.preload = 'auto'
    audio.src = url
    audio.load()
    Widget.soundCache[url] = audio
  }
}

// [YT] Devolve um elemento de áudio pronto para tocar (cópia do pré-carregado,
// para permitir sons sobrepostos sem reiniciar o anterior).
function getPreparedSound(url) {
  const cached = Widget.soundCache && Widget.soundCache[url]
  const audio = cached ? cached.cloneNode(true) : new Audio(url)
  audio.volume = Math.min(1, Math.max(0, parseInt(FieldData.volume) / 100))
  return audio
}

// [YT] Mantém um áudio silencioso em loop para o dispositivo de saída
// (Windows/OBS) não "dormir" e cortar o começo do próximo som.
function keepAudioWarm() {
  try {
    const sampleRate = 8000
    const seconds = 2
    const dataLength = sampleRate * seconds
    const buffer = new ArrayBuffer(44 + dataLength)
    const view = new DataView(buffer)
    const writeString = (offset, text) => {
      for (let i = 0; i < text.length; i++) {
        view.setUint8(offset + i, text.charCodeAt(i))
      }
    }
    writeString(0, 'RIFF')
    view.setUint32(4, 36 + dataLength, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate, true)
    view.setUint16(32, 1, true)
    view.setUint16(34, 8, true) // 8 bits
    writeString(36, 'data')
    view.setUint32(40, dataLength, true)
    // 8 bits: 128 = silêncio absoluto (o que mantém o dispositivo ativo é o
    // fluxo de áudio em reprodução, não o conteúdo)
    for (let i = 0; i < dataLength; i++) {
      view.setUint8(44 + i, 128)
    }
    const blob = new Blob([buffer], { type: 'audio/wav' })
    const silent = new Audio(URL.createObjectURL(blob))
    silent.loop = true
    silent.volume = 0.01
    Widget.warmAudio = silent
    const start = () => silent.play().catch(() => {})
    start()
    // no editor do StreamElements o navegador exige um clique antes do áudio
    document.addEventListener('click', start, { once: true })
  } catch (error) {
    // sem suporte: segue sem o aquecimento
  }
}

function loadFieldData(data) {
  FieldData = data

  const specificUsersSoundGroups = Array(10)
    .fill('specificUsersSoundGroup')
    .map((text, i) => `${text}${i + 1}`)
  processFieldData(
    value => stringToArray(value),
    'ignoreUserList',
    'ignorePrefixList',
    'allowUserList',
    'allowedStrings',
    'highlightKeywords', // [YT]
    ...specificUsersSoundGroups,
  )

  processFieldData(
    value => value === 'true',
    'ignoreBacklog', // [YT]
    'keepAudioWarm', // [YT]
    'includeEveryone',
    'includeSubs',
    'includeVIPs',
    'includeMods',
    'emoteOnly',
    'highlightOnly',
    'darkMode',
    'useCustomMessageColors',
    'useCustomBorderColors',
    'previewMode',
    'largeEmotes',
    'showBadges',
    'fixedWidth',
    'pronounsLowercase',
    'pronounsBadgeCustomColors',
    'includeFollowers',
    'ffzGlobal',
    'bttvGlobal',
    'topEdge',
    'bottomEdge',
    'leftEdge',
    'rightEdge',
  )

  const soundData = {}
  for (let i = 1; i <= 10; i++) {
    const group = FieldData[`soundGroup${i}`]
    const specificUsers = FieldData[`specificUsersSoundGroup${i}`]
    const isSpecific = specificUsers.length > 0
    // specific-index so multiple specifics don't override each other
    const userLevel = isSpecific
      ? `specific-${i}`
      : FieldData[`userLevelSoundGroup${i}`]
    const messageType = FieldData[`messageTypeSoundGroup${i}`]
    if (group && group.length > 0) {
      if (!soundData[userLevel]) {
        soundData[userLevel] = {}
      }

      if (isSpecific) {
        soundData[userLevel].users = specificUsers
      }

      if (!soundData[userLevel][messageType]) {
        soundData[userLevel][messageType] = []
      }

      soundData[userLevel][messageType].push(...group)
    }
  }

  Widget.soundEffects = Object.entries(soundData)
    .reduce((acc, entry) => {
      const [userLevel, { users, ...messageTypes }] = entry
      for (const [messageType, soundEffects] of Object.entries(messageTypes)) {
        acc.push({
          userLevel,
          messageType,
          soundEffects,
          users,
          order: soundSortOrder(userLevel, messageType),
        })
      }
      return [...acc]
    }, [])
    .sort(({ order: a }, { order: b }) => {
      // sort by userLevel (0) then by messageType (1)
      if (a[0] !== b[0]) return b[0] - a[0]
      else return b[1] - a[1]
    })
}

function processFieldData(process, ...keys) {
  for (const key of keys) {
    FieldData[key] = process(FieldData[key])
  }
}

function stringToArray(string = '', separator = ',') {
  return String(string ?? '')
    .split(separator)
    .reduce((acc, value) => {
      const trimmed = value.trim()
      if (trimmed !== '') acc.push(trimmed)
      return acc
    }, [])
}

function conditionalMainClass(className, condition = true) {
  const main = $('main')

  if (condition) main.addClass(className)
  else main.removeClass(className)
}

function soundSortOrder(userLevel, messageType) {
  return [userLevelSortOrder(userLevel), messageTypeSortOrder(messageType)]
}

function userLevelSortOrder(userLevel) {
  switch (userLevel) {
    case 'everyone':
      return 0
    case 'subs':
      return 100
    case 'vips':
      return 200
    case 'mods':
      return 300
    default:
      return 1000 // assume specific
  }
}

function messageTypeSortOrder(messageType) {
  switch (messageType) {
    case 'highlight':
      return 1000
    case 'action':
      return 500
    case 'default':
      return 100
    default:
      return 0 // assume all
  }
}

async function loadGlobalEmotes() {
  for (const [key, value] of Object.entries(GLOBAL_EMOTES)) {
    const { api, transformer } = value
    const response = await get(api)
    if (response != null) {
      try {
        Widget.globalEmotes[key] = transformer(response)
      } catch (error) {
        // [YT] API mudou de formato; ignora em vez de quebrar o widget
      }
    }
  }
}

// --------------------
//    Event Handlers
// --------------------

window.addEventListener('onEventReceived', obj => {
  const { listener, event } = obj.detail
  switch (listener) {
    case 'message':
      onMessage(event)
      break
    case 'raid-latest':
      onRaid(event)
      break
    case 'delete-message':
      deleteMessage(event.msgId)
      break
    case 'delete-messages':
      deleteMessages(event.userId)
      break
    case 'event:test':
      onButton(event)
      break
    default:
      return
  }
})

// ---------------------
//    Event Functions
// ---------------------

async function onMessage(event, testMessage = false) {
  const { service } = event
  Widget.service = service
  const {
    // facebook
    attachment,
    // trovo
    content_data,
    messageId,
    content,
    // general
    badges = [],
    userId = '',
    nick: username = '',
    displayName = '',
  } = event.data

  let { emotes = [], text = '', msgId = '', displayColor: color } = event.data

  let pronouns = null
  const allPronounKeys = Object.keys(Widget.pronouns)
  if (FieldData.pronounsMode !== 'off' && allPronounKeys.length > 0) {
    if (testMessage) {
      const randomPronounKey =
        allPronounKeys[random(0, allPronounKeys.length - 1)]
      pronouns = Widget.pronouns[randomPronounKey]
    } else if (service === 'twitch') {
      pronouns = await getUserPronoun(username)
    }
  }

  if (pronouns && FieldData.pronounsLowercase) {
    pronouns = pronouns.toLowerCase()
  }

  // handle facebook
  if (service === 'facebook' && attachment && attachment.type === 'sticker') {
    const { url, target } = attachment
    text = 'sticker'
    emotes.push({
      type: 'sticker',
      name: text,
      id: target.id,
      gif: false,
      urls: {
        1: url,
        2: url,
        4: url,
      },
      start: 0,
      end: text.length,
    })
  }

  // handle trovo
  if (service === 'trovo') {
    // remove messages from before the widget was loaded... idk why trovo sends these
    if (!content_data) return

    msgId = messageId
    text = content
    color = undefined
  }

  // [YT] badges "normalizadas" só para lógica de cargo (filtros e sons);
  // as badges originais continuam sendo usadas para desenhar os ícones
  const roleBadges = normalizeBadges(event.data)

  // Filters
  if (!testMessage && isBacklogMessage(event.data)) return
  if (FieldData.raidCooldown > 0 && !Widget.raidActive) return
  if (FieldData.raidCooldown < 0 && Widget.raidActive) return
  if (hasIgnoredPrefix(text)) return
  if (!passedMinMessageThreshold(userId)) return
  if (
    FieldData.allowUserList.length &&
    !userListIncludes(FieldData.allowUserList, displayName, username)
  )
    return
  if (userListIncludes(FieldData.ignoreUserList, displayName, username)) return

  const permittedUserLevel = await hasIncludedBadge(roleBadges, username)
  if (!permittedUserLevel) return
  if (
    FieldData.allowedStrings.length &&
    !FieldData.allowedStrings.includes(text)
  )
    return

  const messageType = getMessageType(event.data)
  if (FieldData.highlightOnly && messageType !== 'highlight') return

  const parsedText = parse(htmlEncode(text), emotes)
  const emoteSize = calcEmoteSize(parsedText)
  if (FieldData.emoteOnly && emoteSize === 1) return

  if (FieldData.messageCooldown) {
    if (Widget.cooldown) {
      return
    } else {
      Widget.cooldown = true
      window.setTimeout(() => {
        Widget.cooldown = false
      }, FieldData.messageCooldown * 1000)
    }
  }

  const elementData = {
    parsedText,
    name: displayName || username,
    emoteSize,
    messageType,
    msgId,
    userId,
    color,
    badges,
    roleBadges, // [YT]
    pronouns,
  }

  // Render Bubble
  if (FieldData.positionMode !== 'list') {
    $('main').append(BubbleComponent(elementData))
  } else {
    $('main').prepend(BubbleComponent(elementData))
  }
  const currentMessage = `.bubble[data-message-id="${msgId}"]`

  // Calcute Bubble Position
  window.setTimeout(_ => {
    const height = $(currentMessage).outerHeight()
    let maxWidth =
      FieldData.fixedWidth || FieldData.theme.includes('.css')
        ? FieldData.maxWidth
        : $(`${currentMessage} .message-wrapper`).width() + 1
    const minWidth = $(`${currentMessage} .username`).outerWidth()

    $(`${currentMessage} .message`).css({
      '--dynamicWidth': Math.max(minWidth, maxWidth),
    })

    if (FieldData.positionMode !== 'list') {
      // I'm not entirely sure why the + 30 is necessary,
      // but it makes the calculations work correctly
      let xMax = Math.max(minWidth, maxWidth) + 30

      if (FieldData.theme === 'animal-crossing') {
        xMax += 15 // due to margin-left 15 on .message
      }

      const { left, top, right, bottom } = calcPosition(xMax, height)

      window.setTimeout(_ => {
        $(currentMessage).css({ left, top, right, bottom })
      }, 300)
    }
  }, 300)

  // Get Sound
  let sound = null
  const soundUrls = getSound(username, displayName, roleBadges, messageType)
  if (soundUrls) {
    sound = getPreparedSound(soundUrls[random(0, soundUrls.length - 1)])
  }

  // Show Bubble and Play Sound
  window.setTimeout(_ => {
    Widget.messageCount++
    if (soundUrls) sound.play().catch(() => {})
    $(currentMessage).addClass('animate')
    $(currentMessage).addClass(FieldData.animation)
    if (FieldData.positionMode === 'list')
      $(currentMessage).css({ position: 'relative' })

    // Max message handling
    if (
      FieldData.maxMessages > 0 &&
      Widget.messageCount > FieldData.maxMessages
    ) {
      const oldestMsgId =
        FieldData.positionMode !== 'list'
          ? $('.bubble:not(.expired)').first().attr('data-message-id')
          : $('.bubble:not(.expired)').last().attr('data-message-id')
      const selector = `.bubble[data-message-id="${oldestMsgId}"]`

      $(selector).addClass('expired')
      $(selector).fadeOut('fast', _ => deleteMessage(oldestMsgId))
    }

    if (FieldData.lifetime > 0) {
      window.setTimeout(_ => {
        deleteMessage(msgId)
      }, FieldData.lifetime * 1000)
    }
  }, effectiveDelay() * 1000)
}

// [YT] O original obrigava 1s de atraso para calcular posição/tamanho.
// No modo Lista isso não é necessário, então 0 é permitido; nos modos
// aleatórios ainda precisa de ~0.7s (a posição é calculada em 600ms).
function effectiveDelay() {
  const wanted = Math.max(0, Number(FieldData.delay) || 0)
  const minimum = FieldData.positionMode === 'list' ? 0 : 0.7
  return Math.max(wanted, minimum)
}

function onRaid(event) {
  if (FieldData.raidCooldown === 0) return
  if (event.amount < FieldData.raidMin) return

  // Reset timer if another raid happens during an active raid timer
  clearTimeout(Widget.raidTimer)

  Widget.raidActive = true
  Widget.raidTimer = window.setTimeout(() => {
    Widget.raidActive = false
  }, Math.abs(FieldData.raidCooldown) * 1000)
}

function deleteMessage(msgId) {
  const messages = $(`.bubble[data-message-id="${msgId}"]`)
  Widget.messageCount -= messages.length
  messages.remove()
}

function deleteMessages(userId) {
  const messages = $(`.bubble[data-user-id="${userId}"]`)
  Widget.messageCount -= messages.length
  messages.remove()
}

function onButton(event) {
  const { listener, field, value } = event

  if (listener !== 'widget-button' || value !== 'zaytri_dynamicchatbubbles')
    return

  switch (field) {
    case 'testMessageButton':
      sendTestMessage()
      break
    default:
      return
  }
}

// [YT] usuários de teste: comum, moderador e membro
const TEST_USER_TYPES = [
  { name: 'Usuario', badges: [] },
  {
    name: 'Moderador',
    badges: [
      {
        type: 'moderator',
        url: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3',
      },
    ],
  },
  {
    name: 'Membro',
    badges: [
      {
        type: 'sponsor',
        url: 'https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/3',
      },
    ],
  },
]

function sendTestMessage(amount = 1, delay = 250) {
  for (let i = 0; i < amount; i++) {
    window.setTimeout(_ => {
      const userType = TEST_USER_TYPES[random(0, TEST_USER_TYPES.length - 1)]
      const name = `${userType.name}_${numbered.stringify(random(1, 10))}`
      const event = {
        service: 'youtube',
        data: {
          userId: name,
          tags: {},
          text: 'test',
          displayName: random(0, 1) ? name : name.toLowerCase(),
          nick: '',
          msgId: `${name}_${Date.now()}`,
          badges: userType.badges,
        },
      }

      const previewMessage = FieldData.previewMessage.trim()
      if (previewMessage !== '') {
        event.data.text = previewMessage
      } else {
        const [text, emotes] =
          TEST_MESSAGES[random(0, TEST_MESSAGES.length - 1)]
        event.data.text = text
        event.data.emotes = emotes
      }

      let messageType = 1
      switch (FieldData.previewType) {
        case 'random':
          messageType = random(1, 3)
          break
        case 'action':
          messageType = 2
          break
        case 'highlight':
          messageType = 3
          break
        default:
          messageType = 1
      }

      if (messageType === 2) {
        event.data.isAction = true
      } else if (messageType === 3) {
        event.data.tags['msg-id'] = 'highlighted-message'
      }
      onMessage(event, true)
    }, i * delay)
  }
}

// -------------------------
//    Component Functions
// -------------------------

function BubbleComponent(props) {
  const {
    parsedText,
    emoteSize,
    messageType,
    msgId,
    userId,
    color: userColor,
    badges,
    roleBadges = [],
    pronouns,
  } = props

  let { name } = props

  if (FieldData.pronounsMode === 'suffix' && pronouns) {
    name = `${name} (${pronouns})`
  }

  const color = userColor || generateColor(name)
  const tColor = tinycolor(color)
  const darkerColor = tinycolor
    .mix(
      FieldData.useCustomBorderColors ? FieldData.borderColor : color,
      'black',
      25,
    )
    .toString()

  // based on https://stackoverflow.com/a/69869976
  const isDark = tColor.getLuminance() < 0.4

  const parsedElements = parsedText.map(({ type, data }) => {
    switch (type) {
      case 'emote':
        return EmoteComponent(data)
      case 'text':
      default:
        return TextComponent(data)
    }
  })

  let containerClasses = [
    'bubble',
    `emote-${FieldData.largeEmotes ? emoteSize : 1}`,
  ]
  switch (messageType) {
    case 'highlight': {
      if (FieldData.highlightStyle === 'rainbow')
        containerClasses.push('highlight')
      break
    }
    case 'action': {
      if (FieldData.actionStyle === 'italics') containerClasses.push('action')
      break
    }
    default: // nothing
  }

  if (isDark && !FieldData.theme.includes('.css'))
    containerClasses.push('user-color-dark')

  // [YT] classes de cargo + efeito cintilante por cargo (tema Balão)
  const isOwner = hasBadge(roleBadges, 'broadcaster')
  const isModerator = hasBadge(roleBadges, 'moderator')
  const isMember = hasBadge(roleBadges, 'subscriber', 'founder')
  if (isOwner) containerClasses.push('role-owner')
  if (isModerator) containerClasses.push('role-mod')
  if (isMember) containerClasses.push('role-member')
  if (hasBadge(roleBadges, 'vip')) containerClasses.push('role-vip')

  const shineFor = FieldData.roleHighlight || 'none'
  const shineMods = shineFor === 'mods' || shineFor === 'mods-members'
  const shineMembers = shineFor === 'members' || shineFor === 'mods-members'
  if (
    (shineMods && (isModerator || isOwner)) ||
    (shineMembers && isMember)
  ) {
    containerClasses.push('shine')
  }

  let usernameChildren = []
  if (FieldData.showBadges) {
    // [YT] no tema Balão com "ícones próprios", desenha ícones brancos por cargo
    usernameChildren =
      FieldData.theme === 'bubble' && FieldData.bubbleBadgeStyle === 'icons'
        ? RoleIconsComponent({ isOwner, isModerator, isMember })
        : BadgesComponent(badges)
  }
  if (FieldData.pronounsMode === 'badge' && pronouns) {
    usernameChildren.push(PronounsBadgeComponent(pronouns))
  }
  usernameChildren.push(htmlEncode(name))

  const usernameProps = {}
  if (!FieldData.useCustomBorderColors && !FieldData.theme.includes('.css')) {
    usernameProps.style = {
      color: isDark
        ? tinycolor.mix(color, 'white', 85).toString()
        : tinycolor.mix(color, 'black', 85).toString(),
    }
  }

  const usernameBoxProps = {}
  if (FieldData.theme.includes('.css')) {
    usernameChildren.push(SpacerComponent())
    usernameChildren.push(
      Component('div', {
        class: 'title-bar-controls',
        children: [
          Component('button', { 'aria-label': 'Minimize' }),
          Component('button', { 'aria-label': 'Maximize' }),
          Component('button', { 'aria-label': 'Close' }),
        ],
      }),
    )
    containerClasses.push('window')
    usernameBoxProps.class = 'title-bar'
  }

  const bubbleChildren = [
    UsernameBoxComponent(
      UsernameComponent(usernameChildren, usernameProps),
      usernameBoxProps,
    ),
    MessageComponent(MessageWrapperComponent(parsedElements)),
  ]

  if (FieldData.theme === 'default') {
    bubbleChildren.unshift(BackgroundComponent())
  }

  return Component('section', {
    class: containerClasses,
    style: { '--userColor': color, '--darkerColor': darkerColor },
    'data-message-id': msgId,
    'data-user-id': userId,
    children: bubbleChildren,
  })
}

function BadgesComponent(badges) {
  // [YT] ignora badges sem imagem (algumas plataformas mandam só o tipo)
  return badges
    .filter(badge => badge && badge.url)
    .map(badge =>
      Component('img', { class: 'badge', src: badge.url, alt: badge.type }),
    )
}

// [YT] ícones de cargo em SVG (herdam a cor do texto do nick)
const ROLE_ICON_PATHS = {
  owner:
    'M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z',
  moderator:
    'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  member:
    'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
}

function RoleIconsComponent({ isOwner, isModerator, isMember }) {
  const roles = []
  if (isOwner) roles.push('owner')
  if (isModerator) roles.push('moderator')
  if (isMember) roles.push('member')
  return roles.map(
    role =>
      `<svg class="role-icon role-icon-${role}" viewBox="0 0 24 24" aria-label="${role}"><path fill="currentColor" d="${ROLE_ICON_PATHS[role]}"></path></svg>`,
  )
}

function TextComponent(text) {
  return Component('span', { class: 'text', children: text })
}

function EmoteComponent({ urls = {}, name }) {
  // [YT] nem toda plataforma manda o tamanho 4x
  const url = urls[4] || urls[2] || urls[1]
  return Component('img', { class: ['emote'], src: url, alt: name })
}

const ClassComponent =
  (tag, className) =>
  (children, props = {}) => {
    const { class: classNames, ...rest } = props
    return Component(tag, {
      children,
      class: [joinIfArray(classNames), className],
      ...rest,
    })
  }
const BackgroundComponent = ClassComponent('div', 'bubble-background')
const UsernameBoxComponent = ClassComponent('div', 'username-box')
const UsernameComponent = ClassComponent('div', 'username')
const PronounsBadgeComponent = ClassComponent('span', 'pronouns-badge')
const MessageComponent = ClassComponent('div', 'message')
const MessageWrapperComponent = ClassComponent('span', 'message-wrapper')
const SpacerComponent = ClassComponent('span', 'spacer')

function Component(tag, props) {
  const { children, class: classes, style, ...rest } = props

  if (classes) rest.class = joinIfArray(classes, ' ')

  if (style)
    rest.style = Object.entries(style)
      .map(([key, value]) => `${key}: ${value}`)
      .join(';')

  const attributes = Object.entries(rest).reduce(
    (acc, [attr, value]) => `${acc} ${attr}='${value}'`,
    '',
  )
  return `<${tag}${attributes}>${
    children !== undefined ? joinIfArray(children) : ''
  }</${tag}>`
}

// ----------------------------
//    Pronouns API Functions
// ----------------------------
async function getPronouns() {
  const res = await get(PRONOUNS_API.pronouns)
  if (Array.isArray(res)) {
    res.forEach(pronoun => {
      Widget.pronouns[pronoun.name] = pronoun.display
    })
  }
}

async function getUserPronoun(username) {
  const lowercaseUsername = username.toLowerCase()
  let pronouns = Widget.pronounsCache[lowercaseUsername]

  if (!pronouns || pronouns.expire < Date.now()) {
    const res = await get(PRONOUNS_API.user(lowercaseUsername))
    // [YT] a API pode estar fora do ar ou ter mudado; não deixa quebrar
    const newPronouns = Array.isArray(res) && res.length ? res[0] : {}
    Widget.pronounsCache[lowercaseUsername] = {
      ...newPronouns,
      expire: Date.now() + 1000 * 60 * 5, // 5 minutes in the future
    }
    pronouns = Widget.pronounsCache[lowercaseUsername]
  }

  if (!pronouns.pronoun_id) {
    return null
  }

  return Widget.pronouns[pronouns.pronoun_id]
}

// ---------------------
//    Helper Functions
// ---------------------
async function get(URL) {
  return await fetch(URL)
    .then(async res => {
      if (!res.ok) return null
      return res.json()
    })
    .catch(error => null)
}

async function getFollowDate(username) {
  let followData = Widget.followCache[username]

  if (!followData || followData.expire < Date.now()) {
    const data = await get(DEC_API.followedSeconds(username))
    const seconds = parseInt(data)
    if (isNaN(seconds)) return null

    const date = new Date(seconds * 1000) // convert to milliseconds then date

    Widget.followCache[username] = {
      date,
      expire: Date.now() + 1000 * 60 * 60, // 1 hour in the future
    }
    followData = Widget.followCache[username]
  }

  return followData.date
}

async function followCheck(username) {
  if (
    Widget.service !== 'twitch' || // only works on twitch
    Widget.channel.username.toLowerCase() === username.toLowerCase() // is broadcaster
  ) {
    return true
  }

  const followDate = await getFollowDate(username)
  if (!followDate) return false

  // convert minFollowTime from days to milliseconds
  const minFollowTime = 1000 * 60 * 60 * 24 * FieldData.minFollowTime
  return Date.now() - followDate >= minFollowTime
}

// [YT] Ao carregar (ou dar F5), o StreamElements reenvia as últimas
// mensagens do chat de uma vez. Descarta o que for anterior ao carregamento.
function isBacklogMessage(data = {}) {
  if (!FieldData.ignoreBacklog) return false
  const loadedAt = Widget.loadedAt || 0
  const time = Number(data.time)
  if (time && !isNaN(time)) {
    // 2s de tolerância para diferença de relógio
    return time < loadedAt - 2000
  }
  // sem carimbo de hora: considera rajada os primeiros 3s após carregar
  return Date.now() - loadedAt < 3000
}

function hasIgnoredPrefix(text) {
  for (const prefix of FieldData.ignorePrefixList) {
    if (text.startsWith(prefix)) return true
  }
  return false
}

function passedMinMessageThreshold(userId) {
  if (FieldData.minMessages === 0) return true

  // begin counting
  if (!Widget.userMessageCount[userId]) Widget.userMessageCount[userId] = 0
  Widget.userMessageCount[userId]++

  return Widget.userMessageCount[userId] > FieldData.minMessages
}

function userListIncludes(userList, ...names) {
  const lowercaseNames = names
    .filter(Boolean)
    .map(name => String(name).toLowerCase().replace(/^@/, ''))
  return userList.some(user =>
    lowercaseNames.includes(user.toLowerCase().replace(/^@/, '')),
  )
}

// [YT] Converte badges/flags de qualquer plataforma para os nomes da Twitch
// que o restante do código entende: broadcaster, moderator, subscriber, vip.
function normalizeBadges(data = {}) {
  const { badges = [], tags = {}, author = {} } = data
  const roles = new Set()

  for (const badge of badges) {
    const type = String((badge && badge.type) || badge || '').toLowerCase()
    for (const [role, synonyms] of Object.entries(ROLE_SYNONYMS)) {
      if (synonyms.includes(type)) roles.add(role)
    }
  }

  // YouTube (campos do autor que o StreamElements repassa)
  if (author.isChatOwner) roles.add('broadcaster')
  if (author.isChatModerator) roles.add('moderator')
  if (author.isChatSponsor) roles.add('subscriber')
  if (author.isVerified) roles.add('verified')

  // Twitch (tags IRC)
  if (tags.mod === '1' || tags.mod === true) roles.add('moderator')
  if (tags.subscriber === '1' || tags.subscriber === true)
    roles.add('subscriber')
  if (typeof tags.badges === 'string' && tags.badges.includes('broadcaster'))
    roles.add('broadcaster')

  return [...roles].map(type => ({ type }))
}

async function hasIncludedBadge(badges = [], username) {
  const codeBadges = [...badges]

  if (FieldData.includeEveryone) return true

  const includedBadges = ['broadcaster']

  if (FieldData.includeFollowers) {
    includedBadges.push('follower')
    const isFollower = await followCheck(username)
    if (isFollower) {
      codeBadges.push({ type: 'follower' })
    }
  }

  if (!codeBadges.length) return false

  if (FieldData.includeSubs) includedBadges.push('subscriber', 'founder')
  if (FieldData.includeVIPs) includedBadges.push('vip')
  if (FieldData.includeMods) includedBadges.push('moderator')

  return hasBadge(codeBadges, ...includedBadges)
}

function isMod(badges = []) {
  return hasBadge(badges, 'moderator', 'broadcaster')
}

function isVIP(badges = []) {
  return hasBadge(badges, 'vip', 'broadcaster')
}

function isSub(badges = []) {
  return hasBadge(badges, 'subscriber', 'founder', 'broadcaster')
}

function hasBadge(userBadges = [], ...badgeTypes) {
  return userBadges.some(({ type }) => badgeTypes.includes(type))
}

function getMessageType(data) {
  if (data.isAction) return 'action'
  if (data.tags && data.tags['msg-id'] === 'highlighted-message')
    return 'highlight'

  // [YT] destaque por palavra-chave (ex.: o nome do seu canal)
  if (FieldData.highlightKeywords.length) {
    const lowerText = String(data.text || '').toLowerCase()
    const found = FieldData.highlightKeywords.some(keyword =>
      lowerText.includes(keyword.toLowerCase()),
    )
    if (found) return 'highlight'
  }

  return 'default'
}

function getSound(nick, name, badges, messageType) {
  for (const soundGroup of Widget.soundEffects) {
    const {
      userLevel,
      messageType: soundMessageType,
      users = [],
      soundEffects,
    } = soundGroup
    if (soundMessageType === 'all' || soundMessageType === messageType) {
      switch (userLevel) {
        case 'everyone':
          return soundEffects
        case 'subs':
          if (isSub(badges)) return soundEffects
          break
        case 'vips':
          if (isVIP(badges)) return soundEffects
          break
        case 'mods':
          if (isMod(badges)) return soundEffects
          break
        // assume specific
        default:
          if (userListIncludes(users, nick, name)) return soundEffects
          break
      }
    }
  }
  return null
}

function parse(text, emotes) {
  const filteredEmotes = emotes.filter(emote => {
    const { name, type } = emote
    if (
      (type === 'ffz' && FieldData.ffzGlobal) ||
      (type === 'bttv' && FieldData.bttvGlobal)
    )
      return true

    const globalEmotes = Widget.globalEmotes[type]
    if (!globalEmotes) return true

    return !globalEmotes.includes(name)
  })

  if (!filteredEmotes || filteredEmotes.length === 0) {
    return [{ type: 'text', data: text }]
  }

  const regex = createRegex(filteredEmotes.map(e => htmlEncode(e.name)))

  const textObjs = text
    .split(regex)
    .map(string => ({ type: 'text', data: string }))
  const last = textObjs.pop()

  const parsedText = textObjs.reduce((acc, textObj, index) => {
    return [...acc, textObj, { type: 'emote', data: filteredEmotes[index] }]
  }, [])

  parsedText.push(last)
  return parsedText
}

function calcEmoteSize(parsedText) {
  let emotesFound = 0
  for (const { type, data } of parsedText) {
    if (type === 'emote') {
      emotesFound++
      if (emotesFound > 1) return 2
    } else if (data.trim() !== '') return 1
  }
  return 4
}

// I have no idea how this works anymore but it does
// Regex is so useful but it's so confusing
// This is all to parse out the emote text
const createRegex = strings => {
  const regexStrings = strings
    .sort()
    .reverse()
    .map(string => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = `(?<=\\s|^)(?:${regexStrings.join('|')})(?=\\s|$|[.,!])`
  return new RegExp(regex, 'g')
}

function generateColor(name) {
  if (!name) return DEFAULT_COLORS[0]
  const value = name
    .split('')
    .reduce((sum, letter) => sum + letter.charCodeAt(0), 0)
  return DEFAULT_COLORS[value % DEFAULT_COLORS.length]
}

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function calcPosition(width, height) {
  const main = $('main')
  const widgetWidth = main.innerWidth()
  const widgetHeight = main.innerHeight()
  const { padding } = FieldData

  const minX = padding
  const maxX = Math.max(padding, widgetWidth - padding - width)
  const minY = padding
  const maxY = Math.max(padding, widgetHeight - padding - height)

  const randomX = random(minX, maxX)
  const randomY = random(minY, maxY)

  const randomXCoords = {}
  if (randomX < (minX + maxX) * 0.75) {
    randomXCoords.left = randomX
  } else {
    // render bubbles from the right if they pass the 75% X threshold
    // so that the dynamic animation doesn't go off screen
    randomXCoords.right = maxX - randomX
  }

  if (FieldData.positionMode === 'random') {
    return { ...randomXCoords, top: randomY }
  } else {
    const possibleCoords = []
    const deviation = random(0, FieldData.edgeDeviation)

    if (FieldData.topEdge) {
      possibleCoords.push({ ...randomXCoords, top: minY + deviation })
    }

    if (FieldData.bottomEdge) {
      possibleCoords.push({ ...randomXCoords, bottom: minY + deviation })
    }

    if (FieldData.leftEdge) {
      possibleCoords.push({ left: minX + deviation, top: randomY })
    }

    if (FieldData.rightEdge) {
      possibleCoords.push({ right: minX + deviation, top: randomY })
    }

    // no edges chosen so just put all chats in the middle as an easter egg
    if (possibleCoords.length === 0) {
      return { left: (minX + maxX) / 2, top: (minY + maxY) / 2 }
    }

    return possibleCoords[random(0, possibleCoords.length - 1)]
  }
}

function joinIfArray(possibleArray, delimiter = '') {
  if (Array.isArray(possibleArray)) return possibleArray.join(delimiter)
  return possibleArray
}

const TEST_MESSAGES = [
  ['HYPE'],
  ['uwu'],
  ['boa live!'],
  ['kkkkkkkkk'],
  ['salve salve, chegando agora'],
  [
    'popCat',
    [
      {
        type: 'bttv',
        name: 'popCat',
        id: '60d5abc38ed8b373e421952f',
        gif: true,
        urls: {
          1: 'https://cdn.betterttv.net/emote/60d5abc38ed8b373e421952f/1x',
          2: 'https://cdn.betterttv.net/emote/60d5abc38ed8b373e421952f/2x',
          4: 'https://cdn.betterttv.net/emote/60d5abc38ed8b373e421952f/3x',
        },
        start: 0,
        end: 6,
      },
    ],
  ],
  [
    'catHYPE hypeE catHYPE',
    [
      {
        type: 'bttv',
        name: 'catHYPE',
        id: '6090e9cc39b5010444d0b3ff',
        gif: true,
        urls: {
          1: 'https://cdn.betterttv.net/emote/6090e9cc39b5010444d0b3ff/1x',
          2: 'https://cdn.betterttv.net/emote/6090e9cc39b5010444d0b3ff/2x',
          4: 'https://cdn.betterttv.net/emote/6090e9cc39b5010444d0b3ff/3x',
        },
        start: 0,
        end: 7,
      },
      {
        type: 'bttv',
        name: 'hypeE',
        id: '5b6ded5560d17f4657e1319e',
        gif: true,
        urls: {
          1: 'https://cdn.betterttv.net/emote/5b6ded5560d17f4657e1319e/1x',
          2: 'https://cdn.betterttv.net/emote/5b6ded5560d17f4657e1319e/2x',
          4: 'https://cdn.betterttv.net/emote/5b6ded5560d17f4657e1319e/3x',
        },
        start: 8,
        end: 13,
      },
      {
        type: 'bttv',
        name: 'catHYPE',
        id: '6090e9cc39b5010444d0b3ff',
        gif: true,
        urls: {
          1: 'https://cdn.betterttv.net/emote/6090e9cc39b5010444d0b3ff/1x',
          2: 'https://cdn.betterttv.net/emote/6090e9cc39b5010444d0b3ff/2x',
          4: 'https://cdn.betterttv.net/emote/6090e9cc39b5010444d0b3ff/3x',
        },
        start: 14,
        end: 21,
      },
    ],
  ],
  [
    'D: D: D:',
    [
      {
        type: 'bttv',
        name: 'D:',
        id: '55028cd2135896936880fdd7',
        gif: false,
        urls: {
          1: 'https://cdn.betterttv.net/emote/55028cd2135896936880fdd7/1x',
          2: 'https://cdn.betterttv.net/emote/55028cd2135896936880fdd7/2x',
          4: 'https://cdn.betterttv.net/emote/55028cd2135896936880fdd7/3x',
        },
        start: 0,
        end: 2,
      },
      {
        type: 'bttv',
        name: 'D:',
        id: '55028cd2135896936880fdd7',
        gif: false,
        urls: {
          1: 'https://cdn.betterttv.net/emote/55028cd2135896936880fdd7/1x',
          2: 'https://cdn.betterttv.net/emote/55028cd2135896936880fdd7/2x',
          4: 'https://cdn.betterttv.net/emote/55028cd2135896936880fdd7/3x',
        },
        start: 3,
        end: 5,
      },
      {
        type: 'bttv',
        name: 'D:',
        id: '55028cd2135896936880fdd7',
        gif: false,
        urls: {
          1: 'https://cdn.betterttv.net/emote/55028cd2135896936880fdd7/1x',
          2: 'https://cdn.betterttv.net/emote/55028cd2135896936880fdd7/2x',
          4: 'https://cdn.betterttv.net/emote/55028cd2135896936880fdd7/3x',
        },
        start: 6,
        end: 8,
      },
    ],
  ],
  [
    'SCREME',
    [
      {
        type: 'bttv',
        name: 'SCREME',
        id: '5fea41766b06e834ffd76103',
        gif: true,
        urls: {
          1: 'https://cdn.betterttv.net/emote/5fea41766b06e834ffd76103/1x',
          2: 'https://cdn.betterttv.net/emote/5fea41766b06e834ffd76103/2x',
          4: 'https://cdn.betterttv.net/emote/5fea41766b06e834ffd76103/3x',
        },
        start: 0,
        end: 6,
      },
    ],
  ],
  [
    'bobDance bobDance bobDance',
    [
      {
        type: 'bttv',
        name: 'bobDance',
        id: '5e2a1da9bca2995f13fc0261',
        gif: true,
        urls: {
          1: 'https://cdn.betterttv.net/emote/5e2a1da9bca2995f13fc0261/1x',
          2: 'https://cdn.betterttv.net/emote/5e2a1da9bca2995f13fc0261/2x',
          4: 'https://cdn.betterttv.net/emote/5e2a1da9bca2995f13fc0261/3x',
        },
        start: 0,
        end: 8,
      },
      {
        type: 'bttv',
        name: 'bobDance',
        id: '5e2a1da9bca2995f13fc0261',
        gif: true,
        urls: {
          1: 'https://cdn.betterttv.net/emote/5e2a1da9bca2995f13fc0261/1x',
          2: 'https://cdn.betterttv.net/emote/5e2a1da9bca2995f13fc0261/2x',
          4: 'https://cdn.betterttv.net/emote/5e2a1da9bca2995f13fc0261/3x',
        },
        start: 9,
        end: 17,
      },
      {
        type: 'bttv',
        name: 'bobDance',
        id: '5e2a1da9bca2995f13fc0261',
        gif: true,
        urls: {
          1: 'https://cdn.betterttv.net/emote/5e2a1da9bca2995f13fc0261/1x',
          2: 'https://cdn.betterttv.net/emote/5e2a1da9bca2995f13fc0261/2x',
          4: 'https://cdn.betterttv.net/emote/5e2a1da9bca2995f13fc0261/3x',
        },
        start: 18,
        end: 26,
      },
    ],
  ],
  [
    'bongoTap',
    [
      {
        type: 'bttv',
        name: 'bongoTap',
        id: '5ba6d5ba6ee0c23989d52b10',
        gif: true,
        urls: {
          1: 'https://cdn.betterttv.net/emote/5ba6d5ba6ee0c23989d52b10/1x',
          2: 'https://cdn.betterttv.net/emote/5ba6d5ba6ee0c23989d52b10/2x',
          4: 'https://cdn.betterttv.net/emote/5ba6d5ba6ee0c23989d52b10/3x',
        },
        start: 0,
        end: 8,
      },
    ],
  ],
  [
    'VoHiYo hello!',
    [
      {
        type: 'twitch',
        name: 'VoHiYo',
        id: '81274',
        gif: false,
        urls: {
          1: 'https://static-cdn.jtvnw.net/emoticons/v2/81274/default/dark/1.0',
          2: 'https://static-cdn.jtvnw.net/emoticons/v2/81274/default/dark/2.0',
          4: 'https://static-cdn.jtvnw.net/emoticons/v2/81274/default/dark/3.0',
        },
        start: 0,
        end: 5,
      },
    ],
  ],
  [
    'MercyWing1 PinkMercy MercyWing2',
    [
      {
        type: 'twitch',
        name: 'MercyWing1',
        id: '1003187',
        gif: false,
        urls: {
          1: 'https://static-cdn.jtvnw.net/emoticons/v1/1003187/1.0',
          2: 'https://static-cdn.jtvnw.net/emoticons/v1/1003187/1.0',
          4: 'https://static-cdn.jtvnw.net/emoticons/v1/1003187/3.0',
        },
        start: 0,
        end: 9,
      },
      {
        type: 'twitch',
        name: 'PinkMercy',
        id: '1003190',
        gif: false,
        urls: {
          1: 'https://static-cdn.jtvnw.net/emoticons/v1/1003190/1.0',
          2: 'https://static-cdn.jtvnw.net/emoticons/v1/1003190/1.0',
          4: 'https://static-cdn.jtvnw.net/emoticons/v1/1003190/3.0',
        },
        start: 11,
        end: 19,
      },
      {
        type: 'twitch',
        name: 'MercyWing2',
        id: '1003189',
        gif: false,
        urls: {
          1: 'https://static-cdn.jtvnw.net/emoticons/v1/1003189/1.0',
          2: 'https://static-cdn.jtvnw.net/emoticons/v1/1003189/1.0',
          4: 'https://static-cdn.jtvnw.net/emoticons/v1/1003189/3.0',
        },
        start: 21,
        end: 30,
      },
    ],
  ],
]

function htmlEncode(text) {
  return String(text ?? '').replace(
    /[\<\>\"\'\^\=]/g,
    char => `&#${char.charCodeAt(0)};`,
  )
}
