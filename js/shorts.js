import { formatDuration } from './library.js';

const icon = (path) => `<svg viewBox="0 0 24 24">${path}</svg>`;
const paths = {
  like: '<path d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zm0 0 5-7a3 3 0 0 1 2 3l-1 4h6a2 2 0 0 1 2 2l-1 6a2 2 0 0 1-2 2H7"/>',
  dislike: '<path d="M17 14V4h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1zm0 0-5 7a3 3 0 0 1-2-3l1-4H5a2 2 0 0 1-2-2l1-6a2 2 0 0 1 2-2h11"/>',
  comment: '<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8 8 0 0 1-4-.9L3 20l1.5-4A7.3 7.3 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7z"/>',
  share: '<path d="M12 16V4m-5 5 5-5 5 5M5 14v6h14v-6"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/>',
  volume: '<path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
  mute: '<path d="M4 10v4h4l5 4V6l-5 4z"/><path d="m17 9 5 6m0-6-5 6"/>'
};

export function mountShorts(container, videos, options) {
  container.replaceChildren();
  const shorts = videos.filter(video => video.orientation === 'portrait');
  if (!shorts.length) {
    const empty = document.createElement('div'); empty.className = 'shorts-empty';
    const heading = document.createElement('h2'); heading.textContent = 'No Shorts yet';
    const message = document.createElement('p'); message.textContent = 'Portrait videos in your library will appear here.';
    empty.append(heading, message); container.append(empty);
    return { dispose() {} };
  }
  const scroller = document.createElement('div'); scroller.className = 'shorts-scroller';
  const hint = document.createElement('div'); hint.className = 'shorts-hint'; hint.textContent = 'Scroll to explore';
  const entries = [];
  const reactions = options.getReactions();
  shorts.forEach((video, index) => {
    const slide = document.createElement('article'); slide.className = 'short-slide'; slide.dataset.index = String(index);
    const frame = document.createElement('div'); frame.className = 'short-frame';
    const media = document.createElement('video'); media.playsInline = true; media.loop = true; media.muted = options.isMuted(); media.preload = 'none'; media.setAttribute('aria-label', video.name);
    if (video.thumbnail) media.poster = URL.createObjectURL(video.thumbnail);
    const overlay = document.createElement('div'); overlay.className = 'short-overlay';
    const title = document.createElement('h2'); title.textContent = video.name;
    const meta = document.createElement('p'); meta.textContent = `${video.width && video.height ? `${video.width} × ${video.height} · ` : ''}${formatDuration(video.duration)} · ${video.type.split('/').pop().toUpperCase()}`;
    overlay.append(title, meta); frame.append(media, overlay);
    const actions = document.createElement('div'); actions.className = 'short-actions';
    const makeAction = (key, label, iconPath, count = '') => {
      const wrap = document.createElement('div'); wrap.className = 'short-action-wrap';
      const button = document.createElement('button'); button.className = 'short-action'; button.title = label; button.setAttribute('aria-label', label); button.innerHTML = icon(iconPath);
      const caption = document.createElement('small'); caption.textContent = count;
      wrap.append(button, caption); actions.append(wrap); return { button, caption, key };
    };
    const like = makeAction('like', 'Like', paths.like, reactions[video.id] === 'like' ? 'Liked' : '');
    const dislike = makeAction('dislike', 'Dislike', paths.dislike, reactions[video.id] === 'dislike' ? 'Disliked' : '');
    const comment = makeAction('comment', 'Comments', paths.comment, 'Comment');
    const share = makeAction('share', 'Share', paths.share, 'Share');
    const mute = makeAction('mute', options.isMuted() ? 'Unmute' : 'Mute', options.isMuted() ? paths.mute : paths.volume, options.isMuted() ? 'Muted' : 'Sound');
    const full = makeAction('fullscreen', 'Fullscreen', paths.fullscreen, 'Full');
    like.button.classList.toggle('active', reactions[video.id] === 'like'); dislike.button.classList.toggle('active', reactions[video.id] === 'dislike');
    like.button.onclick = () => { const state = reactions[video.id] === 'like' ? '' : 'like'; reactions[video.id] = state; if (!state) delete reactions[video.id]; if (state === 'like') delete reactions[video.id + ':dislike']; options.saveReactions(reactions); like.button.classList.toggle('active', state === 'like'); dislike.button.classList.remove('active'); like.caption.textContent = state ? 'Liked' : ''; dislike.caption.textContent = ''; };
    dislike.button.onclick = () => { const state = reactions[video.id] === 'dislike' ? '' : 'dislike'; reactions[video.id] = state; if (!state) delete reactions[video.id]; if (state === 'dislike') delete reactions[video.id + ':like']; options.saveReactions(reactions); dislike.button.classList.toggle('active', state === 'dislike'); like.button.classList.remove('active'); dislike.caption.textContent = state ? 'Disliked' : ''; like.caption.textContent = ''; };
    comment.button.onclick = () => options.onComment(video);
    share.button.onclick = async () => { try { await navigator.clipboard.writeText(video.name); options.toast('Video name copied to clipboard.'); } catch { options.toast(video.name); } };
    mute.button.onclick = () => { media.muted = !media.muted; options.setMuted(media.muted); mute.button.title = media.muted ? 'Unmute' : 'Mute'; mute.caption.textContent = media.muted ? 'Muted' : 'Sound'; mute.button.innerHTML = icon(media.muted ? paths.mute : paths.volume); };
    full.button.onclick = () => frame.requestFullscreen?.();
    slide.append(frame, actions); scroller.append(slide); entries.push({ slide, frame, media, video, loaded: false });
  });
  container.append(scroller, hint);
  let activeIndex = -1;
  function activate(entry) {
    const index = Number(entry.slide.dataset.index);
    if (activeIndex === index) return;
    activeIndex = index;
    entries.forEach(other => {
      if (other !== entry) { other.media.pause(); if (other.media.src) { other.media.removeAttribute('src'); other.media.load(); other.loaded = false; } }
    });
    if (!entry.loaded) { entry.media.src = entry.video.fileUrl || URL.createObjectURL(entry.video.file); entry.loaded = true; }
    if (options.autoplay()) entry.media.play().catch(() => {});
    options.onWatch(entry.video);
  }
  const observer = new IntersectionObserver(records => {
    for (const record of records) if (record.isIntersecting && record.intersectionRatio > .65) activate(entries[Number(record.target.dataset.index)]);
  }, { root: scroller, threshold: [.65, .9] });
  entries.forEach(entry => observer.observe(entry.slide));
  let wheelReady = true;
  const onWheel = event => {
    if (!wheelReady || Math.abs(event.deltaY) < 20) return;
    wheelReady = false;
    const direction = event.deltaY > 0 ? 1 : -1;
    const next = Math.max(0, Math.min(entries.length - 1, activeIndex + direction));
    entries[next]?.slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => { wheelReady = true; }, 550);
  };
  scroller.addEventListener('wheel', onWheel, { passive: true });
  return { dispose() { observer.disconnect(); scroller.removeEventListener('wheel', onWheel); entries.forEach(entry => { entry.media.pause(); entry.media.removeAttribute('src'); entry.media.load(); if (entry.media.poster?.startsWith('blob:')) URL.revokeObjectURL(entry.media.poster); }); } };
}
