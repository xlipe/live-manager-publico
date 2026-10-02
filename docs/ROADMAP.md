# Roteiro de módulos

Ordem sugerida. Cada item diz o que falta e como encaixa na arquitetura. Antes de qualquer módulo novo: o deploy do que existe em `live.ravoque.com.br` e uma live real para validar atraso, fotos e cargos.

## 1. Alerta de novo inscrito (YouTube)

Inscrição no canal não aparece no chat. Precisa da API oficial (YouTube Data API v3) com autorização do dono do canal.

- Criar projeto no Google Cloud, ativar a YouTube Data API v3, credencial OAuth "aplicativo web" com redirect `https://live.ravoque.com.br/api/google/callback`.
- Painel: aba "Contas" com botão "Entrar com Google" (escopo `youtube.readonly`). Guardar `refresh_token` em `config/google.json` (fora do git).
- Leitor: a cada 30 a 60 s, `subscriptions.list?myRecentSubscribers=true` e emitir `subscriber-latest` para os novos (comparar por `subscriberSnippet.channelId`). Cota diária de 10.000 unidades: 1 unidade por chamada, folga suficiente.
- Só funciona para inscrições públicas; inscrições privadas não são informadas pela API.

## 2. Twitch e Kick (chat feito; falta login para seguidores)

**Feito em 02/10/2026 (parte 2):** `lib/twitchconta.js` (Entrar com Twitch + EventSub: seguidores, subs, presentes, bits, raids, resgates de pontos; com a conta conectada, os eventos do chat anônimo são descartados para não duplicar) e doações por Pix: `lib/livepix.js` (client_credentials, leitura a cada 15 s, webhook no servidor público) e `lib/pixgg.js` (webhook assinado com HMAC; só no servidor público). Tudo na aba Contas. Exige `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` no `.env`.

**Feito em 02/10/2026 (parte 1):** `lib/twitch.js` (IRC anônimo por WebSocket: mensagens, emotes, cargos, bits, subs, resubs, presentes, raids, moderação) e `lib/kick.js` (socket Pusher do site: mensagens, emotes, cargos, assinaturas, presentes, hosts, moderação). Canais configurados na aba "Servidor e live". Pendente: seguidores da Twitch (EventSub com login), que ficam no item abaixo.

- Chat: conexão IRC anônima em `wss://irc-ws.chat.twitch.tv:443` (usuário `justinfan12345`, sem senha), `CAP REQ :twitch.tv/tags twitch.tv/commands`, `JOIN #canal`. As tags trazem `badges`, `display-name`, `color`, `emotes`, `id`, `user-id`. Mapear para `message` com `service: "twitch"` e `displayColor` da tag `color`. Emotes: `https://static-cdn.jtvnw.net/emoticons/v2/<id>/default/dark/{1.0,2.0,3.0}`.
- Eventos (seguidor, sub, bits, raid): EventSub por WebSocket exige token do dono do canal. Painel com "Entrar com Twitch" (escopos `moderator:read:followers`, `channel:read:subscriptions`, `bits:read`). Emitir `follower-latest`, `subscriber-latest`, `cheer-latest`, `raid-latest` no formato do StreamElements.
- Avatares: `https://decapi.me/twitch/avatar/<login>` sem autenticação, ou `users` da Helix com o token.
- Live simultânea: os widgets já tratam `service` por evento, então um mesmo overlay pode receber as duas plataformas.

## 3. Múltiplas cenas e overlays

Hoje cada widget tem uma configuração. Permitir "perfis" (ex.: ilha para cena de jogo, ilha para cena de conversa) escolhidos por `?perfil=` na URL do overlay.

## 4. Painel de live

Números da transmissão em andamento: espectadores (`liveStreamingDetails.concurrentViewers` pela API oficial, exige OAuth do item 1 ou API key), mensagens por minuto, participantes únicos, Super Chats do dia. Uma aba no painel e, se quiser, um widget de estatísticas.

## 5. Comandos e automações

Reagir a comandos no chat (`!comando`) e a eventos: responder no chat (exige OAuth com escopo de escrita, `liveChatMessages.insert`), trocar cena no OBS via obs-websocket, disparar sons. Estrutura: `servidor-local/lib/regras.js` com gatilho → ação, configurável no painel.

## 6. Histórico

Guardar mensagens e eventos em SQLite (`node:sqlite` a partir do Node 22.5, sem dependência) para relatórios por live e busca. Só depois de definir retenção.

## Pendências menores

- `iniciar.bat` e `README` do servidor mencionam uso local; quando o VPS estiver no ar, apontar o OBS para `live.ravoque.com.br` e manter o local só como reserva.
- Tela de login mais amigável que o HTTP Basic (formulário + cookie), sem trocar o mecanismo por baixo.
- Testes automatizados do `parseAction` com respostas gravadas do YouTube, para detectar mudança de formato rapidamente.
