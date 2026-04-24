const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../storage');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const CONVERTED_DIR = path.join(ROOT, 'converted');
const DATA_DIR = path.join(ROOT, 'data');
const META_PATH = path.join(DATA_DIR, 'files.json');
const MAX_FILES = 5;

for (const dir of [ROOT, UPLOADS_DIR, CONVERTED_DIR, DATA_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadMeta() {
  if (!fs.existsSync(META_PATH)) return [];
  try {
    const raw = fs.readFileSync(META_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMeta(items) {
  fs.writeFileSync(META_PATH, JSON.stringify(items, null, 2));
}

function safeBaseName(name) {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function extOf(name) {
  return path.extname(name || '').toLowerCase();
}

function createFileName(originalName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const token = crypto.randomBytes(4).toString('hex');
  return `${stamp}-${token}-${safeBaseName(originalName)}`;
}

function addConvertedRecord({ originalName, storedName, mimeType, size }) {
  const items = loadMeta();
  const id = crypto.randomUUID();
  const record = {
    id,
    originalName,
    storedName,
    mimeType,
    size,
    createdAt: new Date().toISOString(),
    extension: extOf(storedName)
  };

  items.unshift(record);

  while (items.length > MAX_FILES) {
    const removed = items.pop();
    if (removed?.storedName) {
      const target = path.join(CONVERTED_DIR, removed.storedName);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
  }

  saveMeta(items);
  return record;
}

function getRecentFiles() {
  return loadMeta();
}

function findFile(id) {
  return loadMeta().find((item) => item.id === id) || null;
}

module.exports = {
  ROOT,
  UPLOADS_DIR,
  CONVERTED_DIR,
  DATA_DIR,
  META_PATH,
  MAX_FILES,
  createFileName,
  addConvertedRecord,
  getRecentFiles,
  findFile,
  safeBaseName,
};
