# Prenosljiva slika za katerikoli container gostitelj (Fly.io, Railway, VPS ...).
FROM node:22-slim

WORKDIR /app

# najprej odvisnosti (boljše predpomnjenje sloja)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# baza in naložene fotografije naj gredo na priklopljen volumen /data
ENV NODE_ENV=production \
    DB_FILE=/data/invazivke.db \
    UPLOAD_DIR=/data/uploads \
    PORT=3000
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
