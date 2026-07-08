FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package.json
COPY src src
COPY public public

EXPOSE 3000

CMD ["npm", "start"]
