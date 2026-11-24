export function searchVideos(videos, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return videos;
  const durationMatch = normalized.match(/(?:over|under|less than|more than)\s+(\d+)\s*(min|minute|minutes|sec|second|seconds|hour|hours)?/);
  const resolutionMatch = normalized.match(/(\d{3,4})\s*p/);
  const terms = normalized.split(/\s+/).filter(term => !/^(over|under|less|than|more|minute|minutes|min|sec|seconds|hour|hours|\d+p)$/.test(term));
  return videos.filter(video => {
    const duration = video.duration || 0;
    const resolution = Math.max(video.width || 0, video.height || 0);
    if (durationMatch) {
      const value = Number(durationMatch[1]);
      const unit = durationMatch[2] || 'min';
      const seconds = /hour/.test(unit) ? value * 3600 : /sec/.test(unit) ? value : value * 60;
      if (/^(under|less)/.test(normalized) ? duration >= seconds : duration <= seconds) return false;
    }
    if (resolutionMatch && resolution < Number(resolutionMatch[1])) return false;
    const searchable = `${video.name} ${video.orientation} ${video.width}x${video.height} ${video.duration || ''} ${video.type}`.toLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}

export function getSuggestions(videos, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return videos.filter(video => video.name.toLowerCase().includes(normalized)).slice(0, 5);
}
