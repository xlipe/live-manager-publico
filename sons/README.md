# Botões de som

Widget invisível que toca áudio quando o Stream Manager pede. Cada botão é um
arquivo enviado pelo painel (Configurações → Sons) com nome e volume próprio; o
widget aplica ainda um volume geral.

- Evento: `onEventReceived` com `listener: "som"` e `event: { url, volume }`.
- Rota: `POST /api/som { id }` dispara o som `id` da lista em todos os overlays.
- Os arquivos ficam em `servidor-local/sounds/` (volume persistente na VPS).
