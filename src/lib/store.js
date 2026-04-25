const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../storage');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const CONVERTED_DIR = path.join(ROOT, 'converted');
const DATA_DIR = path.join(ROOT, 'data');
const META_PATH = path.join(DATA_DIR, 'files.json');
const JOBS_PATH = path.join(DATA_DIR, 'jobs.json');
const MAX_FILES = 5;
const MAX_JOBS = 5;

for (const dir of [ROOT, UPLOADS_DIR, CONVERTED_DIR, DATA_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveJsonArray(filePath, items) {
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
}

function loadMeta() {
  return loadJsonArray(META_PATH);
}

function saveMeta(items) {
  saveJsonArray(META_PATH, items);
}

function loadJobs() {
  return loadJsonArray(JOBS_PATH);
}

function cleanupRemovedJob(job) {
  if (!job) return;
  if (job.tempPath && fs.existsSync(job.tempPath)) {
    try { fs.unlinkSync(job.tempPath); } catch {}
  }
  if (job.storedName) {
    const target = path.join(CONVERTED_DIR, job.storedName);
    if (fs.existsSync(target)) {
      try { fs.unlinkSync(target); } catch {}
    }
  }
}

function saveJobs(items) {
  const trimmed = items.slice(0, MAX_JOBS);
  const removed = items.slice(MAX_JOBS);
  for (const job of removed) cleanupRemovedJob(job);
  saveJsonArray(JOBS_PATH, trimmed);
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

function createJob(data) {
  const items = loadJobs();
  const job = {
    id: crypto.randomUUID(),
    type: data.type,
    label: data.label,
    source: data.source,
    tempPath: data.tempPath || null,
    status: 'queued',
    progress: 4,
    progressLabel: 'Queued',
    error: null,
    storedName: null,
    originalName: null,
    mimeType: null,
    size: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  items.unshift(job);
  saveJobs(items);
  return job;
}

function updateJob(id, patch) {
  const items = loadJobs();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  items[index] = {
    ...items[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveJobs(items);
  return items[index];
}

function getJob(id) {
  return loadJobs().find((item) => item.id === id) || null;
}

function getRecentJobs() {
  return loadJobs();
}

function markInFlightJobsInterrupted() {
  const items = loadJobs();
  let changed = false;
  const next = items.map((item) => {
    if (item.status === 'queued' || item.status === 'processing') {
      changed = true;
      return {
        ...item,
        status: 'failed',
        progress: item.progress || 0,
        progressLabel: 'Interrupted by restart',
        error: item.error || 'The app restarted before this job finished.',
        updatedAt: new Date().toISOString(),
      };
    }
    return item;
  });
  if (changed) saveJobs(next);
}

module.exports = {
  ROOT,
  UPLOADS_DIR,
  CONVERTED_DIR,
  DATA_DIR,
  META_PATH,
  JOBS_PATH,
  MAX_FILES,
  createFileName,
  addConvertedRecord,
  getRecentFiles,
  findFile,
  safeBaseName,
  createJob,
  updateJob,
  getJob,
  getRecentJobs,
  markInFlightJobsInterrupted,
};
