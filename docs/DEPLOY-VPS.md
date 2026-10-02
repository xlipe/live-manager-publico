# Deploy em live.ravoque.com.br

Como o Live Manager roda em produção. A máquina é compartilhada com outros projetos; o Live Manager fica isolado na própria árvore e o Caddy (já existente na máquina) faz o HTTPS. Feito em 22/09/2026.

## Layout na máquina

```
/opt/ravoque/live-manager/
  docker-compose.yml   projeto `ravoque-live`, contêiner na 127.0.0.1:8787
  .env                 ADMIN_PASSWORD e OVERLAY_KEY (chmod 600, fora do código)
  src/                 espelho do repositório (o Dockerfile está na raiz)
  dados/config/        canal e configurações dos widgets (volume)
  dados/sounds/        sons enviados pelo painel (volume)
```

O `.env` e `dados/` ficam fora de `src/` de propósito: um novo deploy substitui o código inteiro sem tocar no que é seu.

## Atualizar o código

Da máquina de trabalho, com o clone do repositório:

```bash
rsync -az --delete --exclude .git \
  --exclude 'servidor-local/config/*.json' --exclude 'servidor-local/sounds/*' \
  ./ root@45.82.75.73:/opt/ravoque/live-manager/src/
ssh root@45.82.75.73 'cd /opt/ravoque/live-manager && docker compose build && docker compose up -d'
```

Logs: `docker logs -f ravoque-live`. Estado: `docker ps --filter name=ravoque-live`.

## docker-compose.yml

```yaml
name: ravoque-live

services:
  live:
    build:
      context: ./src
    image: ravoque-live:local
    container_name: ravoque-live
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:8787:8787"
    volumes:
      - /opt/ravoque/live-manager/dados/config:/app/servidor-local/config
      - /opt/ravoque/live-manager/dados/sounds:/app/servidor-local/sounds
    init: true
    mem_limit: 512m
    cpus: 1.0
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
```

O `name:` explícito importa: o Compose deriva o nome do projeto da pasta, e outras árvores da máquina também se chamam `src`. Sem ele, um `up` de um projeto derruba os contêineres do outro como "órfãos".

## Segredos

Gerados uma vez, na própria máquina:

```bash
cd /opt/ravoque/live-manager
printf "ADMIN_PASSWORD=%s\nOVERLAY_KEY=%s\n" "$(openssl rand -base64 18 | tr -d /+=)" "$(openssl rand -hex 24)" > .env
chmod 600 .env
```

Para trocar, edite o `.env` e `docker compose up -d`. Ao trocar a `OVERLAY_KEY`, as fontes de navegador do OBS precisam da URL nova.

## DNS e HTTPS

- DNS: registro **A** `live` → `45.82.75.73` na Cloudflare, com proxy **desligado** (nuvem cinza). Com o proxy da Cloudflare ligado, a conexão SSE dos overlays é cortada em cerca de 100 s.
- Caddy: bloco em `/opt/westca/caddy/Caddyfile`, acrescentado só depois do DNS resolver (antes disso o Let's Encrypt falha e a conta entra em rate limit):

```
live.ravoque.com.br {
	reverse_proxy 127.0.0.1:8787
}
```

Esse Caddyfile é bind mount de arquivo único: edite com `cat >>` ou editor que preserve o inode, confira `stat -c %i` no host e dentro do contêiner, e recarregue com `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`. Se os inodes divergirem, `docker restart caddy`. O SSE passa sem configuração extra; o Caddy não bufferiza respostas por padrão.

## Conferência

1. `https://live.ravoque.com.br/config` pede senha (401 sem ela) e abre o painel.
2. `https://live.ravoque.com.br/overlay/island` sem `?key=` retorna 403; com a chave, mostra a ilha.
3. `curl -N "https://live.ravoque.com.br/events?key=..."` mostra o `status` do leitor na hora.
4. No OBS, fontes de navegador 1920 x 1080 com as URLs completas (com `?key=`) que o painel mostra. "Controlar áudio via OBS" desmarcado.

## Backup

Tudo que é seu está em `/opt/ravoque/live-manager/dados/` e no `.env`. Um `tar` dessas duas coisas de tempos em tempos basta; o código volta do repositório.

## Alternativa sem Docker

Se um dia for rodar direto no sistema: Node 22, `node --env-file=.env server.js` dentro de `servidor-local/` sob um serviço systemd com `Restart=always`, e o mesmo bloco de proxy na frente. O servidor só usa módulos nativos, não há `npm install`.
