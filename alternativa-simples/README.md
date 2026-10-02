# Chat em bolhas para YouTube (StreamElements)

Widget customizado do StreamElements que mostra o chat do YouTube em bolhas estilo mensageiro, com painel de configurações direto no editor do overlay.

## Arquivos

| Arquivo | Aba no editor do StreamElements |
|---|---|
| `widget.html` | HTML |
| `widget.css` | CSS |
| `widget.js` | JS |
| `widget-fields.json` | FIELDS |

A aba DATA pode ficar vazia.

## Instalação

1. Acesse **streamelements.com** → **Streaming Tools** → **My Overlays** → **New Overlay**.
2. Escolha a resolução (1080p) e clique em **Start**.
3. Clique no **+** → **Static / Custom** → **Custom widget**.
4. Com o widget selecionado, no painel da esquerda clique em **Open Editor**.
5. Cole o conteúdo de cada arquivo na aba correspondente (HTML, CSS, JS, FIELDS).
6. Clique em **Done** e depois em **Save** no topo.
7. Feche e reabra o painel do widget: agora aparece a seção **Settings** com os grupos Bolha, Texto, Nick, Destaque, Som, Filtros e Comportamento.
8. Redimensione o widget no canvas para a área onde o chat deve aparecer.
9. Copie a URL do overlay (botão de link no topo) e adicione no OBS como **Browser Source**.

## O que dá para configurar

- **Bolha**: cor de fundo, cor do texto, arredondamento, largura máxima, espaço entre bolhas e lado (esquerda, direita ou alternando).
- **Texto**: fonte do Google Fonts e tamanho.
- **Nick**: cor fixa, cor enviada pelo YouTube ou cor por cargo (dono, moderador, membro). Fundo atrás do nick e badges.
- **Destaque**: palavras-chave que trocam a cor da bolha (ex.: o nome do canal para pegar menções).
- **Som**: upload do arquivo, volume, quando tocar (toda mensagem, só destacadas ou nunca) e intervalo mínimo entre sons.
- **Filtros**: lista de usuários ignorados (Nightbot, StreamElements, etc.) e prefixos ignorados (ex.: `!` para esconder comandos).
- **Comportamento**: máximo de bolhas na tela e tempo até sumirem.

## Testando

No editor do overlay, use o botão **Emulate** (ou a aba de chat de teste) e envie uma mensagem. Ela deve aparecer como bolha e o som deve tocar. Mensagens apagadas por moderadores somem do widget automaticamente.

## Observações

- O seletor de cor do StreamElements aceita transparência, então dá para deixar a bolha semitransparente.
- Nomes na lista de ignorados não diferenciam maiúsculas de minúsculas e podem ter `@` na frente.
- O som pode não tocar na prévia do navegador até você clicar na página. No OBS toca normalmente.
- Para ligar o chat do YouTube ao StreamElements, a conta do YouTube precisa estar conectada em **streamelements.com/dashboard/account/channels**.
