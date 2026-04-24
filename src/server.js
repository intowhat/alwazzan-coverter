const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { convertFile, cleanupUpload } = require('./lib/converter');
const {
  UPLOADS_DIR,
  CONVERTED_DIR,
  createFileName,
  addConvertedRecord,
  getRecentFiles,
  findFile,
} = require('./lib/store');

const app = express();
const PORT = Number(process.env.PORT || 3080);
const HOST = process.env.HOST || '0.0.0.0';
const APP_USERNAME = process.env.APP_USERNAME || 'bader';
const APP_PASSWORD = process.env.APP_PASSWORD || 'mp3!alsayegh';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const NODE_ENV = process.env.NODE_ENV || 'development';
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
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: NODE_ENV === 'production',
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
  const files = getRecentFiles();
  const fileCards = files.length
    ? files.map((file, index) => `
      <article class="file-card glass">
        <div class="file-card__top">
          <div>
            <div class="file-rank">0${index + 1}</div>
            <h3>${escapeHtml(file.originalName)}</h3>
          </div>
          <span class="chip">${bytesToSize(file.size)}</span>
        </div>
        <p class="muted">Stored ${new Date(file.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        <a class="link-btn" href="/file/${encodeURIComponent(file.id)}">Download</a>
      </article>
    `).join('')
    : '<div class="empty glass">No converted files yet. Upload the first one.</div>';

  const content = `
    <section class="hero glass">
      <div class="eyebrow">Private conversion portal</div>
      <h1>welcome bader, what are we converting today?</h1>
      <p class="muted">Mobile-first, locked down, and keeping only your latest 5 converted files live.</p>
      <form method="post" action="/logout"><button class="ghost" type="submit">Log out</button></form>
    </section>

    <section class="upload-card glass">
      <div>
        <h2>Upload a file</h2>
        <p class="muted">Current conversion engine is a safe passthrough base. Swap in ffmpeg or another processor once the exact conversion type is defined.</p>
      </div>
      <form method="post" action="/convert" enctype="multipart/form-data" class="stack">
        <label class="upload-zone">
          <input type="file" name="file" required />
          <span>Tap to choose a file</span>
          <small>Max 100MB</small>
        </label>
        <button type="submit">Convert now</button>
      </form>
    </section>

    <section class="files-section">
      <div class="section-head">
        <h2>Latest 5 files</h2>
        <span class="chip">Rolling retention</span>
      </div>
      <div class="file-grid">${fileCards}</div>
    </section>`;

  res.send(renderPage({ title: SITE_TITLE, content, message: req.query.message || '' }));
});

app.post('/convert', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.redirect('/?message=No+file+uploaded');

  try {
    const result = await convertFile(req.file);
    addConvertedRecord({
      originalName: req.file.originalname,
      storedName: result.storedName,
      mimeType: result.mimeType,
      size: result.size,
    });
    await cleanupUpload(req.file.path);
    return res.redirect('/?message=File+converted+and+stored');
  } catch (error) {
    await cleanupUpload(req.file.path);
    return res.redirect('/?message=' + encodeURIComponent(`Conversion failed: ${error.message}`));
  }
});

app.get('/file/:id', requireAuth, (req, res) => {
  const file = findFile(req.params.id);
  if (!file) return res.status(404).send('File not found');
  const target = path.join(CONVERTED_DIR, file.storedName);
  if (!fs.existsSync(target)) return res.status(404).send('Stored file missing');
  return res.download(target, file.originalName);
});

app.listen(PORT, HOST, () => {
  console.log(`${SITE_TITLE} listening on http://${HOST}:${PORT}`);
});
