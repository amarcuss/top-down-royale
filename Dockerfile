# Game server for Top-Down Royale online play. Build from the repository root:
#   docker build -t tdr-server . && docker run -p 8787:8787 tdr-server
FROM node:22-alpine
WORKDIR /app
RUN npm install --omit=dev --no-audit --no-fund ws@8
COPY index.html privacy.html style.css manifest.webmanifest ./
COPY icons ./icons
COPY js ./js
COPY server ./server
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server/server.js"]
