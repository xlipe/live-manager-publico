# Telas de intervalo

Widget de tela inteira (1920x1080) que mostra **uma tela por vez**: título, subtítulo, template animado, imagem de fundo. No Live Manager cada **cena** (Volto já, Tá começando, e as que você criar) é um preset completo deste widget; ativar a cena recarrega o overlay com o preset dela. Fica na cena completa por cima da Dynamic Island e só aparece quando acionado.

## Como acionar

- No Stream Manager, cartão **Cenas**: Principal (sem tela) ou qualquer cena. Vale para todos os overlays abertos, na hora, e o estado persiste.
- Nos botões de teste do próprio widget (grupo "Pré-visualização").
- Por evento: `onEventReceived` com `listener: "tela"` e `event: { tela: "on" | "none" }`. É assim que o servidor avisa; ao conectar, o overlay recebe o estado atual.

## O que se configura em cada cena

Título, subtítulo (com distância e tamanho próprios), template animado, animação do texto, fonte do título (seletor com 31 fontes do Google, carregada na hora), cor principal, cor secundária, cor do texto, **legibilidade** (sombra suave, sombra projetada sem blur, sombra longa, placa escura, placa clara, contorno ou nada — com cor e distância da sombra), imagem de fundo com opacidade, tamanho do título e a **logo** (imagem, largura, posição livre em porcentagem, opacidade; padrão: ravoque em branco).

**Presets**: no editor da cena dá para salvar o visual (tudo menos título, subtítulo e imagem de fundo) com um nome, aplicar em qualquer cena e marcar um como padrão — cenas novas nascem com ele.

Camadas, de baixo para cima: template → imagem de fundo (com a opacidade escolhida) → texto. A imagem sempre fica atrás do texto.

## Templates

| id | visual |
|---|---|
| `gradiente` | as duas cores escorrendo em diagonal, com bolhas desfocadas |
| `ondas` | linha d'água feita por discos gigantes girando |
| `estrelas` | pontos subindo em três velocidades (posições sorteadas ao carregar) |
| `grade-retro` | synthwave: céu roxo com estrelas, sol laranja listrado, horizonte ciano e grade rosa rolando (paleta própria; a cor principal tinge o chão) |
| `neon` | moldura e letreiro neon piscando |
| `blocos` | metade de cor em diagonal deslizando, texto à esquerda |
| `minimal` | fundo liso, linhas finas, título espaçado |
| `glitch` | a tela inteira treme e inverte, barras de ruído, scanlines, separação RGB e título rasgado em fatias |

## Animações do texto

`pulsar`, `flutuar`, `deslizar` (entra e sai em loop), `digitando` (máquina de escrever, em JS), `glitch`, `saltando` (letra a letra), `brilho` (reflexo passando), `zoom`, `nenhuma`.

## Arquivos

`widget.html`, `widget.css`, `widget.js`, `widget.json` — formato de Custom Widget do StreamElements. Fontes do Google carregadas no HTML. Animações ficam pausadas nas telas escondidas para não gastar CPU no OBS.
