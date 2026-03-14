# Ghost Computer-Use Daemon
# Build : docker build -t ghost-daemon -f daemon/Dockerfile .
# Run   : docker run -p 9000:9000 -e MACHINE_ID=my-mac -e DAEMON_IMPL=stub ghost-daemon

FROM node:20-alpine

WORKDIR /app

# Copier uniquement le daemon (pas le cœur complet)
COPY daemon/ghost_daemon.js ./ghost_daemon.js
COPY daemon/package.json    ./package.json

# Pas de npm install car pas de dépendances externes
# (utilise uniquement les modules core Node.js)

ENV MACHINE_ID=daemon
ENV DAEMON_PORT=9000
ENV DAEMON_IMPL=stub
ENV NODE_ENV=production

EXPOSE 9000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://localhost:9000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "ghost_daemon.js"]
