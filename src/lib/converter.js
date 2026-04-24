const fs = require('fs');
const path = require('path');
const { promises: fsp } = require('fs');
const { CONVERTED_DIR, createFileName } = require('./store');

async function convertFile(uploadedFile) {
  if (!uploadedFile) throw new Error('No file uploaded');

  const storedName = createFileName(uploadedFile.originalname);
  const targetPath = path.join(CONVERTED_DIR, storedName);

  // Base implementation: preserves the uploaded file as the converted output.
  // Swap this function with ffmpeg/imagemagick/etc. when the exact conversion spec is known.
  await fsp.copyFile(uploadedFile.path, targetPath);

  const stats = await fsp.stat(targetPath);

  return {
    storedName,
    outputPath: targetPath,
    size: stats.size,
    mimeType: uploadedFile.mimetype || 'application/octet-stream',
  };
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
  cleanupUpload,
};
