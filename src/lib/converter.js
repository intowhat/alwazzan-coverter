const path = require('path');
const { promises: fsp } = require('fs');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { CONVERTED_DIR, UPLOADS_DIR, createFileName, safeBaseName } = require('./store');

const execFileAsync = promisify(execFile);
const SUPPORTED_URL_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
]);

function parseDurationToSeconds(value) {
  const parts = String(value || '').trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

async function getMediaDurationSeconds(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const value = Number.parseFloat(String(stdout).trim());
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

async function convertFile(uploadedFile, onProgress = () => {}) {
  if (!uploadedFile) throw new Error('No file uploaded');

  const baseName = path.parse(uploadedFile.originalname || 'upload').name || 'upload';
  const storedName = createFileName(`${safeBaseName(baseName)}.mp3`);
  const targetPath = path.join(CONVERTED_DIR, storedName);
  const durationSeconds = await getMediaDurationSeconds(uploadedFile.path);

  await new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', uploadedFile.path,
      '-vn',
      '-acodec', 'libmp3lame',
      '-q:a', '2',
      '-progress', 'pipe:1',
      '-nostats',
      targetPath,
    ];

    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let lastPercent = 8;
    onProgress({ progress: lastPercent, label: 'Preparing upload conversion' });

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('out_time=')) continue;
        const outTime = trimmed.slice('out_time='.length);
        const elapsedSeconds = parseDurationToSeconds(outTime);
        if (!durationSeconds) {
          lastPercent = Math.min(92, lastPercent + 4);
        } else {
          const computed = 10 + Math.round((elapsedSeconds / durationSeconds) * 82);
          lastPercent = Math.max(lastPercent, Math.min(92, computed));
        }
        onProgress({ progress: lastPercent, label: 'Converting upload to MP3' });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const details = stderr.trim().split('\n').slice(-4).join(' ');
      reject(new Error(details || `ffmpeg exited with code ${code}`));
    });
  }).catch((error) => {
    throw new Error(`Could not convert upload to MP3. ${error.message}`);
  });

  const stats = await fsp.stat(targetPath);

  return {
    originalName: `${baseName}.mp3`,
    storedName,
    outputPath: targetPath,
    size: stats.size,
    mimeType: 'audio/mpeg',
  };
}

function detectSupportedPlatform(input) {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (!SUPPORTED_URL_HOSTS.has(host)) return null;
    if (host.includes('tiktok.com')) return 'tiktok';
    return 'youtube';
  } catch {
    return null;
  }
}

async function convertYoutubeToMp3(inputUrl, onProgress = () => {}) {
  const platform = detectSupportedPlatform(inputUrl);
  if (!inputUrl || !platform) {
    throw new Error('Enter a valid YouTube or TikTok URL');
  }

  const tmpDir = path.join(UPLOADS_DIR, `yt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  onProgress({ progress: 12, label: `Fetching ${platform === 'tiktok' ? 'TikTok' : 'YouTube'} details` });

  try {
    const { stdout: metaStdout } = await execFileAsync('yt-dlp', [
      '--dump-single-json',
      '--no-playlist',
      inputUrl,
    ], { maxBuffer: 1024 * 1024 * 10 });

    const meta = JSON.parse(metaStdout);
    const baseTitle = (meta.track || meta.title || 'youtube-audio').trim();
    const finalName = createFileName(`${baseTitle}.mp3`);
    const finalPath = path.join(CONVERTED_DIR, finalName);
    const outputTemplate = path.join(tmpDir, 'audio.%(ext)s');

    onProgress({ progress: 32, label: `Downloading audio from ${platform === 'tiktok' ? 'TikTok' : 'YouTube'}` });
    const downloadProcess = spawn('yt-dlp', [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--no-playlist',
      '--restrict-filenames',
      '--output', outputTemplate,
      inputUrl,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let lastPercent = 32;

    await new Promise((resolve, reject) => {
      const bumpProgress = (text) => {
        if (text.includes('[download]')) {
          const match = text.match(/(\d+(?:\.\d+)?)%/);
          if (match) {
            const raw = Number.parseFloat(match[1]);
            lastPercent = Math.max(lastPercent, Math.min(72, 32 + Math.round(raw * 0.4)));
            onProgress({ progress: lastPercent, label: `Downloading audio from ${platform === 'tiktok' ? 'TikTok' : 'YouTube'}` });
          }
        }
        if (text.toLowerCase().includes('destination') || text.toLowerCase().includes('extracting audio')) {
          lastPercent = Math.max(lastPercent, 78);
          onProgress({ progress: lastPercent, label: `Converting ${platform === 'tiktok' ? 'TikTok' : 'YouTube'} audio to MP3` });
        }
      };

      downloadProcess.stdout.on('data', (chunk) => bumpProgress(String(chunk)));
      downloadProcess.stderr.on('data', (chunk) => {
        const text = String(chunk);
        stderr += text;
        bumpProgress(text);
      });
      downloadProcess.on('error', reject);
      downloadProcess.on('close', (code) => {
        if (code === 0) return resolve();
        reject(new Error(stderr.trim().split('\n').slice(-4).join(' ') || `yt-dlp exited with code ${code}`));
      });
    });

    const files = await fsp.readdir(tmpDir);
    const mp3File = files.find((file) => file.toLowerCase().endsWith('.mp3'));
    if (!mp3File) throw new Error('yt-dlp did not produce an mp3 file');

    onProgress({ progress: 92, label: 'Finalizing MP3' });
    const tmpMp3Path = path.join(tmpDir, mp3File);
    await fsp.rename(tmpMp3Path, finalPath);

    const stats = await fsp.stat(finalPath);
    return {
      originalName: `${baseTitle}.mp3`,
      storedName: finalName,
      outputPath: finalPath,
      size: stats.size,
      mimeType: 'audio/mpeg',
    };
  } catch (error) {
    const details = String(error.stderr || error.stdout || error.message || 'Unknown error').trim();
    throw new Error(details.split('\n').slice(-4).join(' '));
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

async function cleanupUpload(tempPath) {
  if (!tempPath) return;
  try {
    await fsp.unlink(tempPath);
  } catch {
    // Ignore cleanup failures.
  }
}

module.exports = {
  convertFile,
  convertYoutubeToMp3,
  cleanupUpload,
};
