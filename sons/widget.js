/*
  Botões de som — toca o áudio pedido pelo painel.
  Evento: onEventReceived com listener `som` e event { url, volume }.
  O volume final é volume do botão × volume geral do widget.
*/

let volumeGeral = 0.8

window.addEventListener('onWidgetLoad', obj => {
  const F = obj.detail.fieldData || {}
  volumeGeral = Math.max(0, Math.min(1, Number(F.volumeGeral ?? 80) / 100))
})

window.addEventListener('onEventReceived', obj => {
  const { listener, event } = obj.detail
  if (listener === 'som' && event && event.url) return tocar(event.url, event.volume)
  if (listener === 'event:test' && event && event.listener === 'widget-button' && event.value === 'sons' && event.field === 'testButton') return bipe()
})

function tocar(url, volume) {
  const a = new Audio(url)
  a.volume = Math.max(0, Math.min(1, (Number(volume ?? 100) / 100) * volumeGeral))
  a.play().catch(() => {})
}

// bipe curto sem arquivo, só pra conferir que o áudio está saindo no OBS
function bipe() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = 880
    g.gain.value = 0.15 * volumeGeral
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.25)
  } catch (e) {}
}
