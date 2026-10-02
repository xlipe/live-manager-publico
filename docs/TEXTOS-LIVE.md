# Textos do módulo de live — para revisão do Filipe

Rascunho de 23/09/2026. Quando aprovado: o e-mail vai para `src/server/email.ts`
do runiverse (nova função `convidarDaLive`), e os trechos de termos e
privacidade entram nas páginas `/termos` e `/privacidade`, com a data
atualizada. Nada disto está publicado ainda.

---

## 1. E-mail de convite da live

**Assunto:** `você pediu, tá aqui: seu convite pro ravoque`

**Cabeçalho (moldura padrão dos e-mails da casa, com a logo)**

> **tem um lugar aqui pra você, {nome}**
>
> Você estava na live, mandou seu e-mail no chat e disse SIM. Eu olhei, e é
> isso: o ravoque é uma casa fechada, entra quem foi chamado — e você acabou de
> ser.
>
> O link aqui embaixo é só seu: escolhe usuário e senha e pronto, você tá
> dentro. Não tem fila de aprovação pra quem veio da live.
>
> **[ criar minha conta ]** ← botão roxo, o padrão da casa
>
> Do outro lado tem os assuntos — as conversas da casa —, as memórias que a
> turma foi juntando e um perfil pra você deixar com a sua cara. E quando você
> aparecer no chat de novo, a live vai te reconhecer.
>
> **A live também tem canal no WhatsApp**: aviso de quando eu entro ao vivo,
> bastidor e o que não cabe no chat.
>
> **[ 💬 entrar no canal do WhatsApp ]** ← botão verde (`#25D366`), texto branco,
> mesmo formato do botão roxo, um pouco abaixo
>
> Vale por {dias} dias e funciona uma vez só. Se der o prazo, aparece na live e
> pede de novo que sai outro na hora.
>
> *(caixa cinza)* se o botão não abrir, cola isto no navegador: {url}

**Rodapé (miúdo):** Você recebeu isto porque digitou seu e-mail no chat da live
do ravoque e confirmou com SIM em {data e hora}. Se não foi você, ignora e
pronto: sem o cadastro, o e-mail some do nosso lado em 30 dias. E a qualquer
hora, na live, `!sair` apaga tudo que temos sobre você.

> Observações minhas: (1) o "{nome}" aqui é o nome público do YouTube, porque
> ainda não temos o nome real — se preferir, tiro o nome e fica só "tem um
> lugar aqui pra você"; (2) os 30 dias do rodapé são a retenção de convite não
> usado que proponho abaixo, item 2.3.

---

## 2. Política de Privacidade — o que entra

Data no topo passa para a data da publicação. Trechos novos:

### 2.1 Novo item em "1. O que a gente guarda"

> **Se você apareceu na live:** o chat da live é do YouTube e é público — quem
> escreve ali está falando pra todo mundo. O que a gente guarda do chat é o
> que já é público: sua conta do YouTube (o identificador e o nome que você
> usa lá), sua foto, se você é membro ou moderador, quando apareceu e quantas
> mensagens mandou. Mais duas coisas nossas: as **notas** que quem administra
> escreve por conta própria pra lembrar de você ("é o que joga de Jett",
> "pediu a música da intro"), e uma **pontuação** por participar, quando ela
> existir. Nome, sobrenome e e-mail **não** entram sozinhos — só como está na
> seção "a live" abaixo.

### 2.2 Nova seção "A live, o chat e a gente" (entra depois de "quem vê o que você publica")

> **O que entra sozinho.** O que está no parágrafo acima, e só. É o mínimo pra
> live funcionar: mostrar quem está no chat na tela, contar mensagens, e
> quem administra saber com quem está falando. A base legal disso é o nosso
> interesse legítimo em operar a live — e o dado é público desde a origem.
>
> **O que só entra se você pedir.** Se você mandar seu e-mail no chat, a
> conta do canal te responde na hora pedindo pra você digitar **SIM**. Só
> com o SIM, em até um minuto, o e-mail é guardado — junto com a hora e a
> mensagem exata em que você disse sim, porque isso é a prova de que foi
> você. Sem o SIM, o e-mail é apagado no minuto seguinte, como se nunca
> tivesse sido escrito. Com o SIM, quem administra olha sua ficha e decide se
> manda o convite; se decidir que não, o e-mail é apagado na hora e fica só o
> que era público.
>
> **Seu nome.** Não tiramos nome de lugar nenhum: nem do YouTube, nem do
> e-mail. Se um dia aparecer um nome na sua ficha, é porque você criou seu
> perfil aqui na casa e ele veio de lá.
>
> **A sua ficha e o seu perfil.** Quem entra na casa pelo convite da live tem
> a ficha da live ligada ao perfil daqui — é a mesma pessoa, e a gente trata
> como uma só. Quem já era da casa e aparece no chat também. É isso que
> permite reconhecer você na live e, no futuro, te dar recompensa visual no
> perfil (moldura, selo) pelo que você participou.
>
> **Sair.** Digita `!sair` no chat e a conta do canal apaga tudo que tem
> sobre você por lá: ficha, notas, e-mail, pontos. Na hora, e te responde
> dizendo que apagou. Isso não apaga sua conta na casa — pra isso o botão
> continua em "sua conta".
>
> **Quanto tempo fica.** A ficha de quem só apareceu no chat fica enquanto a
> live existir, porque é o que faz a gente reconhecer quem volta — e nela não
> tem nada além do público e das notas de quem administra. E-mail que deu SIM
> mas nunca criou conta some em 30 dias. Quem criou conta segue a regra da
> conta.
>
> **O que a conta do canal faz por conta própria.** As respostas automáticas
> do chat (o pedido de SIM, a confirmação, o "apaguei") saem da conta do
> canal no YouTube, pelo nosso sistema. Não tem robô conversando com você
> além disso, e não tem mensagem privada.

### 2.3 Acréscimo em "4. Quem mais encosta nisso"

> Na live, o **YouTube (Google)** entra na conta: o chat é deles, e a gente
> lê pela mesma porta que a página do chat usa. Pra saber quantas pessoas
> estão assistindo, quem se inscreveu e pra mandar as respostas
> automáticas, a conta do canal fica conectada ao Google com autorização do
> dono do canal — é a conta dele que autoriza, não a sua. Os dados do chat
> ficam na nossa máquina, na mesma casa do resto.

### 2.4 Acréscimo em "5. O que é seu (LGPD)"

> Da live vale o mesmo: acesso, correção, exportação e exclusão, e o `!sair`
> é o caminho rápido pra exclusão. Se você quiser ver o que a ficha da live
> tem sobre você — inclusive as notas —, pede que a gente mostra.

---

## 3. Termos de Uso — o que entra

### 3.1 Nova seção "9. A live" (antes de "mudanças e contato", que vira 10)

> A live acontece no YouTube, e lá valem as regras deles. O chat é público:
> o que você escreve aparece pra quem está assistindo e pode aparecer na
> tela da transmissão, com seu nome e sua foto do YouTube.
>
> Da live pra casa tem uma porta: mandou seu e-mail no chat e disse SIM, quem
> administra olha e, se fizer sentido, manda um convite. Quem entra por ele
> entra direto, sem outra fila — a live foi a apresentação. Convite é pessoal, vale uma vez, e passar pra outra pessoa
> é o mesmo que entregar sua vaga.
>
> Participar da live vai contar pontos. Eles são da casa, não têm valor em
> dinheiro, não se transferem e podem mudar de regra (a gente avisa). Servem
> pra reconhecimento dentro da casa — selo, moldura, o que inventarmos — e
> podem ser zerados em caso de abuso: mensagem repetida em massa, robô, ou
> qualquer coisa que faça o chat pior pra quem está lá.
>
> As respostas automáticas do chat vêm da conta do canal e são só o que está
> escrito na política de privacidade. Comandos como `!sair` fazem o que dizem
> e mais nada.

### 3.2 Ajuste em "8 → 10. Mudanças e contato"

Acrescentar uma linha: *"O que mudou nesta versão está no fim da página, com a
data."*

---

## 4. Rodapé das duas páginas — "o que mudou"

Você pediu pra informar as atualizações. Proponho um bloco fixo no fim de cada
página, em miúdo:

> **O que mudou**
> - **{data}** — a live entrou: o que a gente guarda do chat do YouTube, o SIM
>   pro e-mail, as notas de quem administra, o `!sair`, a conta do canal
>   conectada ao Google, e os pontos que ainda vêm.
> - **05/09/2026** — versão anterior.

---

## 5. Respostas automáticas no chat (já estão no painel, editáveis)

- **Pedido:** Opa, {nome}! Parece que você quer fazer parte da turma! Digita
  SIM pra consentir com o registro do seu e-mail e pra receber um e-mail de
  convite pra nossa rede 💜
- **Confirmação:** Fechado, {nome}! Registrei aqui. Vou dar uma olhada e, se
  estiver tudo certo, o convite chega no seu e-mail 📬 Se mudar de ideia, é só
  digitar !sair que eu apago tudo.
- **Saída:** Feito, {nome}: apaguei tudo que eu tinha sobre você por aqui.

---

## Decisões embutidas neste rascunho (confirma ou muda)

1. Retenção de **30 dias** pra e-mail confirmado que nunca virou conta.
2. Catraca **antes** do convite: quem diz SIM entra na fila do CRM, você aprova
   ou recusa; aprovado recebe o convite e entra na rede sem outra fila lá.
3. Pontos: aviso genérico agora ("vai contar pontos"), regra detalhada quando
   existir.
4. O e-mail usa o **nome público do YouTube** no cumprimento (ou tiro).
5. WhatsApp entra **só no e-mail de convite**, não nos termos.
