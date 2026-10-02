# Arquitetura

## Visão geral

```
YouTube (chat da live)                 OBS (fontes de navegador)
        │  polling 1–3 s                        ▲  SSE
        ▼                                       │
 lib/youtube.js ──► server.js ──► /overlay/island ──► widget Dynamic Island
   (leitor)         (núcleo)      (ou /overlay/cena, todos os widgets registrados)
                        │
                        └──► /config (painel)  ◄── navegador do Filipe
```

- **Fontes** produzem eventos brutos: YouTube (`lib/youtube.js`), Twitch (`lib/twitch.js`, IRC anônimo por WebSocket), Kick (`lib/kick.js`, socket Pusher do site), conta Twitch (`lib/twitchconta.js`, OAuth + EventSub por WebSocket: seguidores, subs, bits, raids, resgates), LivePix (`lib/livepix.js`, API oficial com client_credentials, leitura a cada 15 s + webhook) e PixGG (`lib/pixgg.js`, só webhook assinado). Chat não exige login; eventos da conta Twitch exigem "Entrar com Twitch"; doações exigem as credenciais do aplicativo coladas no painel.
- O **núcleo** normaliza para o formato do StreamElements e distribui por SSE para todos os overlays abertos.
- **Overlays** são páginas geradas na hora: o `widget.html` e o `widget.css` com os `{campos}` substituídos, o `widget.js` inline, e um pequeno trecho que dispara `onWidgetLoad` e repassa os eventos do SSE como `onEventReceived`.
- O **painel** lê o `widget.json` de cada widget e monta o formulário. Salvar grava `config/<widget>.json` e manda `reload` para os overlays daquele widget.

## Contrato de eventos (formato StreamElements)

Tudo que chega aos widgets é `window.dispatchEvent(new CustomEvent(nome, { detail }))`.

### `onWidgetLoad`

```json
{ "fieldData": { "campo": "valor" }, "channel": { "username": "canal", "provider": "youtube" }, "overlay": { "isEditorMode": false } }
```

`fieldData` = valores padrão do `widget.json` sobrescritos por `config/<widget>.json`.

### `onEventReceived`

`detail = { listener, event }`. Listeners usados:

| listener | event | origem |
|---|---|---|
| `message` | `{ service: "youtube", data: { time, nick, userId, displayName, text, msgId, badges[], emotes[], tags{}, avatar, author{} } }` | mensagem do chat |
| `superchat-latest` | `{ name, amount, currency, message, avatar, displayString }` | Super Chat / sticker pago |
| `sponsor-latest` | `{ name, amount (meses), message, avatar, header }` | novo membro ou renovação |
| `sponsor-latest` com `gifted: true, sender` | `{ name, amount (quantidade), sender, avatar }` | presente de membro |
| `subscriber-latest` | `{ service, name, amount (meses), tier, message, avatar }` e, com `gifted: true`, `sender` e `bulkGifted` | sub, resub e presentes da Twitch; assinaturas e presentes do Kick. **YouTube ainda não emite** (ver roteiro) |
| `cheer-latest` | `{ service, name, amount (bits), message, avatar }` | bits na Twitch |
| `raid-latest` | `{ service, name, amount (espectadores), avatar }` | raid na Twitch, host no Kick |
| `delete-message`, `delete-messages` | `{ msgId }` / `{ userId }` | moderação na Twitch e no Kick |
| `follower-latest` | `{ service, name, avatar }` | seguidor na Twitch (EventSub, com a conta conectada) |
| `tip-latest` | `{ service, name, amount, currency, message, avatar, audio }` | doação no LivePix ou na PixGG |
| `redemption-latest` | `{ service, name, reward, amount (custo), message, avatar }` | resgate de pontos na Twitch (sem widget ainda) |
| `event:test` | `{ listener: "widget-button", field, value }` | botões de teste do painel |
| `som` | `{ url, volume, nome }` | botão de som apertado no Stream Manager (widget `sons`) |
| `tela` | `{ tela: "on" \| "none", cena }` | mostrar/esconder a tela de intervalo (widget `telas`); o preset vem do fieldData da cena ativa |

Campos de `data.badges[]`: `{ type, version, url, description }` com `type` em `owner`, `moderator`, `member`, `verified`. `data.author` traz `isChatOwner`, `isChatModerator`, `isChatSponsor`, `isVerified`. Os widgets aceitam também os nomes da Twitch (`broadcaster`, `subscriber`, `vip`).

`data.emotes[]`: `{ type: "youtube", name: ":shortcut:", id, urls: {1,2,4}, start, end }`. Emojis padrão do Unicode vão no texto como caractere; só emojis personalizados do canal viram `emotes`.

## Rotas do servidor

| Rota | Auth | Função |
|---|---|---|
| `GET /config`, `/public/*` | senha | painel |
| `GET/POST /api/server-config` | senha | canal alvo |
| `GET /api/status` | senha | estado do leitor, últimas mensagens, overlays conectados |
| `GET /api/live` | senha | painel da live: mensagens, por minuto, participantes, Super Chats, membros, últimas 100 mensagens e eventos (em memória, zera a cada live); com a conta Google: `espectadores` (a cada 30 s) e `inscritos.recentes` (a cada 60 s, emite `subscriber-latest` para os novos) |
| `GET /api/widgets` | senha | lista de widgets |
| `GET /api/widget/:id/fields` | senha | `widget.json` |
| `GET/POST/DELETE /api/widget/:id/config` | senha | valores salvos |
| `POST /api/test` | senha | dispara `{listener, event}` nos overlays |
| `GET/POST /api/cenas` | senha | cenas (presets do widget `telas`): `ativar`, `criar`, `renomear`, `salvar`, `apagar`, e presets de visual (`preset-salvar`, `preset-aplicar`, `preset-padrao`, `preset-apagar`). Ativar recarrega o overlay `telas`; a cada conexão SSE nova vai o estado (`tela: on\|none`) |
| `GET /api/crm/viewers?q&filtro`, `GET/POST/DELETE /api/crm/viewer/:id`, `POST …/nota`, `DELETE …/nota/:n`, `POST …/mesclar` | senha | CRM de viewers (SQLite `config/crm.db`): fichas criadas na primeira mensagem com o que é público; notas internas; e-mail só com SIM (janela de 1 min) ou digitado pelo admin; apagar tudo; mesclar |
| `POST /api/interno/rede/vinculo` | token `x-live-token` (= `REDE_TOKEN`) | a rede avisa que alguém que veio da live criou a conta; a ficha ganha `redeUserId` e o nome do perfil |
| `POST /api/crm/viewer/:id/aprovar` → pede convite à rede (`REDE_URL/api/interno/live/convite`); `…/convidar` reenvia; `…/vincular` liga a um perfil; `GET /api/crm/rede/membros?q` busca perfis na rede | senha | ponte com ravoque.com.br |
| `GET/POST /api/sons`, `POST /api/som {id}` | senha | botões de som: lista (nome, arquivo em `sounds/`, volume, cor) e disparo — emite `som {url, volume}` para o widget `sons` |
| `GET/POST /api/comandos` | senha | comandos do chat (`!gatilho` → resposta pela conta do canal, com intervalo mínimo) |
| `GET/POST /api/crm/pontos`, `POST /api/crm/viewer/:id/zerar-pontos` | senha | valores dos pontos e retenção; ranking; zerar |
| `GET /api/google/status`, `/login`, `/callback`, `POST /logout` | senha | conta Google do canal (OAuth; escopos youtube.readonly + youtube.force-ssl); `refresh_token` em `config/google.json` |
| `POST /api/chat/enviar` | senha | `{texto}`: manda mensagem no chat da live como o dono do canal (`liveChatMessages.insert`, 50 unidades de cota) |
| `POST /api/overlays` | senha | `{on}`: esconde ou mostra todos os overlays abertos (SSE `visibility`); persiste em `server.json` |
| `POST /api/upload?name=` | senha | grava som em `sounds/`, devolve URL |
| `GET /overlay/:id?key=` | chave | página do overlay |
| `GET /overlay/cena?key=` | chave | todos os widgets em uma página (um iframe transparente por widget). As telas de intervalo são trocadas por **crossfade**: a cena nova carrega num iframe escondido (`/overlay/telas?cena=…&mostrar=1`) e só então a antiga sai, sem instante transparente |
| `GET /events?key=` | chave | SSE (`{kind:"event"|"status"|"reload"}`) |
| `GET /sounds/*` | aberta | arquivos de som e imagens enviadas |
| `GET /marca/*` | aberta | logos do ravoque (os overlays usam) |

Senha = HTTP Basic com `ADMIN_PASSWORD` (usuário livre). Chave = `OVERLAY_KEY`. Sem as variáveis definidas, tudo fica aberto (modo local).

## Leitor do YouTube

1. `findLiveVideoId(alvo)`: aceita `@canal`, URL do canal ou URL/ID da live. Busca `youtube.com/@canal/live` e lê o `videoId` canônico.
2. `getChatContext(videoId)`: baixa `live_chat?v=...&is_popout=1`, extrai `INNERTUBE_API_KEY`, versão do cliente e a continuação do modo "Chat ao vivo" (todas as mensagens, não só as principais).
3. `poll()`: POST em `youtubei/v1/live_chat/get_live_chat` com a continuação; processa `actions[].addChatItemAction.item` e agenda o próximo ciclo pelo `timeoutMs` devolvido (limitado entre 0,8 s e 8 s).
4. Renderers tratados: `liveChatTextMessageRenderer`, `liveChatPaidMessageRenderer`, `liveChatPaidStickerRenderer`, `liveChatMembershipItemRenderer`, `liveChatSponsorshipsGiftPurchaseAnnouncementRenderer`.
5. Falhas: sem live → tenta de novo em 20 s; erro de rede → 8 s; chat encerrado → 15 s.

É um caminho interno, não a API oficial. Vantagem: sem login, sem cota, atraso baixo. Risco: o YouTube pode mudar o formato; o estado e o último erro aparecem no painel.

## Adicionando um módulo

1. Fonte nova (ex.: Twitch): arquivo em `servidor-local/lib/`, com a mesma interface do `YouTubeChat` (`start`, `stop`, `onEvent`, `onStatus`).
2. Normalização: mapear para os listeners acima em `toStreamElements()`. Se for um evento novo, definir o formato aqui neste documento primeiro.
3. Widget novo: pasta própria com os quatro arquivos, registrada em `WIDGETS` no `server.js`. O painel e o overlay passam a existir automaticamente.
4. Painel: se o módulo precisar de tela própria (ex.: login OAuth), adicionar uma aba em `config.html` e rotas `/api/<modulo>/...` protegidas por senha.
