const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v']);

export function isVideoFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(extension);
}

function readMetadata(file) {
  return new Promise(resolve => {
    const source = URL.createObjectURL(file);
    const media = document.createElement('video');
    let completed = false;
    const finish = async metadata => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(source);
      resolve(metadata);
    };
    const timeout = setTimeout(() => finish({ duration: 0, width: 0, height: 0, thumbnail: null, metadataError: 'Metadata could not be read.' }), 15000);
    media.preload = 'metadata';
    media.muted = true;
    media.onloadedmetadata = () => {
      const metadata = { duration: Number.isFinite(media.duration) ? media.duration : 0, width: media.videoWidth || 0, height: media.videoHeight || 0, thumbnail: null };
      if (!metadata.duration || !metadata.width || !metadata.height || media.readyState < 1) return finish(metadata);
      media.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(metadata.width, 480);
          canvas.height = Math.round(canvas.width * metadata.height / metadata.width);
          const context = canvas.getContext('2d', { alpha: false });
          context.drawImage(media, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => finish({ ...metadata, thumbnail: blob }), 'image/jpeg', 0.72);
        } catch { finish(metadata); }
      };
      media.onerror = () => finish(metadata);
      try { media.currentTime = Math.min(1, metadata.duration * 0.08); }
      catch { finish(metadata); }
      setTimeout(() => finish(metadata), 5000);
    };
    media.onerror = () => finish({ duration: 0, width: 0, height: 0, thumbnail: null, metadataError: 'This codec may not be supported by the browser.' });
    media.src = source;
  });
}

export async function prepareVideo(file) {
  const metadata = await readMetadata(file);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type || 'video/' + (file.name.split('.').pop() || 'unknown'),
    lastModified: file.lastModified || Date.now(),
    addedAt: Date.now(),
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    orientation: metadata.width && metadata.height ? (metadata.width / metadata.height < 0.78 ? 'portrait' : 'landscape') : 'unknown',
    thumbnail: metadata.thumbnail,
    metadataError: metadata.metadataError || '',
    file
  };
}

export async function* walkDirectory(directoryHandle) {
  for await (const entry of directoryHandle.values()) {
    if (entry.kind === 'file') {
      try { yield await entry.getFile(); } catch { /* Skip files that became unavailable. */ }
    } else if (entry.kind === 'directory') {
      yield* walkDirectory(entry);
    }
  }
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** order).toFixed(order ? 1 : 0)} ${units[order]}`;
}
