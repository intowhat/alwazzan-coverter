FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg yt-dlp

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3080

RUN mkdir -p storage/uploads storage/converted storage/data

EXPOSE 3080

CMD ["npm", "start"]
