import { formatDuration } from './library.js';

const icons = {
  play: '<path d="m8 5 11 7-11 7z"/>', pause: '<path d="M8 5h3v14H8zm6 0h3v14h-3z"/>',
  volume: '<path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M16 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"/>',
  mute: '<path d="M4 10v4h4l5 4V6l-5 4z"/><path d="m17 9 5 6m0-6-5 6"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/>',
  theater: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9h18"/>', pip: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/>'
};

function button(label, icon, className = 'control-button') {
  const element = document.createElement('button');
  element.type = 'button'; element.className = className; element.title = label; element.setAttribute('aria-label', label);
  element.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg>`;
  return element;
}

export function mountPlayer(container, initialVideo, queue, options) {
  let currentVideo = initialVideo;
  let sourceUrl = null;
  let subtitleUrl = null;
  let disposed = false;
  let saveTimer;
  let controlsTimer;
  let queueVideos = queue;
  container.replaceChildren();
  const top = document.createElement('div'); top.className = 'player-topline';
  const back = document.createElement('button'); back.type = 'button'; back.className = 'back-button'; back.innerHTML = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6M9 12h12"/></svg><span>Back to videos</span>';
  back.onclick = () => options.onClose();
  top.append(back, document.createTextNode('LOCAL MEDIA PLAYER'));
  const layout = document.createElement('div'); layout.className = 'player-layout';
  const main = document.createElement('div'); main.className = 'player-main';
  const frame = document.createElement('div'); frame.className = 'player-frame';
  const media = document.createElement(initialVideo.mediaKind === 'audio' ? 'audio' : 'video'); media.playsInline = true; media.preload = 'metadata'; media.controls = initialVideo.mediaKind === 'audio'; media.volume = 1; media.muted = false;
  const controlPanel = document.createElement('div'); controlPanel.className = 'player-controls';
  const seekRow = document.createElement('div'); seekRow.className = 'seek-row';
  const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.value = '0'; seek.setAttribute('aria-label', 'Seek');
  seekRow.append(seek);
  const controls = document.createElement('div'); controls.className = 'control-row';
  const play = button('Play', icons.play); const volumeButton = button('Mute', icons.volume);
  const volume = document.createElement('input'); volume.type = 'range'; volume.className = 'volume-range'; volume.min = '0'; volume.max = '1'; volume.step = '.01'; volume.value = '1'; volume.setAttribute('aria-label', 'Volume');
  const time = document.createElement('span'); time.className = 'time-readout'; time.textContent = '0:00 / --:--';
  const spacer = document.createElement('span'); spacer.className = 'control-spacer';
  const speed = document.createElement('select'); speed.className = 'speed-select'; speed.title = 'Playback speed'; speed.setAttribute('aria-label', 'Playback speed');
  for (const rate of [.25, .5, .75, 1, 1.25, 1.5, 1.75, 2]) { const option = new Option(`${rate}×`, String(rate)); speed.add(option); }
  speed.value = '1';
  const quality = document.createElement('span'); quality.className = 'quality-label';
  const subtitle = button('Choose subtitles', '<path d="M4 5h16v12H9l-5 4z"/><path d="M8 10h3m2 0h3m-8 3h8"/>');
  const theater = button('Theater mode', icons.theater);
  const pip = button('Picture in Picture', icons.pip);
  const fullscreen = button('Fullscreen', icons.fullscreen);
  controls.append(play, volumeButton, volume, time, spacer, quality, speed, subtitle, theater, pip, fullscreen);
  controlPanel.append(seekRow, controls); frame.append(media, controlPanel);
  const title = document.createElement('h1'); title.className = 'player-title';
  const info = document.createElement('div'); info.className = 'player-info';
  const details = document.createElement('span');
  const infoActions = document.createElement('div'); infoActions.className = 'player-info-actions';
  const favorite = button('Save to favorites', '<path d="M20.8 8.8c0 5.1-8.8 11-8.8 11s-8.8-5.9-8.8-11A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4Z"/>', '');
  favorite.className = 'favorite-player-button';
  const addPlaylist = button('Add to playlist', '<path d="M12 5v14M5 12h14"/>', '');
  infoActions.append(favorite, addPlaylist); info.append(details, infoActions);
  main.append(frame, title, info);
  const side = document.createElement('aside'); side.className = 'player-sidebar';
  const sideHeading = document.createElement('h3'); sideHeading.textContent = 'Up next'; side.append(sideHeading);
  layout.append(main, side); container.append(top, layout);

  function updateFavorite() {
    favorite.classList.toggle('is-active', options.isFavorite(currentVideo.id));
    favorite.innerHTML = `<svg viewBox="0 0 24 24">${icons.favorite}</svg>${options.isFavorite(currentVideo.id) ? 'Saved' : 'Save'}`;
  }
  function syncSource(video, resume = false) {
    currentVideo = video;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (subtitleUrl) { URL.revokeObjectURL(subtitleUrl); subtitleUrl = null; }
    media.pause(); media.removeAttribute('src'); media.querySelectorAll('track').forEach(track => track.remove()); media.load(); media.volume = 1; media.muted = false;
    sourceUrl = video.fileUrl || URL.createObjectURL(video.file);
    media.src = sourceUrl; media.load();
    title.textContent = video.name;
    details.textContent = `${video.width && video.height ? `${video.width} × ${video.height} · ` : ''}${formatDuration(video.duration)} · ${video.type.split('/').pop().toUpperCase()}`;
    quality.textContent = video.mediaKind === 'audio' ? 'MP3 audio' : video.width ? `${video.width}p` : 'Local file';
    updateFavorite();
    const record = options.history.find(item => item.id === video.id);
    const position = resume ? (record?.position || 0) : 0;
    media.onloadedmetadata = () => {
      if (position > 5 && media.duration - position > 10) media.currentTime = position;
      updateTime();
    };
    let compatibilityAttempted = false;
    media.onerror = () => {
      if (!compatibilityAttempted && (video.mediaKind !== 'audio')) {
        compatibilityAttempted = true;
        if (sourceUrl) URL.revokeObjectURL(sourceUrl);
        sourceUrl = `/compatible?path=${encodeURIComponent(video.path)}`;
        media.src = sourceUrl;
        media.load();
        return;
      }
      showPlayerError();
    };
    renderQueue();
  }
  function showPlayerError() {
    if (frame.querySelector('.player-error')) return;
    const error = document.createElement('div'); error.className = 'player-error';
    error.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/></svg><strong>Unable to play this file in your browser</strong><span>The file is in your library, but this codec may not be supported. Try a browser with codec support or choose another video.</span>';
    frame.append(error);
  }
  function updateTime() {
    const duration = media.duration;
    if (!Number.isFinite(duration)) return;
    const current = media.currentTime || 0;
    time.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
    seek.value = String(Math.round(current / duration * 1000));
    seek.style.setProperty('--progress', `${current / duration * 100}%`);
  }
  function saveProgress() {
    if (currentVideo && Number.isFinite(media.currentTime) && media.currentTime > 0) options.onProgress(currentVideo, media.currentTime, media.duration || currentVideo.duration);
  }
  function renderQueue() {
    side.replaceChildren(sideHeading);
    const nextVideos = queueVideos.filter(video => video.id !== currentVideo.id).slice(0, 10);
    for (const video of nextVideos) {
      const item = document.createElement('div'); item.className = 'up-next-item'; item.tabIndex = 0;
      const thumb = document.createElement('div'); thumb.className = 'up-next-thumb';
      if (video.thumbnail) { const image = new Image(); image.loading = 'lazy'; image.src = URL.createObjectURL(video.thumbnail); thumb.append(image); }
      const text = document.createElement('div'); const name = document.createElement('strong'); name.textContent = video.name; const duration = document.createElement('small'); duration.textContent = formatDuration(video.duration); text.append(name, duration); item.append(thumb, text);
      const open = () => syncSource(video, true); item.onclick = open; item.onkeydown = event => { if (event.key === 'Enter') open(); };
      side.append(item);
    }
  }
  play.onclick = () => {
    if (media.paused) {
      media.volume = Number(volume.value) || 1;
      media.muted = false;
      media.play().catch(() => options.toast('The browser blocked playback. Click Play again to allow sound.'));
    } else media.pause();
  };
  media.onplay = () => { play.innerHTML = `<svg viewBox="0 0 24 24">${icons.pause}</svg>`; play.title = 'Pause'; play.setAttribute('aria-label', 'Pause'); };
  media.onpause = () => { play.innerHTML = `<svg viewBox="0 0 24 24">${icons.play}</svg>`; play.title = 'Play'; play.setAttribute('aria-label', 'Play'); saveProgress(); };
  media.ontimeupdate = updateTime;
  media.onended = () => { saveProgress(); const index = queueVideos.findIndex(video => video.id === currentVideo.id); if (index >= 0 && queueVideos[index + 1]) syncSource(queueVideos[index + 1]); };
  media.onvolumechange = () => { volume.value = String(media.muted ? 0 : media.volume); volumeButton.innerHTML = `<svg viewBox="0 0 24 24">${media.muted || !media.volume ? icons.mute : icons.volume}</svg>`; };
  seek.oninput = () => { if (Number.isFinite(media.duration)) { media.currentTime = Number(seek.value) / 1000 * media.duration; updateTime(); } };
  volume.oninput = () => { media.volume = Number(volume.value); media.muted = media.volume === 0; };
  volumeButton.onclick = () => { media.muted = !media.muted; };
  speed.onchange = () => { media.playbackRate = Number(speed.value); };
  theater.onclick = () => container.classList.toggle('theater-mode');
  fullscreen.onclick = () => document.fullscreenElement ? document.exitFullscreen() : frame.requestFullscreen?.();
  frame.ondblclick = event => { if (!event.target.closest('.player-controls')) document.fullscreenElement ? document.exitFullscreen() : frame.requestFullscreen?.(); };
  pip.onclick = async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else if (document.pictureInPictureEnabled) await media.requestPictureInPicture(); else options.toast('Picture in Picture is not supported by this browser.'); } catch { options.toast('Picture in Picture is unavailable for this file.'); } };
  subtitle.onclick = () => options.onSubtitle();
  favorite.onclick = () => { options.onFavorite(currentVideo); updateFavorite(); };
  addPlaylist.onclick = () => options.onPlaylist(currentVideo);
  frame.onmousemove = () => { frame.classList.remove('controls-hidden'); clearTimeout(controlsTimer); controlsTimer = setTimeout(() => { if (!media.paused) frame.classList.add('controls-hidden'); }, 2200); };
  window.addEventListener('keydown', onKeydown);
  function onKeydown(event) {
    if (disposed || container.hidden || event.target.matches('input,select,textarea')) return;
    if (event.ctrlKey && event.key.toLowerCase() === 'k') return;
    if (event.code === 'Space' || event.key.toLowerCase() === 'k') { event.preventDefault(); media.paused ? media.play().catch(() => {}) : media.pause(); }
    else if (event.key.toLowerCase() === 'j') { media.currentTime = Math.max(0, media.currentTime - 10); }
    else if (event.key.toLowerCase() === 'l') { media.currentTime = Math.min(media.duration || 0, media.currentTime + 10); }
    else if (event.key === 'ArrowRight') { media.currentTime = Math.min(media.duration || 0, media.currentTime + 5); }
    else if (event.key === 'ArrowLeft') { media.currentTime = Math.max(0, media.currentTime - 5); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); media.volume = Math.min(1, media.volume + .05); media.muted = false; }
    else if (event.key === 'ArrowDown') { event.preventDefault(); media.volume = Math.max(0, media.volume - .05); }
    else if (event.key.toLowerCase() === 'm') media.muted = !media.muted;
    else if (event.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : frame.requestFullscreen?.();
    else if (event.key.toLowerCase() === 't') container.classList.toggle('theater-mode');
  }
  const interval = setInterval(saveProgress, 5000);
  syncSource(initialVideo, true);
  return {
    setQueue(videos) { queueVideos = videos; renderQueue(); },
    setSubtitle(file) {
      if (subtitleUrl) URL.revokeObjectURL(subtitleUrl);
      subtitleUrl = URL.createObjectURL(file);
      const track = document.createElement('track'); track.kind = 'subtitles'; track.label = file.name; track.srclang = 'en'; track.src = subtitleUrl; track.default = true; media.append(track);
    },
    dispose() {
      disposed = true; clearInterval(interval); clearTimeout(controlsTimer); saveProgress(); window.removeEventListener('keydown', onKeydown);
      media.pause(); media.removeAttribute('src'); media.querySelectorAll('track').forEach(track => track.remove()); media.load();
      if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (subtitleUrl) URL.revokeObjectURL(subtitleUrl);
      side.querySelectorAll('img').forEach(image => { if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src); });
    }
  };
}
