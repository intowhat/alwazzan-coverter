# converter-app

Node + Express base for the private converter app.

## Features
- Session login with static credentials
- Mobile-first futuristic UI
- Welcome banner for Bader
- File upload flow
- YouTube URL to MP3 flow
- Rolling retention of latest 5 converted files
- Download links for the retained 5 files

## Important
- Uploaded audio/video files are converted to MP3 with ffmpeg.
- YouTube URLs are downloaded with `yt-dlp` and converted to MP3 with ffmpeg.
- The Docker image installs `yt-dlp` and `ffmpeg` for Coolify deployment.

## Coolify deployment
Use `docker-compose.yml` as the source of truth.

- Internal app port: `3080`
- In Coolify, assign the domain `alwazzan.mishref.uk` to the `app` service and set the service port to `3080`
- Do not map host ports in Docker Compose; Coolify should proxy the domain to the container port
- Set these environment variables in Coolify:
  - `APP_USERNAME=bader`
  - `APP_PASSWORD=mp3!alsayegh`
  - `SESSION_SECRET=<long-random-secret>`

## Local development
```bash
npm install
npm start
```

Open:
- http://127.0.0.1:3080/login
