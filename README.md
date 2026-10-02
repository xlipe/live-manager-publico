# Live Manager

Gerenciador de live do canal, hospedado em `live.ravoque.com.br`. Lê o chat da transmissão direto do YouTube (e também da Twitch e do Kick, sem login), serve os overlays para o OBS e centraliza a configuração em uma página web. Feito para receber novos módulos com o tempo.

## O que tem hoje

| Pasta | O que é |
|---|---|
| `servidor-local/` | Servidor Node (sem dependências) que lê o chat, emula os eventos do StreamElements para os widgets, serve os overlays e a página de configuração. É o núcleo do Live Manager. |
| `telas/` | Widget **Telas de intervalo**: uma cena por vez (Volto já, Tá começando e as que você criar), tela inteira, com 8 templates animados, 9 animações de texto, cores, fonte, logo posicionável e imagem de fundo com opacidade. Trocadas no Stream Manager. |
| `sons/` | Widget **Botões de som**: invisível, toca o áudio que o Stream Manager manda. |
| `notch-participantes/` | Widget **Dynamic Island**: cápsula no topo da tela com participantes do chat, mensagens uma a uma, e alertas expandidos (inscrito, membro, Super Chat, doação) com som. |
| Raiz (`widget.*`) | Widget **Chat em balão**: chat em bolhas, derivado do Chat Bubbles do Zaytri e adaptado para YouTube. Referência e uso direto no StreamElements; o servidor não o serve, porque a Dynamic Island já tem o chat (na ilha ou em balões) como opção. |
| `alternativa-simples/` | Versão mínima e independente do chat em balão. Referência, não usada em produção. |
| `docs/` | Arquitetura, deploy no VPS, roteiro de módulos e documentação dos widgets. |

Os widgets seguem o formato de Custom Widget do StreamElements (HTML, CSS, JS e FIELDS). Isso é proposital: eles funcionam tanto no servidor próprio quanto colados no StreamElements, e a página de configuração é gerada a partir do FIELDS.

## Rodando

Requisitos: Node 20 ou superior. Nenhuma dependência para instalar.

```bash
cd servidor-local
node server.js
```

Abra `http://localhost:8787/config` (Stream Manager para operar a live; Configurações para servidor, cenas e widgets), informe o `@` do canal e aponte uma fonte de navegador do OBS para `/overlay/cena` em 1920 x 1080. Onde o chat aparece (dentro da ilha, em balões num canto, ou oculto) se escolhe na aba da Dynamic Island, em "Chat > Onde mostrar as mensagens".

Em servidor público, defina `ADMIN_PASSWORD` e `OVERLAY_KEY` (veja `servidor-local/.env.example`) e rode atrás de um proxy HTTPS. Passo a passo em [docs/DEPLOY-VPS.md](docs/DEPLOY-VPS.md).

## Documentação

- [Arquitetura e contrato de eventos](docs/ARQUITETURA.md)
- [Deploy em live.ravoque.com.br](docs/DEPLOY-VPS.md)
- [Roteiro de módulos](docs/ROADMAP.md)
- [Widget Chat em balão](docs/WIDGET-CHAT-BALAO.md)
- [Widget Dynamic Island](notch-participantes/README.md)
- [Servidor](servidor-local/README.md)

## Créditos e licença

O widget Chat em balão deriva do [Chat Bubbles](https://github.com/TessavWalstijn/se.zaytri-widgets) de Zaytri, adaptado para YouTube. O restante (servidor, painel, Dynamic Island, telas e sons) é original e está sob licença MIT. Detalhes em [LICENSE](LICENSE).
