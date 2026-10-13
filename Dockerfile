FROM mcr.microsoft.com/playwright:v1.64.0-noble
WORKDIR /app
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev
COPY public ./public
COPY server ./server
EXPOSE 3000
CMD ["node","server/index.js"]
