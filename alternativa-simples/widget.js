/* =========================================================
   Chat em bolhas para YouTube — StreamElements Custom Widget
   ========================================================= */

let fieldData = {};
let ignoredUsers = [];
let ignoredPrefixes = [];
let highlightKeywords = [];
let soundEl = null;
let lastSoundAt = 0;
let alternateSide = false;
let chatEl = null;

/* ---------- Utilidades ---------- */

function parseList(str) {
  return String(str || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, Number(n) || 0));
}

/* ---------- Carregamento das configurações ---------- */

window.addEventListener('onWidgetLoad', (obj) => {
  fieldData = obj.detail.fieldData || {};
  chatEl = document.getElementById('chat');

  ignoredUsers = parseList(fieldData.ignoredUsers).map((u) =>
    u.toLowerCase().replace(/^@/, '')
  );
  ignoredPrefixes = parseList(fieldData.ignoredPrefixes);
  highlightKeywords = parseList(fieldData.highlightKeywords).map((k) =>
    k.toLowerCase()
  );

  if (fieldData.alertSound) {
    soundEl = new Audio(fieldData.alertSound);
    soundEl.volume = clamp(fieldData.alertVolume, 0, 100) / 100;
  }

  chatEl.classList.toggle('no-nick-bg', !fieldData.showNickBg);
});

/* ---------- Eventos do StreamElements ---------- */

window.addEventListener('onEventReceived', (obj) => {
  const { listener, event } = obj.detail;

  // Mensagem apagada por um moderador
  if (listener === 'delete-message') {
    removeBubble(`[data-msg-id="${CSS.escape(event.msgId)}"]`);
    return;
  }
  // Todas as mensagens de um usuário apagadas (timeout / ban)
  if (listener === 'delete-messages') {
    removeBubble(`[data-user-id="${CSS.escape(event.userId)}"]`);
    return;
  }

  if (listener !== 'message') return;
  handleMessage(event.data);
});

/* ---------- Filtros ---------- */

function isIgnored(data) {
  const names = [data.nick, data.displayName]
    .filter(Boolean)
    .map((n) => String(n).toLowerCase().replace(/^@/, ''));

  if (names.some((n) => ignoredUsers.includes(n))) return true;

  const text = String(data.text || '').trim();
  if (ignoredPrefixes.some((p) => text.startsWith(p))) return true;

  return false;
}

function isHighlighted(text) {
  if (!highlightKeywords.length) return false;
  const t = String(text || '').toLowerCase();
  return highlightKeywords.some((k) => t.includes(k));
}

/* ---------- Papel do usuário (dono / mod / membro) ---------- */

function getRole(data) {
  const badges = (data.badges || []).map((b) =>
    String(b.type || '').toLowerCase()
  );
  if (badges.includes('broadcaster') || badges.includes('owner')) return 'owner';
  if (badges.includes('moderator')) return 'mod';
  if (badges.some((b) => /member|sponsor|subscriber/.test(b))) return 'member';
  return 'viewer';
}

function getNickColor(data, role) {
  switch (fieldData.nickColorMode) {
    case 'platform':
      return data.displayColor || fieldData.nickColor;
    case 'role': {
      const byRole = {
        owner: fieldData.ownerColor,
        mod: fieldData.modColor,
        member: fieldData.memberColor,
      };
      return byRole[role] || fieldData.nickColor;
    }
    default:
      return fieldData.nickColor;
  }
}

/* ---------- Renderização ---------- */

function renderText(data) {
  // O StreamElements já entrega o texto escapado e com emotes em <img>
  if (data.renderedText) return data.renderedText;

  let html = escapeHtml(data.text);
  (data.emotes || []).forEach((emote) => {
    const url = emote.urls && (emote.urls['2'] || emote.urls['1']);
    if (!url || !emote.name) return;
    const img = `<img class="emote" src="${url}" alt="${escapeHtml(emote.name)}">`;
    html = html.split(escapeHtml(emote.name)).join(img);
  });
  return html;
}

function renderBadges(data) {
  if (!fieldData.showBadges) return '';
  return (data.badges || [])
    .filter((b) => b.url)
    .map(
      (b) =>
        `<img class="badge" src="${b.url}" alt="" title="${escapeHtml(
          b.description || b.type || ''
        )}">`
    )
    .join('');
}

function handleMessage(data) {
  if (!data || isIgnored(data)) return;

  const role = getRole(data);
  const highlighted = isHighlighted(data.text);
  const name = data.displayName || data.nick || '';

  const el = document.createElement('div');
  el.className = `bubble role-${role}`;
  if (highlighted) el.classList.add('highlighted');
  el.dataset.msgId = data.msgId || '';
  el.dataset.userId = data.userId || '';
  el.style.setProperty('--nick-color', getNickColor(data, role));

  // Lado da bolha
  let side = fieldData.bubbleAlign;
  if (side === 'alternate') {
    side = alternateSide ? 'right' : 'left';
    alternateSide = !alternateSide;
  }
  if (side === 'right') el.classList.add('right');

  el.innerHTML = `
    <div class="meta">
      ${renderBadges(data)}
      <span class="nick">${escapeHtml(name)}</span>
    </div>
    <div class="text">${renderText(data)}</div>
  `;

  chatEl.appendChild(el);
  trimMessages();
  scheduleRemoval(el);
  playSound(highlighted ? 'highlight' : 'message');
}

/* ---------- Limite e tempo de vida ---------- */

function trimMessages() {
  const max = clamp(fieldData.maxMessages, 1, 100);
  const bubbles = chatEl.querySelectorAll('.bubble:not(.out)');
  for (let i = 0; i < bubbles.length - max; i++) {
    bubbles[i].remove();
  }
}

function scheduleRemoval(el) {
  const seconds = clamp(fieldData.messageLifetime, 0, 3600);
  if (!seconds) return; // 0 = nunca some
  setTimeout(() => fadeOut(el), seconds * 1000);
}

function fadeOut(el) {
  if (!el || !el.isConnected) return;
  el.classList.add('out');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 600); // segurança caso a animação não dispare
}

function removeBubble(selector) {
  chatEl.querySelectorAll(selector).forEach(fadeOut);
}

/* ---------- Som ---------- */

function playSound(reason) {
  if (!soundEl) return;

  const mode = fieldData.soundMode || 'all';
  if (mode === 'none') return;
  if (mode === 'highlight' && reason !== 'highlight') return;

  const cooldown = clamp(fieldData.soundCooldown, 0, 60) * 1000;
  const now = Date.now();
  if (now - lastSoundAt < cooldown) return;
  lastSoundAt = now;

  soundEl.currentTime = 0;
  soundEl.play().catch(() => {
    /* o navegador pode bloquear áudio até haver interação; no OBS funciona */
  });
}
