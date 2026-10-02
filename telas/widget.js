/*
  Tela de intervalo (uma cena por vez).
  Mostra a <section> quando chega o evento `tela` com { tela: "on" } e esconde
  com "none". O preset (texto, template, cores) vem do fieldData. Prepara as animações de texto que precisam de
  JS: letras separadas (saltando) e máquina de escrever (digitando).
*/

let F = {}
let ativa = 'none'
const timers = {}

const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]

window.addEventListener('onWidgetLoad', obj => {
  F = obj.detail.fieldData || {}
  // sem imagem escolhida, url('') apontaria para a própria página
  if (!F.fundo) $('#tela').style.setProperty('--img', 'none')
  carregarFonte(F.fonte)
  if (!F.logoImagem) $('.logo').style.display = 'none'
  for (const sec of $$('.tela')) prepararTexto(sec)
  prepararEstrelas()
  aplicar()
})

window.addEventListener('onEventReceived', obj => {
  const { listener, event } = obj.detail
  if (listener === 'tela') return mostrar(event && event.tela)
  if (listener === 'event:test') return onButton(event || {})
})

function onButton(event) {
  if (event.listener !== 'widget-button' || event.value !== 'telas') return
  if (event.field === 'testShowButton') mostrar('on')
  if (event.field === 'testHideButton') mostrar('none')
}

function mostrar(qual) {
  ativa = qual && qual !== 'none' ? 'on' : 'none'
  aplicar()
}

function aplicar() {
  const sec = $('#tela')
  const on = ativa === 'on'
  sec.classList.toggle('on', on)
  if (on) iniciarDigitando(sec)
  else pararDigitando(sec)
}

/* ---------- texto ---------- */

function prepararTexto(sec) {
  const h1 = sec.querySelector('.titulo')
  const texto = h1.dataset.texto || h1.textContent
  h1.dataset.texto = texto

  // letras em <span> para animar uma a uma (saltando, brilho por letra)
  if (sec.classList.contains('anim-saltando')) {
    h1.innerHTML = ''
    ;[...texto].forEach((ch, i) => {
      const s = document.createElement('span')
      s.textContent = ch === ' ' ? ' ' : ch
      s.style.setProperty('--i', i)
      h1.appendChild(s)
    })
  }

  // glitch: cópias do texto nas camadas coloridas
  if (sec.classList.contains('anim-glitch') || sec.classList.contains('tpl-glitch')) {
    h1.setAttribute('data-glitch', texto)
  }
}

function iniciarDigitando(sec) {
  if (!sec.classList.contains('anim-digitando')) return
  const h1 = sec.querySelector('.titulo')
  const texto = h1.dataset.texto || ''
  pararDigitando(sec)
  let i = 0
  let apagando = false
  h1.textContent = ''
  const passo = () => {
    if (!apagando) {
      i++
      h1.textContent = texto.slice(0, i)
      if (i >= texto.length) {
        apagando = true
        timers[sec.id] = setTimeout(passo, 1800)
        return
      }
      timers[sec.id] = setTimeout(passo, 90)
    } else {
      i--
      h1.textContent = texto.slice(0, i)
      if (i <= 0) {
        apagando = false
        timers[sec.id] = setTimeout(passo, 500)
        return
      }
      timers[sec.id] = setTimeout(passo, 45)
    }
  }
  passo()
}

function pararDigitando(sec) {
  clearTimeout(timers[sec.id])
  const h1 = sec.querySelector('.titulo')
  if (sec.classList.contains('anim-digitando') && h1) h1.textContent = h1.dataset.texto || ''
}

/* ---------- template "estrelas": posições aleatórias em box-shadow ---------- */

function prepararEstrelas() {
  for (const sec of $$('.tela.tpl-estrelas')) {
    const camadas = sec.querySelectorAll('.tpl i')
    ;[[180, 1], [90, 2], [40, 3]].forEach(([qtd, tam], idx) => {
      const el = camadas[idx]
      if (!el) return
      const pontos = []
      for (let k = 0; k < qtd; k++) {
        pontos.push(`${Math.round(Math.random() * 1920)}px ${Math.round(Math.random() * 2160)}px 0 ${tam - 1}px var(--ct)`)
      }
      el.style.boxShadow = pontos.join(',')
      el.style.width = el.style.height = `${tam}px`
    })
  }
}

/* ---------- fonte do título: carrega do Google Fonts só a escolhida ---------- */

function carregarFonte(nome) {
  nome = String(nome || '').trim()
  if (!nome || nome === 'Outfit') return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(nome).replace(/%20/g, '+')}:wght@400;700;900&display=swap`
  document.head.appendChild(link)
}
