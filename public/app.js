document.addEventListener('DOMContentLoaded', () => {
  const zones = document.querySelectorAll('[data-upload-zone]');
  const jobsRoot = document.querySelector('[data-jobs-root]');

  zones.forEach((zone) => {
    const input = zone.querySelector('[data-file-input]');
    const label = zone.querySelector('[data-file-label]');
    if (!input || !label) return;

    const defaultText = label.textContent;

    const updateLabel = () => {
      const file = input.files && input.files[0];
      label.textContent = file
        ? `${file.name} • ${(file.size / (1024 * 1024)).toFixed(2)} MB • Ready for MP3 conversion`
        : defaultText;
    };

    input.addEventListener('change', updateLabel);

    ['dragenter', 'dragover'].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.add('is-dragging');
      });
    });

    ['dragleave', 'dragend', 'drop'].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        if (eventName === 'drop' && event.dataTransfer?.files?.length) {
          input.files = event.dataTransfer.files;
          updateLabel();
        }
        zone.classList.remove('is-dragging');
      });
    });
  });

  function escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderJobs(jobs) {
    if (!jobsRoot) return;
    if (!jobs.length) {
      jobsRoot.innerHTML = '<div class="empty glass">No jobs yet. Start a conversion above.</div>';
      return;
    }

    jobsRoot.innerHTML = jobs.map((job) => `
      <article class="job-card glass" data-job-card>
        <div class="job-card__top">
          <div>
            <div class="file-rank">${escapeHtml(job.type)}</div>
            <h3>${escapeHtml(job.type === 'youtube' ? 'YouTube → MP3' : job.label)}</h3>
          </div>
          <span class="chip chip--${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
        </div>
        <p class="muted">${escapeHtml(job.progressLabel || 'Queued')}</p>
        <div class="progress"><span style="width:${Number(job.progress || 0)}%"></span></div>
        ${job.error ? `<p class="error-text">${escapeHtml(job.error)}</p>` : ''}
        ${job.resultFileId ? `<a class="link-btn" href="/file/${encodeURIComponent(job.resultFileId)}">Download MP3</a>` : ''}
      </article>
    `).join('');
  }

  async function refreshJobs() {
    if (!jobsRoot) return;
    try {
      const response = await fetch('/api/jobs', { headers: { accept: 'application/json' } });
      if (!response.ok) return;
      const payload = await response.json();
      renderJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
    } catch {
      // Quiet on polling failures.
    }
  }

  refreshJobs();
  if (jobsRoot) {
    window.setInterval(refreshJobs, 4000);
  }
});
