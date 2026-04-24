# converter-app

Node + Express base for the private converter app.

## Features
- Session login with static credentials
- Mobile-first futuristic UI
- Welcome banner for Bader
- File upload flow
- YouTube/TikTok URL to MP3 flow
- Background conversion jobs with shallow progress bars
- Rolling retention of latest 5 converted files
- Download links for the retained 5 files

## Important
- Uploaded audio/video files are converted to MP3 with ffmpeg in the background.
- YouTube and TikTok URLs are detected by domain, downloaded with `yt-dlp`, and converted to MP3 in the background.
- Jobs are tracked in persistent JSON metadata and shown in the UI with a shallow progress bar.
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
