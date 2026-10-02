# Dynamic Chat Bubbles — cópia adaptada para YouTube

Cópia do widget **Chat Bubbles v2.11.0** criado por **Zaytri** (twitch.tv/zaytri), adaptada para funcionar com o chat do **YouTube** via StreamElements.

O repositório original (`github.com/zaytri/stream-elements-widgets`) foi removido. Esta cópia foi feita a partir do espelho público `github.com/TessavWalstijn/se.zaytri-widgets`. Todo o crédito do design e da lógica é do Zaytri.

## Arquivos

| Arquivo | Aba no editor do StreamElements |
|---|---|
| `widget.html` | HTML |
| `widget.css` | CSS |
| `widget.js` | JS |
| `widget.json` | FIELDS |

A aba DATA fica vazia.

## Instalação

1. Acesse **streamelements.com** → **Streaming Tools** → **My Overlays** → **New Overlay**.
2. Escolha 1080p e clique em **Start**.
3. Clique no **+** → **Static / Custom** → **Custom widget**.
4. Com o widget selecionado, clique em **Open Editor** no painel da esquerda.
5. Cole o conteúdo de cada arquivo na aba correspondente (HTML, CSS, JS, FIELDS).
6. Clique em **Done** e depois em **Save**.
7. Feche e reabra o painel do widget. As configurações aparecem em grupos: Pré-visualização, Estilo das bolhas, Tamanho, Posição, Estilo do texto, Cores personalizadas, Badges, Emotes, Filtros, Tempo e Sons.
8. Com o **Modo de pré-visualização** ligado, o widget mostra uma caixa pontilhada com instruções. Arraste e redimensione essa caixa para definir a área onde as bolhas aparecem. Depois desligue o modo de pré-visualização.
9. Copie a URL do overlay e adicione no OBS como **Browser Source** com 1920 x 1080.

## O que dá para configurar

- **Cor das bolhas**: em *Cores personalizadas*, ligue "Usar cores personalizadas de fundo/texto" e escolha a cor de fundo e do texto. Sem isso, a bolha usa modo claro ou escuro.
- **Cor de destaque do nick**: em *Cores personalizadas*, ligue "Usar cores personalizadas de borda/nick". A cor da borda vira a cor da caixa do nick, e "Cor do nick" é a cor do texto do nome. Sem isso, cada usuário ganha uma cor própria gerada pelo nome (o YouTube não envia cor de usuário).
- **Som de alerta**: em *Sons*, envie um ou mais arquivos no "Grupo 1 — Sons". Cada grupo pode tocar só para membros, moderadores ou usuários específicos, e só para um tipo de mensagem. O widget escolhe um som aleatório do grupo.
- **Usuários ignorados**: em *Filtros de bots*, "Ignorar estes usuários". Também dá para ignorar mensagens que começam com `!`.
- **Mensagem destacada**: em *Estilo das bolhas*, "Palavras que destacam a mensagem". Coloque o nome do seu canal para que menções apareçam com a bolha arco-íris.
- **Temas**: Balão de chat (padrão, cantos bem redondos), Original, Animal Crossing, Windows 98 e Windows XP. No tema Balão dá para ajustar o arredondamento, a posição do nick (dentro do balão ou como pílula acima), o rabinho (desligado por padrão) e a espessura da borda.
- **Pílula do nick**: por padrão o nick e a insígnia ficam numa pílula vermelha (vermelho do YouTube) com texto e ícones brancos, sobreposta à borda de cima do balão branco. As insígnias de cargo são ícones próprios em branco (coroa para o dono do canal, chave inglesa para moderador, estrela para membro). Dá para trocar a cor fixa, usar a cor de cada usuário, ou usar as insígnias originais do YouTube.
- **Balão cintilante por cargo**: moderadores, membros do canal e o dono do canal recebem um balão com gradiente rosa/azul/verde clarinho em movimento e um brilho passando. Em *Balão cintilante para* você escolhe se vale para moderadores, membros, os dois ou ninguém.
- **Balão colorido (arco-íris)**: aparece só em mensagens "destacadas". No YouTube isso acontece quando a mensagem contém uma das palavras em *Estilo das bolhas > Palavras que destacam a mensagem* (vazio por padrão, então nenhum balão fica colorido até você preencher). Para nunca colorir, mude *Estilo da mensagem destacada* para Normal.
- **Posição e alinhamento**: lista (de baixo, de cima, horizontal) ou posição aleatória na tela, como no widget original. Em *Posição das bolhas > Alinhamento do widget* você escolhe esquerda, centro ou direita, e no tema Balão a pílula do nick e o texto acompanham o lado.
- **Som sem cortar o início**: os sons são pré-carregados ao abrir o widget, e um áudio quase silencioso fica em loop para o dispositivo de saída não "dormir" (*Sons > Manter áudio ativo*, ligado por padrão). No OBS, marque "Controlar áudio via OBS" na fonte de navegador para o som aparecer no mixer, ou deixe desmarcado para ele sair direto no dispositivo padrão do Windows.
- **Rajada ao recarregar**: ao carregar ou dar F5, o StreamElements reenvia as últimas mensagens do chat. Por padrão o widget descarta mensagens anteriores ao carregamento (*Tempo > Ignorar mensagens antigas ao carregar*).
- **Atraso**: *Tempo > Atraso até aparecer* aceita 0 no modo Lista (o original obrigava 1 segundo). O YouTube em si entrega as mensagens com alguns segundos de atraso, e isso o widget não controla.

## Diferenças em relação ao original

- Tema novo **Balão de chat**, agora o padrão: os temas originais são caixas com cantos pouco arredondados; este tem formato de balão de mensageiro.
- Detecção de **dono, moderador e membro** pelos dados do YouTube (badges com nomes diferentes da Twitch e flags do autor). "Membros" substitui "Subscribers" nos rótulos.
- **Destaque por palavra-chave**, já que o YouTube não tem a "mensagem destacada" da Twitch.
- Rótulos do painel traduzidos para **português**. As chaves internas continuam iguais às do original, então o CSS e o JS são compatíveis.
- Pronomes, seguidores, raids e VIPs continuam no código, mas só funcionam na Twitch. Estão marcados como "(só Twitch)" no painel.
- Correções pequenas: a API de pronomes não quebra mais o widget se estiver fora do ar, emotes sem imagem em 4x usam o tamanho menor, e nomes de usuário são escapados antes de virar HTML.

## Testando

Use o botão **Enviar mensagem de teste** no grupo *Pré-visualização*, ou deixe o modo de pré-visualização ligado: a cada mudança de configuração o widget dispara cinco bolhas de teste. Mensagens apagadas por moderadores somem do widget.

## Observações

- O som pode não tocar na prévia do navegador até você clicar na página. No OBS toca normalmente.
- O atraso mínimo de 1 segundo é necessário para o cálculo de posição e tamanho da bolha.
- Para ligar o chat do YouTube ao StreamElements, a conta do YouTube precisa estar conectada em **streamelements.com/dashboard/account/channels** e a live precisa estar ativa.
- A pasta `alternativa-simples/` tem uma versão mais simples e independente, feita do zero, caso você prefira algo mais leve.

## Fontes

- Espelho do código original: https://github.com/TessavWalstijn/se.zaytri-widgets
- Site do Zaytri: https://zaytri.com/
- Tutorial original em vídeo (inglês): https://youtu.be/RbG10UmKaqM
