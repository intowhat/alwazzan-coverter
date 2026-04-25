const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const compression = require('compression');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { cleanupUpload } = require('./lib/converter');
const {
  UPLOADS_DIR,
  CONVERTED_DIR,
  DATA_DIR,
} = require('./lib/store');
const { enqueueUploadJob, enqueueYoutubeJob, listJobs } = require('./lib/jobs');

const app = express();
const PORT = Number(process.env.PORT || 3080);
const HOST = process.env.HOST || '0.0.0.0';
const APP_USERNAME = process.env.APP_USERNAME || 'bader';
const APP_PASSWORD = process.env.APP_PASSWORD || 'mp3!alsayegh';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const SITE_TITLE = 'Future Converter';

app.set('trust proxy', 1);

const upload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
  filename: (_req, file, cb) => cb(null, createFileName(file.originalname)),
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", 'data:', 'https://images.unsplash.com'],
      "style-src": ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      "font-src": ["'self'", 'https://fonts.gstatic.com', 'data:'],
      "script-src": ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new FileStore({
    path: path.join(DATA_DIR, 'sessions'),
    ttl: 60 * 60 * 12,
    retries: 1,
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 1000 * 60 * 60 * 12,
  },
}));
app.use('/static', express.static(path.join(__dirname, '../public')));
app.use('/downloads', express.static(CONVERTED_DIR, {
  index: false,
  fallthrough: false,
}));

function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.redirect('/login');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bytesToSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 0; i < units.length - 1 && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i + 1];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function renderPage({ title, content, message = '' }) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="/static/styles.css" />
      <script src="/static/app.js" defer></script>
    </head>
    <body>
      <div class="bg-layer bg-layer--far"></div>
      <div class="bg-layer bg-layer--mid"></div>
      <div class="bg-layer bg-layer--near"></div>
      <main class="shell">
        ${message ? `<div class="flash">${escapeHtml(message)}</div>` : ''}
        ${content}
      </main>
    </body>
  </html>`;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, app: SITE_TITLE, now: new Date().toISOString() });
});

app.get('/login', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/');
  const content = `
    <section class="auth-card glass">
      <div class="eyebrow">Secure access</div>
      <h1>${SITE_TITLE}</h1>
      <p class="muted">Private converter portal. Sign in to continue.</p>
      <form method="post" action="/login" class="stack">
        <label>
          <span>Username</span>
          <input name="username" autocomplete="username" required />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button type="submit">Enter</button>
      </form>
    </section>`;
  res.send(renderPage({ title: `${SITE_TITLE} · Login`, content, message: req.query.error || '' }));
});

app.post('/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const ok = timingSafeEqual(username, APP_USERNAME) && timingSafeEqual(password, APP_PASSWORD);
  if (!ok) return res.redirect('/login?error=Wrong+credentials');
  req.session.authenticated = true;
  return res.redirect('/');
});

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', requireAuth, (req, res) => {
  const jobs = listJobs();
  const latestCards = jobs.length
    ? jobs.map((job, index) => `
      <article class="job-card glass" data-job-card>
        <div class="job-card__top">
          <div>
            <div class="file-rank">0${index + 1} · ${escapeHtml(job.type)}</div>
            <h3>${escapeHtml(job.originalName || (job.type === 'youtube' ? 'Video URL → MP3' : job.label))}</h3>
          </div>
          <span class="chip chip--${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
        </div>
        ${job.size ? `<p class="muted">${bytesToSize(job.size)}</p>` : ''}
        <p class="muted">${escapeHtml(job.progressLabel || 'Queued')}</p>
        <div class="progress"><span style="width:${Number(job.progress || 0)}%"></span></div>
        ${job.error ? `<p class="error-text">${escapeHtml(job.error)}</p>` : ''}
        ${job.storedName ? `<a class="link-btn" href="/file/${encodeURIComponent(job.id)}">Download MP3</a>` : ''}
      </article>
    `).join('')
    : '<div class="empty glass">No conversions yet. Start the first one.</div>';

  const content = `
    <section class="hero glass">
      <div class="eyebrow">Private conversion portal</div>
      <h1>welcome bader, what are we converting today?</h1>
      <p class="muted">Mobile-first, locked down, and keeping only your latest 5 converted files live.</p>
      <form method="post" action="/logout"><button class="ghost" type="submit">Log out</button></form>
    </section>

    <section class="tool-grid">
      <section class="upload-card glass">
        <div>
          <h2>Upload a file</h2>
          <p class="muted">Drop audio or video here and it’ll convert to MP3 before landing in the rolling latest-5 list.</p>
        </div>
        <form method="post" action="/convert" enctype="multipart/form-data" class="stack">
          <label class="upload-zone" data-upload-zone>
            <input type="file" name="file" accept="audio/*,video/*" required data-file-input />
            <span class="upload-zone__title">Click to choose a file or drag it here</span>
            <small class="upload-zone__meta" data-file-label>Audio or video • Max 100MB • Output: MP3</small>
          </label>
          <button type="submit">Convert to MP3</button>
        </form>
      </section>

      <section class="upload-card glass">
        <div>
          <h2>Video URL to MP3</h2>
          <p class="muted">Paste a YouTube or TikTok link and the app will detect the platform, pull audio, convert it to mp3, and store it in the latest-5 list.</p>
        </div>
        <form method="post" action="/convert/youtube" class="stack">
          <label>
            <span>YouTube or TikTok URL</span>
            <input type="url" name="youtubeUrl" placeholder="https://www.youtube.com/watch?v=... or https://www.tiktok.com/..." inputmode="url" required />
          </label>
          <button type="submit">Fetch and convert to MP3</button>
        </form>
      </section>
    </section>

    <section class="files-section">
      <div class="section-head">
        <h2>Latest 5 conversions</h2>
        <span class="chip">Queue + retention</span>
      </div>
      <div class="file-grid" data-jobs-root>${latestCards}</div>
    </section>`;

  res.send(renderPage({ title: SITE_TITLE, content, message: req.query.message || '' }));
});

app.post('/convert', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.redirect('/?message=No+file+uploaded');

  try {
    enqueueUploadJob(req.file);
    return res.redirect('/?message=Upload+queued.+We%E2%80%99ll+convert+it+to+MP3+in+the+background.');
  } catch (error) {
    await cleanupUpload(req.file.path);
    return res.redirect('/?message=' + encodeURIComponent(`Queueing failed: ${error.message}`));
  }
});

app.post('/convert/youtube', requireAuth, async (req, res) => {
  const youtubeUrl = String(req.body?.youtubeUrl || '').trim();
  if (!youtubeUrl) return res.redirect('/?message=No+YouTube+URL+provided');

  try {
    enqueueYoutubeJob(youtubeUrl);
    return res.redirect('/?message=Video+URL+job+queued.+We%E2%80%99ll+download+and+convert+it+in+the+background.');
  } catch (error) {
    return res.redirect('/?message=' + encodeURIComponent(`Queueing failed: ${error.message}`));
  }
});

app.get('/api/jobs', requireAuth, (_req, res) => {
  res.json({ jobs: listJobs() });
});

app.get('/file/:id', requireAuth, (req, res) => {
  const job = listJobs().find((item) => item.id === req.params.id);
  if (!job || !job.storedName) return res.status(404).send('File not found');
  const target = path.join(CONVERTED_DIR, job.storedName);
  if (!fs.existsSync(target)) return res.status(404).send('Stored file missing');
  return res.download(target, job.originalName || 'converted.mp3');
});

app.listen(PORT, HOST, () => {
  console.log(`${SITE_TITLE} listening on http://${HOST}:${PORT}`);
});
