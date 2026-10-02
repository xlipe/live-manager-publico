/*
  CRM de viewers — quem passa pelo chat, o que se sabe deles e o que se pode
  saber. SQLite nativo do Node (node:sqlite), um arquivo em dados/ (crm.db).

  Regra de dados, decidida pelo Filipe em 23/09/2026:
  - Sozinho, o sistema guarda só o que é público no chat e o que ele mesmo
    memoriza: conta do YouTube (channelId, nome público, avatar, cargos),
    quando apareceu, quantas mensagens, e as NOTAS INTERNAS que ele escreve.
  - E-mail só entra com consentimento explícito (SIM no chat, em 1 minuto).
    Antes disso fica "pendente" e é apagado se o SIM não vier.
  - Nome e sobrenome não vêm do nome público: vêm do perfil que a pessoa criar
    na rede (ravoque.com.br), pela ponte — nunca inferidos.
*/

const { DatabaseSync } = require('node:sqlite')

const JANELA_SIM_MS = 60 * 1000

class Crm {
  constructor(arquivo) {
    this.db = new DatabaseSync(arquivo)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS viewers (
        channelId TEXT PRIMARY KEY,
        nome TEXT,
        avatar TEXT,
        cargos TEXT DEFAULT '[]',
        primeiraVez INTEGER,
        ultimaVez INTEGER,
        mensagens INTEGER DEFAULT 0,
        lives INTEGER DEFAULT 0,
        ultimaLive TEXT,
        pontos INTEGER DEFAULT 0,
        email TEXT,
        emailStatus TEXT,            -- NULL | 'pendente' | 'confirmado'
        emailPendenteEm INTEGER,
        emailPendente TEXT,
        consentimentoEm INTEGER,
        consentimentoMsgId TEXT,
        consentimentoTexto TEXT,
        convidadoEm INTEGER,
        aprovadoEm INTEGER,
        recusadoEm INTEGER,
        redeUserId TEXT,
        primeiroNome TEXT,
        sobrenome TEXT
      );
      CREATE TABLE IF NOT EXISTS notas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channelId TEXT NOT NULL,
        texto TEXT NOT NULL,
        criadaEm INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notas_viewer ON notas(channelId);
      CREATE TABLE IF NOT EXISTS atividades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channelId TEXT NOT NULL,
        tipo TEXT NOT NULL,          -- primeira-vez | live | superchat | membro | presente | inscreveu | consentiu | convidado | entrou-na-rede
        valor TEXT,
        texto TEXT,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS atividades_viewer ON atividades(channelId, at);
      CREATE INDEX IF NOT EXISTS viewers_ultima ON viewers(ultimaVez);
    `)
    for (const col of ['aprovadoEm', 'recusadoEm']) {
      try { this.db.exec(`ALTER TABLE viewers ADD COLUMN ${col} INTEGER`) } catch (e) { /* já existe */ }
    }
    this.stmt = {
      get: this.db.prepare('SELECT * FROM viewers WHERE channelId = ?'),
      insert: this.db.prepare(`INSERT INTO viewers (channelId, nome, avatar, cargos, primeiraVez, ultimaVez, mensagens, lives, ultimaLive)
        VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`),
      touch: this.db.prepare(`UPDATE viewers SET nome = ?, avatar = COALESCE(?, avatar), cargos = ?, ultimaVez = ?, mensagens = mensagens + 1,
        lives = lives + CASE WHEN ultimaLive IS ? THEN 0 ELSE 1 END, ultimaLive = ? WHERE channelId = ?`),
      notas: this.db.prepare('SELECT * FROM notas WHERE channelId = ? ORDER BY criadaEm DESC'),
      notaNova: this.db.prepare('INSERT INTO notas (channelId, texto, criadaEm) VALUES (?, ?, ?)'),
      notaApaga: this.db.prepare('DELETE FROM notas WHERE id = ? AND channelId = ?'),
      atividade: this.db.prepare('INSERT INTO atividades (channelId, tipo, valor, texto, at) VALUES (?, ?, ?, ?, ?)'),
      atividades: this.db.prepare('SELECT * FROM atividades WHERE channelId = ? ORDER BY at DESC LIMIT 200'),
      temAtividade: this.db.prepare('SELECT 1 FROM atividades WHERE channelId = ? AND tipo = ? LIMIT 1'),
    }
  }

  /* ---------- captura automática ---------- */

  // toda mensagem passa aqui; cria ou atualiza a ficha com o que é público
  registrarMensagem(ev, live) {
    const id = ev.channelId
    if (!id) return null
    const agora = Date.now()
    const cargos = JSON.stringify(cargosDe(ev))
    const nome = String(ev.name || '').replace(/^@/, '')
    const atual = this.stmt.get.get(id)
    if (!atual) {
      this.stmt.insert.run(id, nome, ev.avatar || null, cargos, agora, agora, live || null)
      this.stmt.atividade.run(id, 'primeira-vez', live || null, null, agora)
    } else {
      if (live && atual.ultimaLive !== live) this.stmt.atividade.run(id, 'live', live, null, agora)
      this.stmt.touch.run(nome, ev.avatar || null, cargos, agora, live || null, live || null, id)
    }
    return id
  }

  // abre a ficha sem contar mensagem (membro novo, presente)
  garantirFicha(ev, live) {
    const id = ev.channelId
    if (!id || this.stmt.get.get(id)) return id
    const agora = Date.now()
    this.stmt.insert.run(id, String(ev.name || '').replace(/^@/, ''), ev.avatar || null, JSON.stringify(cargosDe(ev)), agora, agora, live || null)
    this.db.prepare('UPDATE viewers SET mensagens = 0 WHERE channelId = ?').run(id)
    this.stmt.atividade.run(id, 'primeira-vez', live || null, null, agora)
    return id
  }

  // evento com valor: Super Chat, membro, presente, inscrição, consentimento…
  registrarAtividade(id, tipo, valor, texto) {
    if (!id || !this.stmt.get.get(id)) return
    this.stmt.atividade.run(id, tipo, valor == null ? null : String(valor), texto || null, Date.now())
  }

  // uma vez só por pessoa (ex.: 'inscreveu')
  registrarAtividadeUnica(id, tipo, valor, texto, quando) {
    if (!id || !this.stmt.get.get(id) || this.stmt.temAtividade.get(id, tipo)) return
    this.stmt.atividade.run(id, tipo, valor == null ? null : String(valor), texto || null, quando || Date.now())
  }

  /* ---------- leitura ---------- */

  ficha(id) {
    const v = this.stmt.get.get(id)
    if (!v) return null
    const atividades = this.stmt.atividades.all(id)
    const resumo = {
      superchats: atividades.filter(a => a.tipo === 'superchat').length,
      membroDesde: (atividades.filter(a => a.tipo === 'membro').at(-1) || {}).at || null,
      inscritoEm: (atividades.find(a => a.tipo === 'inscreveu') || {}).at || null,
    }
    return { ...formatar(v), notas: this.stmt.notas.all(id), atividades, resumo }
  }

  lista({ q = '', filtro = '', limite = 100 } = {}) {
    const where = []
    const params = []
    if (q) { where.push('(nome LIKE ? OR email LIKE ? OR primeiroNome LIKE ? OR sobrenome LIKE ?)'); const like = `%${q}%`; params.push(like, like, like, like) }
    if (filtro === 'rede') where.push('redeUserId IS NOT NULL')
    if (filtro === 'convidados') where.push('convidadoEm IS NOT NULL')
    if (filtro === 'pendentes') where.push("emailStatus = 'pendente'")
    if (filtro === 'confirmados') where.push("emailStatus = 'confirmado'")
    if (filtro === 'com-notas') where.push('channelId IN (SELECT channelId FROM notas)')
    if (filtro === 'catraca') where.push("emailStatus = 'confirmado' AND aprovadoEm IS NULL AND recusadoEm IS NULL")
    if (filtro === 'aprovados') where.push('aprovadoEm IS NOT NULL')
    if (filtro === 'recusados') where.push('recusadoEm IS NOT NULL')
    const sql = `SELECT v.*, (SELECT COUNT(*) FROM notas n WHERE n.channelId = v.channelId) AS qtdNotas FROM viewers v
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ultimaVez DESC LIMIT ?`
    params.push(limite)
    return this.db.prepare(sql).all(...params).map(formatar)
  }

  totais() {
    const t = this.db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN emailStatus = 'confirmado' THEN 1 ELSE 0 END) AS confirmados,
      SUM(CASE WHEN emailStatus = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
      SUM(CASE WHEN emailStatus = 'confirmado' AND aprovadoEm IS NULL AND recusadoEm IS NULL THEN 1 ELSE 0 END) AS naCatraca,
      SUM(CASE WHEN aprovadoEm IS NOT NULL AND convidadoEm IS NULL THEN 1 ELSE 0 END) AS aguardandoEnvio,
      SUM(CASE WHEN redeUserId IS NOT NULL THEN 1 ELSE 0 END) AS naRede FROM viewers`).get()
    return t
  }

  /* ---------- edição manual ---------- */

  editar(id, campos) {
    const permitidos = ['primeiroNome', 'sobrenome', 'email', 'redeUserId']
    const sets = []
    const params = []
    for (const k of permitidos) {
      if (k in campos) { sets.push(`${k} = ?`); params.push(campos[k] === '' ? null : campos[k]) }
    }
    // e-mail digitado à mão pelo Filipe conta como confirmado por ele
    if ('email' in campos) { sets.push('emailStatus = ?'); params.push(campos.email ? 'confirmado' : null) }
    if (!sets.length) return this.ficha(id)
    params.push(id)
    this.db.prepare(`UPDATE viewers SET ${sets.join(', ')} WHERE channelId = ?`).run(...params)
    return this.ficha(id)
  }

  nota(id, texto) {
    texto = String(texto || '').trim()
    if (!texto) return this.ficha(id)
    if (!this.stmt.get.get(id)) return null
    this.stmt.notaNova.run(id, texto, Date.now())
    return this.ficha(id)
  }

  apagarNota(id, notaId) {
    this.stmt.notaApaga.run(notaId, id)
    return this.ficha(id)
  }

  // direito de exclusão: some tudo da pessoa
  apagar(id) {
    this.db.prepare('DELETE FROM notas WHERE channelId = ?').run(id)
    this.db.prepare('DELETE FROM atividades WHERE channelId = ?').run(id)
    this.db.prepare('DELETE FROM viewers WHERE channelId = ?').run(id)
  }

  // duas fichas da mesma pessoa (ex.: conta da rede não identificada): junta na primeira
  mesclar(idFica, idSome) {
    const a = this.stmt.get.get(idFica)
    const b = this.stmt.get.get(idSome)
    if (!a || !b || idFica === idSome) return this.ficha(idFica)
    this.db.prepare(`UPDATE viewers SET
        primeiraVez = MIN(primeiraVez, ?), ultimaVez = MAX(ultimaVez, ?), mensagens = mensagens + ?, pontos = pontos + ?,
        email = COALESCE(email, ?), emailStatus = COALESCE(emailStatus, ?), consentimentoEm = COALESCE(consentimentoEm, ?),
        consentimentoMsgId = COALESCE(consentimentoMsgId, ?), consentimentoTexto = COALESCE(consentimentoTexto, ?),
        convidadoEm = COALESCE(convidadoEm, ?), redeUserId = COALESCE(redeUserId, ?),
        primeiroNome = COALESCE(primeiroNome, ?), sobrenome = COALESCE(sobrenome, ?)
      WHERE channelId = ?`).run(b.primeiraVez, b.ultimaVez, b.mensagens, b.pontos, b.email, b.emailStatus, b.consentimentoEm,
      b.consentimentoMsgId, b.consentimentoTexto, b.convidadoEm, b.redeUserId, b.primeiroNome, b.sobrenome, idFica)
    this.db.prepare('UPDATE notas SET channelId = ? WHERE channelId = ?').run(idFica, idSome)
    this.db.prepare('UPDATE atividades SET channelId = ? WHERE channelId = ?').run(idFica, idSome)
    this.db.prepare('DELETE FROM viewers WHERE channelId = ?').run(idSome)
    return this.ficha(idFica)
  }

  /* ---------- catraca: o Filipe decide quem recebe convite ---------- */

  aprovar(id) {
    const v = this.stmt.get.get(id)
    if (!v || v.emailStatus !== 'confirmado') return this.ficha(id)
    this.db.prepare('UPDATE viewers SET aprovadoEm = ?, recusadoEm = NULL WHERE channelId = ?').run(Date.now(), id)
    this.stmt.atividade.run(id, 'aprovado', null, null, Date.now())
    return this.ficha(id)
  }

  // recusa: some o e-mail (sem base pra guardar), a ficha pública fica
  recusar(id, motivo) {
    const v = this.stmt.get.get(id)
    if (!v) return null
    this.db.prepare("UPDATE viewers SET recusadoEm = ?, aprovadoEm = NULL, email = NULL, emailStatus = NULL WHERE channelId = ?").run(Date.now(), id)
    this.stmt.atividade.run(id, 'recusado', null, motivo || null, Date.now())
    return this.ficha(id)
  }

  // a ponte marca quando o convite realmente saiu
  marcarConvidado(id) {
    this.db.prepare('UPDATE viewers SET convidadoEm = ? WHERE channelId = ?').run(Date.now(), id)
    this.stmt.atividade.run(id, 'convidado', null, null, Date.now())
  }

  // a rede avisou: quem veio da live criou a conta
  vincularRede(id, dados) {
    if (!id || !this.stmt.get.get(id)) return null
    this.db.prepare('UPDATE viewers SET redeUserId = ?, primeiroNome = COALESCE(?, primeiroNome) WHERE channelId = ?').run(dados.userId || null, dados.displayName || null, id)
    this.stmt.atividade.run(id, 'entrou-na-rede', dados.username || dados.handle || null, dados.displayName || null, Date.now())
    return this.ficha(id)
  }

  aguardandoEnvio() {
    return this.db.prepare('SELECT * FROM viewers WHERE aprovadoEm IS NOT NULL AND convidadoEm IS NULL AND email IS NOT NULL ORDER BY aprovadoEm').all().map(formatar)
  }

  /* ---------- retenção: e-mail que deu SIM mas nunca virou conta ---------- */

  // some o e-mail (e a prova do SIM) de quem foi convidado/aprovado e não criou
  // conta em N dias. A ficha pública e as notas ficam. Devolve quantos limpou.
  expirarEmails(dias = 30) {
    const limite = Date.now() - dias * 86400000
    const alvo = this.db.prepare(`SELECT channelId FROM viewers WHERE emailStatus = 'confirmado' AND redeUserId IS NULL
      AND COALESCE(convidadoEm, aprovadoEm, consentimentoEm) < ?`).all(limite)
    for (const { channelId } of alvo) {
      this.db.prepare(`UPDATE viewers SET email = NULL, emailStatus = NULL, consentimentoEm = NULL, consentimentoMsgId = NULL,
        consentimentoTexto = NULL, convidadoEm = NULL, aprovadoEm = NULL WHERE channelId = ?`).run(channelId)
      this.stmt.atividade.run(channelId, 'email-expirou', `${dias} dias sem criar conta`, null, Date.now())
    }
    return alvo.length
  }

  /* ---------- pontos ---------- */

  // soma pontos e registra o motivo; `chave` com cooldown evita flood
  // (ex.: mensagem só pontua a cada X segundos por pessoa)
  pontuar(id, quanto, motivo, chaveCooldown, cooldownMs) {
    if (!id || !quanto || !this.stmt.get.get(id)) return false
    if (chaveCooldown && cooldownMs) {
      this._cooldown = this._cooldown || new Map()
      const k = `${id}|${chaveCooldown}`
      const ultimo = this._cooldown.get(k) || 0
      if (Date.now() - ultimo < cooldownMs) return false
      this._cooldown.set(k, Date.now())
    }
    this.db.prepare('UPDATE viewers SET pontos = pontos + ? WHERE channelId = ?').run(quanto, id)
    this.stmt.atividade.run(id, 'pontos', `${quanto > 0 ? '+' : ''}${quanto}`, motivo || null, Date.now())
    return true
  }

  // primeira mensagem do dia (fuso do Rio) vale bônus; guarda por dia em memória
  primeiraDoDia(id) {
    this._dias = this._dias || new Map()
    const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)
    if (this._dias.get(id) === hoje) return false
    this._dias.set(id, hoje)
    return true
  }

  ranking(limite = 50) {
    return this.db.prepare('SELECT channelId, nome, avatar, cargos, pontos, mensagens, lives, redeUserId FROM viewers WHERE pontos > 0 ORDER BY pontos DESC, mensagens DESC LIMIT ?').all(limite).map(formatar)
  }

  zerarPontos(id, motivo) {
    this.db.prepare('UPDATE viewers SET pontos = 0 WHERE channelId = ?').run(id)
    this.stmt.atividade.run(id, 'pontos', 'zerado', motivo || null, Date.now())
    return this.ficha(id)
  }

  /* ---------- consentimento por SIM (fase 2 usa) ---------- */

  emailPendente(id, email) {
    this.db.prepare("UPDATE viewers SET emailPendente = ?, emailPendenteEm = ?, emailStatus = COALESCE(emailStatus, 'pendente') WHERE channelId = ? AND emailStatus IS NOT 'confirmado'").run(email, Date.now(), id)
  }

  confirmarSim(id, msgId, texto) {
    const v = this.stmt.get.get(id)
    if (!v || !v.emailPendente || Date.now() - (v.emailPendenteEm || 0) > JANELA_SIM_MS) return null
    this.db.prepare(`UPDATE viewers SET email = emailPendente, emailPendente = NULL, emailPendenteEm = NULL, emailStatus = 'confirmado',
      consentimentoEm = ?, consentimentoMsgId = ?, consentimentoTexto = ? WHERE channelId = ?`).run(Date.now(), msgId || null, texto || null, id)
    this.stmt.atividade.run(id, 'consentiu', null, texto || null, Date.now())
    return this.ficha(id)
  }

  // pendentes que passaram da janela sem SIM: apaga o e-mail, fica só a conta
  limparPendentes() {
    const limite = Date.now() - JANELA_SIM_MS
    const r = this.db.prepare("UPDATE viewers SET emailPendente = NULL, emailPendenteEm = NULL, emailStatus = NULL WHERE emailStatus = 'pendente' AND emailPendenteEm < ?").run(limite)
    return r.changes
  }
}

function cargosDe(ev) {
  const f = ev.flags || {}
  const c = []
  if (f.isChatOwner) c.push('dono')
  if (f.isChatModerator) c.push('moderador')
  if (f.isChatSponsor) c.push('membro')
  if (f.isVerified) c.push('verificado')
  return c
}

function formatar(v) {
  return { ...v, cargos: JSON.parse(v.cargos || '[]'), emailPendente: undefined, temPendente: Boolean(v.emailPendente) }
}

module.exports = { Crm, JANELA_SIM_MS }
