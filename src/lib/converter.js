const path = require('path');
const { promises: fsp } = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { CONVERTED_DIR, UPLOADS_DIR, createFileName, safeBaseName } = require('./store');

const execFileAsync = promisify(execFile);
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

async function convertFile(uploadedFile) {
  if (!uploadedFile) throw new Error('No file uploaded');

  const baseName = path.parse(uploadedFile.originalname || 'upload').name || 'upload';
  const storedName = createFileName(`${safeBaseName(baseName)}.mp3`);
  const targetPath = path.join(CONVERTED_DIR, storedName);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', uploadedFile.path,
      '-vn',
      '-acodec', 'libmp3lame',
      '-q:a', '2',
      targetPath,
    ], { maxBuffer: 1024 * 1024 * 10 });
  } catch (error) {
    const details = String(error.stderr || error.stdout || error.message || 'Unknown ffmpeg error').trim();
    throw new Error(`Could not convert upload to MP3. ${details.split('\n').slice(-4).join(' ')}`);
  }

  const stats = await fsp.stat(targetPath);

  return {
    originalName: `${baseName}.mp3`,
    storedName,
    outputPath: targetPath,
    size: stats.size,
    mimeType: 'audio/mpeg',
  };
}

function isAllowedYoutubeUrl(input) {
  try {
    const url = new URL(input);
    return ['http:', 'https:'].includes(url.protocol) && YOUTUBE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function convertYoutubeToMp3(inputUrl) {
  if (!inputUrl || !isAllowedYoutubeUrl(inputUrl)) {
    throw new Error('Enter a valid YouTube URL');
  }

  const tmpDir = path.join(UPLOADS_DIR, `yt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`);
  await fsp.mkdir(tmpDir, { recursive: true });

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

    await execFileAsync('yt-dlp', [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--no-playlist',
      '--restrict-filenames',
      '--output', outputTemplate,
      inputUrl,
    ], { maxBuffer: 1024 * 1024 * 10 });

    const files = await fsp.readdir(tmpDir);
    const mp3File = files.find((file) => file.toLowerCase().endsWith('.mp3'));
    if (!mp3File) throw new Error('yt-dlp did not produce an mp3 file');

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
