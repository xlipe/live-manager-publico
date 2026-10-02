# Live Manager em contêiner. O servidor não tem dependências: basta copiar a
# árvore e rodar. `config/` e `sounds/` devem ser montados como volumes para
# sobreviverem ao rebuild. Publique a porta só no loopback e deixe o proxy
# HTTPS (Caddy/Nginx) na frente.
FROM node:22-alpine
WORKDIR /app
COPY . .
WORKDIR /app/servidor-local
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "server.js"]
