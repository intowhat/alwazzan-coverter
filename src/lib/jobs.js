const {
  createJob,
  updateJob,
  getRecentJobs,
  markInFlightJobsInterrupted,
} = require('./store');
const { convertFile, convertYoutubeToMp3, cleanupUpload } = require('./converter');

let processing = false;

markInFlightJobsInterrupted();

async function processNextJob() {
  if (processing) return;
  const nextJob = getRecentJobs().find((job) => job.status === 'queued');
  if (!nextJob) return;

  processing = true;
  updateJob(nextJob.id, {
    status: 'processing',
    progress: Math.max(nextJob.progress || 0, 8),
    progressLabel: 'Starting conversion',
    error: null,
  });

  try {
    const onProgress = ({ progress, label }) => {
      updateJob(nextJob.id, {
        status: 'processing',
        progress,
        progressLabel: label,
      });
    };

    const result = nextJob.type === 'youtube'
      ? await convertYoutubeToMp3(nextJob.source, onProgress)
      : await convertFile({
          path: nextJob.tempPath,
          originalname: nextJob.label,
          mimetype: 'application/octet-stream',
        }, onProgress);

    const updated = updateJob(nextJob.id, {
      status: 'done',
      progress: 100,
      progressLabel: 'Ready to download',
      storedName: result.storedName,
      originalName: result.originalName,
      mimeType: result.mimeType,
      size: result.size,
      tempPath: null,
    });

    if (!updated && result.outputPath) {
      await cleanupUpload(result.outputPath);
    }
  } catch (error) {
    updateJob(nextJob.id, {
      status: 'failed',
      progressLabel: 'Conversion failed',
      error: error.message,
    });
  } finally {
    if (nextJob.tempPath) await cleanupUpload(nextJob.tempPath);
    processing = false;
    setImmediate(() => {
      processNextJob().catch(() => {});
    });
  }
}

function enqueueUploadJob(file) {
  const job = createJob({
    type: 'upload',
    label: file.originalname,
    source: file.originalname,
    tempPath: file.path,
  });
  setImmediate(() => {
    processNextJob().catch(() => {});
  });
  return job;
}

function enqueueYoutubeJob(url) {
  const job = createJob({
    type: 'youtube',
    label: url,
    source: url,
  });
  setImmediate(() => {
    processNextJob().catch(() => {});
  });
  return job;
}

function listJobs() {
  return getRecentJobs();
}

module.exports = {
  enqueueUploadJob,
  enqueueYoutubeJob,
  listJobs,
  processNextJob,
};
