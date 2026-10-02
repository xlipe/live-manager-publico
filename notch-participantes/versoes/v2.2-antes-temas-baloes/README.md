# Dynamic Island

Widget para o StreamElements que ocupa a tela inteira (1920x1080) e contém a Dynamic Island no topo e, opcionalmente, o chat.

## Chat (experimental)

Em *Chat > Onde mostrar as mensagens* há três modos:

- **Dentro da Dynamic Island**: cada mensagem aparece na ilha, uma por vez, com avatar, nome e texto, por alguns segundos. Alertas têm prioridade e interrompem a mensagem; a fila continua depois. Mensagens de moderadores e membros ganham um leve degradê.
- **Balões em um canto da tela**: balões em cápsula com avatar, no canto escolhido, com limite e tempo de vida.
- **Não mostrar**: só participantes e alertas (equivale à versão anterior).

Um toque suave embutido pode tocar a cada mensagem (*Chat > Som a cada mensagem*), com intervalo mínimo entre toques. Dá para trocar por arquivo ou desligar.

A versão anterior, sem chat, está guardada em `versoes/v2.1-sem-chat/`.

## Tamanho do widget

Redimensione a caixa do widget no StreamElements para **1920 x 1080**, cobrindo o overlay inteiro. A ilha se posiciona sozinha no topo e o chat em balões no canto escolhido. Se usar o widget de chat em balão separado (pasta raiz do projeto), deixe o modo de chat aqui em "Não mostrar".

## A ilha tem dois estados.

- **Compacta**: avatares de quem falou no chat recentemente, contador e aviso de quem chegou.
- **Expandida**: quando acontece um evento no canal (novo inscrito, novo membro, Super Chat, doação; na Twitch também seguidor, bits e raid), a ilha cresce, mostra a foto grande, o título, o nome e a mensagem da pessoa, muda de cor, solta partículas e toca um som. Depois volta ao estado compacto. Vários eventos seguidos entram numa fila.

Funciona com YouTube e Twitch.

## Alertas

Cada tipo tem um grupo próprio no painel ("Alerta: ...") com liga/desliga, título, linha de baixo, cor e sons. Os textos aceitam `{name}`, `{amount}`, `{months}` e `{sender}`. Em *Alertas* ficam a duração, o volume, se a mensagem da pessoa aparece e o símbolo da moeda.

Para testar sem live: botões em *Pré-visualização* (novo inscrito, novo membro, Super Chat, doação) ou o menu **Emulate** do editor de overlay do StreamElements, que dispara os eventos reais de teste.

Sons: cada alerta já vem com um chime sintetizado embutido, diferente por tipo, então toca mesmo sem arquivo. Para usar um som seu, envie um ou mais arquivos em "Sons" do alerta desejado; o arquivo substitui o chime. Em *Alertas > Som embutido* dá para desligar o chime.

## Paletas

Em *Cores > Paleta de cores* há paletas prontas: Aurora (padrão, roxo e ciano), Sunset, Ocean, Mint, Candy, Gold, Mono, Glass (clara) e YouTube. A opção Personalizada libera os seletores de cor individuais. A cor de cada alerta é separada e fica no grupo do alerta.

## Formato

A ilha flutuante é sempre uma cápsula perfeita (raio igual à metade da altura, mesma proporção dos avatares). O campo de arredondamento só vale para o formato colado ao topo. No OBS, deixe "Controlar áudio via OBS" desmarcado para o som sair direto no Windows, como no widget de chat.

Quem só assiste sem escrever não aparece, porque o YouTube não informa quem está assistindo. Quem manda mensagem entra no notch e sai depois de um tempo sem falar.

## Arquivos

| Arquivo | Aba no editor do StreamElements |
|---|---|
| `widget.html` (ou `widget.html.txt`) | HTML |
| `widget.css` | CSS |
| `widget.js` | JS |
| `widget.json` | FIELDS |

A aba DATA fica vazia.

## Instalação

1. No mesmo overlay do chat (ou em outro), **+ → Static / Custom → Custom widget**.
2. Selecione o widget, **Settings → Open Editor**, cole cada arquivo na aba correspondente, **Done**, **Save**.
3. Redimensione a caixa do widget para 1920 x 1080, cobrindo o overlay inteiro.
4. Desligue *Pré-visualização > Modo de pré-visualização* quando terminar de ajustar.

## O que faz

- **Avatares** de quem falou, com anel na cor do cargo (dono, moderador, membro, espectador) e ícone pequeno de cargo. Sem foto, mostra um círculo colorido com a inicial do nome.
- **Quem fala de novo** dá um quique e vai para a frente da fila.
- **Quem fica X minutos sem falar** sai com animação (padrão 10 minutos).
- **Contador** de participantes e um **aviso** "Fulano chegou" que expande o notch por alguns segundos quando alguém novo aparece.
- **Brilho animado** na borda e ponto "ao vivo" pulsando, ambos na cor de destaque (vermelho do YouTube por padrão).
- Formato colado no topo (notch) ou ilha flutuante; posição centro, esquerda ou direita.
- Ignora bots, comandos com `!` e o histórico reenviado ao recarregar.

## Fotos de perfil

No YouTube, o StreamElements nem sempre envia a foto do canal junto com a mensagem. Quando envia, o widget usa. Quando não, aparece a inicial colorida. Na Twitch a foto é buscada pelo nome de usuário.
