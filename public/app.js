document.addEventListener('DOMContentLoaded', () => {
  const zones = document.querySelectorAll('[data-upload-zone]');

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
});
