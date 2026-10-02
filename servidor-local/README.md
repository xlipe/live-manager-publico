# Servidor local dos widgets (sem StreamElements)

Programa em Node que roda no PC da live, lê o chat do YouTube direto e serve os widgets para o OBS. Os widgets são os mesmos das pastas do projeto; nada muda neles.

## O que faz

- **Lê o chat da live** pelo mesmo caminho interno que a página do chat do YouTube usa. Sem API key, sem login, atraso de 1 a 3 segundos. Entrega mensagens, Super Chats, novos membros e presentes de membro, com foto de perfil, emojis e cargos (dono, moderador, membro, verificado).
- **Emula o StreamElements** para os widgets: dispara os mesmos eventos (`message`, `superchat-latest`, `sponsor-latest`) no mesmo formato, então a Dynamic Island e o chat em balão funcionam sem alteração.
- **Página de configuração** em `http://localhost:8787/config`: substitui o painel do StreamElements, gerada a partir do FIELDS de cada widget. Tem prévia ao vivo, upload de sons, botões de teste e emulação de eventos.
- **Reconecta sozinho** quando a live começa, cai ou termina.

## O que não faz (ainda)

- **Novo inscrito no canal**: não passa pelo chat. Exige a API oficial do YouTube com login Google e chega com atraso. Pode ser adicionado depois. O botão de teste existe para você ver o alerta.
- Twitch: o leitor é só do YouTube por enquanto. A estrutura aceita um segundo leitor.

## Instalação

1. Node.js: coloque a versão portátil em `runtime\node.exe` (pasta `runtime` dentro desta), ou instale o Node.js normal pelo site nodejs.org.
2. Dê dois cliques em `iniciar.bat`. Abre a página de configuração no navegador e deixa uma janela preta aberta (é o servidor; feche para parar).
3. Na aba **Servidor e live**, informe o `@` do canal e clique em Conectar. Com a live no ar, o status fica "conectado".
4. No OBS, crie duas fontes de navegador com 1920 x 1080:
   - `http://localhost:8787/overlay/island`
   Deixe "Controlar áudio via OBS" desmarcado para o som sair direto no Windows.
5. Configure cada widget na aba dele. Salvar recarrega o overlay no OBS automaticamente.

## Pastas

- `config/` — configurações salvas (canal e valores dos campos de cada widget).
- `sounds/` — sons enviados pela página de configuração.
- `lib/youtube.js` — leitor do chat. Se o YouTube mudar o formato interno, é aqui que se ajusta.

## Aviso

O leitor usa um caminho interno do YouTube, não a API oficial. Funciona como a própria página do chat, mas o YouTube pode mudar o formato sem aviso, e aí o leitor precisa de ajuste. O servidor mostra o erro na página de configuração quando isso acontece.
