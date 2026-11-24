import { getVideos, getHistory, saveVideo, removeVideo, saveHistory, clearHistory, getPreference, setPreference, getDirectoryHandle, saveDirectoryHandle, clearDirectoryHandle } from './storage.js';
import { isVideoFile, prepareVideo, walkDirectory, formatDuration, formatBytes } from './library.js';
import { searchVideos, getSuggestions } from './search.js';
import { getPlaylists, createPlaylist, renamePlaylist, deletePlaylist, togglePlaylistVideo } from './playlists.js';
import { mountPlayer } from './player.js';
import { mountShorts } from './shorts.js';

const $ = selector => document.querySelector(selector);
const shell = $('#appShell');
const browseView = $('#browseView');
const playerView = $('#playerView');
const shortsView = $('#shortsView');
const grid = $('#videoGrid');
const fileInput = $('#fileInput');
const sortSelect = $('#sortSelect');
const PAGE_SIZE = 48;
const state = { videos: [], history: [], view: 'home', category: 'All', query: '', sort: 'recent', page: 0, activePlaylist: null, player: null, shorts: null, cardUrls: [], categoryUrl: null, pcVideoSignature: '' };
let isImporting = false;

function toast(message, error = false) {
  const item = document.createElement('div'); item.className = `toast${error ? ' error' : ''}`; item.textContent = message;
  $('#toastRegion').append(item); setTimeout(() => item.remove(), 3400);
}
function escapeText(value) { return String(value ?? ''); }
function selectedIds(key) { return new Set(getPreference(key, [])); }
function saveIds(key, ids) { setPreference(key, [...ids]); }
function favoriteIds() { return selectedIds('favorites'); }
function likedIds() { return selectedIds('liked'); }
function isFavorite(id) { return favoriteIds().has(id); }
function closePlayer() { state.player?.dispose(); state.player = null; playerView.replaceChildren(); playerView.hidden = true; browseView.hidden = false; shortsView.hidden = true; render(); }
function releaseCardUrls() { state.cardUrls.forEach(url => URL.revokeObjectURL(url)); state.cardUrls = []; }
function updateCounts() { $('#sidebarCount').textContent = String(state.videos.length); }
function formatRelative(timestamp) {
  if (!timestamp) return 'Not watched yet';
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60000) return 'Just now';
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} min ago`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} hr ago`;
  return `${Math.floor(elapsed / 86400000)} days ago`;
}
function historyFor(id) { return state.history.find(record => record.id === id); }

const views = {
  home: ['YOUR LIBRARY', 'Watch something good.'],
  library: ['YOUR VIDEOS', 'Everything you added.'],
  favorites: ['SUBSCRIPTIONS', 'Your favorites.'],
  liked: ['LIKED VIDEOS', 'Videos you liked.'],
  history: ['WATCH HISTORY', 'Pick up where you left off.'],
  playlists: ['YOUR COLLECTIONS', 'Made for your mood.'],
  settings: ['PREFERENCES', 'Your library, your settings.'],
  playlistDetail: ['PLAYLIST', '']
};

function setView(view) {
  if (state.player) state.player.dispose();
  state.player = null;
  state.shorts?.dispose(); state.shorts = null;
  releaseCardUrls();
  state.view = view; state.category = 'All'; state.page = 0; state.activePlaylist = null;
  $('.nav-item.active')?.classList.remove('active');
  document.querySelector(`.nav-item[data-view="${view === 'playlistDetail' ? 'playlists' : view}"]`)?.classList.add('active');
  playerView.hidden = true;
  shortsView.hidden = view !== 'shorts';
  browseView.hidden = view === 'shorts';
  if (view === 'shorts') renderShorts(); else render();
}

function showPlayer(video) {
  state.shorts?.dispose(); state.shorts = null;
  state.player?.dispose(); state.player = null;
  releaseCardUrls();
  browseView.hidden = true; shortsView.hidden = true; playerView.hidden = false;
  const queue = getVisibleVideos();
  state.player = mountPlayer(playerView, video, queue, {
    history: state.history,
    isFavorite,
    onClose: closePlayer,
    onFavorite: toggleFavorite,
    onPlaylist: openPlaylistPicker,
    onSubtitle: () => $('#subtitleInput').click(),
    onProgress: updateProgress,
    toast
  });
}

function playRandomVideo() {
  const videos = getVisibleVideos();
  if (!videos.length) { toast('No videos are available in this view.', true); return; }
  showPlayer(videos[Math.floor(Math.random() * videos.length)]);
}

function showShortcuts() {
  const body = document.createElement('div');
  body.innerHTML = '<p><strong>Space / K</strong> Play or pause</p><p><strong>J / L</strong> Seek back or forward 10 seconds</p><p><strong>Left / Right</strong> Seek 5 seconds</p><p><strong>Up / Down</strong> Adjust volume</p><p><strong>M</strong> Mute</p><p><strong>F</strong> Fullscreen</p><p><strong>T</strong> Theater mode</p><p><strong>Ctrl K</strong> Focus search</p>';
  openModal('Keyboard shortcuts', body);
}

function updateProgress(video, position, duration) {
  const record = { id: video.id, position: Math.floor(position), duration: Math.floor(duration || video.duration), updatedAt: Date.now() };
  const next = state.history.filter(item => item.id !== video.id); next.push(record); next.sort((a, b) => b.updatedAt - a.updatedAt); state.history = next.slice(0, 500);
  saveHistory(record).catch(error => toast(error.message, true));
}

function toggleFavorite(video) {
  const favorites = favoriteIds();
  if (favorites.has(video.id)) favorites.delete(video.id); else favorites.add(video.id);
  saveIds('favorites', favorites); toast(favorites.has(video.id) ? 'Added to favorites.' : 'Removed from favorites.'); render();
}
function toggleLiked(video) {
  const liked = likedIds(); if (liked.has(video.id)) liked.delete(video.id); else liked.add(video.id); saveIds('liked', liked); render();
}
function getVisibleVideos() {
  let videos = state.videos.slice();
  if (state.view === 'favorites') videos = videos.filter(video => favoriteIds().has(video.id));
  else if (state.view === 'liked') videos = videos.filter(video => likedIds().has(video.id));
  else if (state.view === 'history') videos = videos.filter(video => historyFor(video.id));
  else if (state.view === 'playlistDetail') { const playlist = getPlaylists().find(item => item.id === state.activePlaylist); videos = videos.filter(video => playlist?.videos.includes(video.id)); }
  if (state.view === 'home') {
    if (state.category === 'Recommended') videos = videos.filter(video => !historyFor(video.id));
    else if (state.category === 'Continue watching') videos = videos.filter(video => { const item = historyFor(video.id); return item && item.position > 5 && item.position < item.duration - 10; });
    else if (state.category === 'Recently watched') videos = videos.filter(video => historyFor(video.id)).sort((a, b) => historyFor(b.id).updatedAt - historyFor(a.id).updatedAt);
    else if (state.category === 'MP4') videos = videos.filter(video => video.name.toLowerCase().endsWith('.mp4'));
    else if (state.category === 'MOV') videos = videos.filter(video => video.name.toLowerCase().endsWith('.mov'));
    else if (state.category === 'Playwright') videos = videos.filter(video => video.mediaKind === 'audio' || video.name.toLowerCase().endsWith('.mp3'));
  }
  if (state.query) videos = searchVideos(videos, state.query);
  if (state.sort === 'name') videos.sort((a, b) => a.name.localeCompare(b.name));
  else if (state.sort === 'duration') videos.sort((a, b) => (a.duration || 0) - (b.duration || 0));
  else if (state.sort === 'date') videos.sort((a, b) => b.lastModified - a.lastModified);
  else if (state.category !== 'Recently watched') videos.sort((a, b) => b.addedAt - a.addedAt);
  return videos;
}

function renderCategories() {
  const bar = $('#categoryBar'); bar.replaceChildren();
  const categories = ['All', 'Recommended', 'Continue watching', 'Recently watched', 'MP4', 'MOV', 'Playwright'];
  for (const category of categories) {
    const button = document.createElement('button'); button.className = `chip${state.category === category ? ' active' : ''}`; button.textContent = category;
    button.onclick = () => { state.category = category; state.page = 0; render(); };
    bar.append(button);
  }
  bar.hidden = !['home', 'library'].includes(state.view);
}

function createCard(video) {
  const card = document.createElement('article'); card.className = `video-card${video.orientation === 'portrait' ? ' portrait' : ''}`;
  const thumb = document.createElement('div'); thumb.className = 'thumb-wrap'; thumb.title = `Play ${video.name}`;
  if (video.thumbnailUrl) {
    const image = new Image(); image.loading = 'lazy'; image.alt = ''; image.src = video.thumbnailUrl; thumb.append(image);
  } else if (video.thumbnail) {
    const image = new Image(); image.loading = 'lazy'; image.alt = ''; image.src = URL.createObjectURL(video.thumbnail); state.cardUrls.push(image.src); thumb.append(image);
  } else {
    const fallback = document.createElement('div'); fallback.className = 'thumb-fallback'; fallback.title = video.metadataError || 'Preview unavailable'; fallback.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>'; thumb.append(fallback);
  }
  if (video.duration) { const duration = document.createElement('span'); duration.className = 'duration-badge'; duration.textContent = formatDuration(video.duration); thumb.append(duration); }
  const orientation = document.createElement('span'); orientation.className = 'orientation-badge'; orientation.textContent = video.mediaKind === 'audio' ? 'MP3' : video.orientation === 'portrait' ? 'SHORT' : 'VIDEO'; thumb.append(orientation);
  const actions = document.createElement('div'); actions.className = 'card-quick-actions';
  const favorite = document.createElement('button'); favorite.className = `quick-action${isFavorite(video.id) ? ' is-active' : ''}`; favorite.title = isFavorite(video.id) ? 'Remove favorite' : 'Add to favorites'; favorite.setAttribute('aria-label', favorite.title); favorite.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20.8 8.8c0 5.1-8.8 11-8.8 11s-8.8-5.9-8.8-11A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4Z"/></svg>'; favorite.onclick = event => { event.stopPropagation(); toggleFavorite(video); };
  const playlist = document.createElement('button'); playlist.className = 'quick-action'; playlist.title = 'Add to playlist'; playlist.setAttribute('aria-label', playlist.title); playlist.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'; playlist.onclick = event => { event.stopPropagation(); openPlaylistPicker(video); };
  actions.append(favorite, playlist); thumb.append(actions); thumb.onclick = () => showPlayer(video);
  const meta = document.createElement('div'); meta.className = 'card-meta';
  const channel = document.createElement('div'); channel.className = 'channel-mark'; channel.textContent = 'L';
  const info = document.createElement('div'); const title = document.createElement('div'); title.className = 'card-title'; title.textContent = video.name; title.title = video.name; title.onclick = () => showPlayer(video);
  const subtitle = document.createElement('div'); subtitle.className = 'card-subtitle';
  const history = historyFor(video.id); const resolution = video.width && video.height ? `${video.width}×${video.height}` : video.metadataError ? 'Codec not recognized' : formatBytes(video.size);
  subtitle.textContent = `${resolution} · ${history ? `Watched ${formatRelative(history.updatedAt)}` : formatBytes(video.size)}`;
  info.append(title, subtitle);
  const menu = document.createElement('button'); menu.className = 'card-menu'; menu.title = 'Video options'; menu.setAttribute('aria-label', `Options for ${video.name}`); menu.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>'; menu.onclick = event => { event.stopPropagation(); openVideoOptions(video); };
  meta.append(channel, info, menu); card.append(thumb, meta); return card;
}

function render() {
  if (playerView.hidden === false || state.view === 'shorts') return;
  releaseCardUrls(); renderCategories();
  const [eyebrow, title] = views[state.view] || views.home;
  $('#viewEyebrow').textContent = eyebrow;
  $('#viewTitle').textContent = state.view === 'playlistDetail' ? (getPlaylists().find(item => item.id === state.activePlaylist)?.name || 'Playlist') : title;
  const createPlaylistButton = $('#newPlaylistButton'); createPlaylistButton.hidden = !['home', 'playlists', 'playlistDetail'].includes(state.view);
  sortSelect.value = state.sort; sortSelect.parentElement.hidden = ['settings', 'playlists'].includes(state.view);
  if (state.view === 'settings') { renderSettings(); return; }
  if (state.view === 'playlists') { renderPlaylistList(); return; }
  const videos = getVisibleVideos();
  $('#filterSummary').textContent = state.query ? `${videos.length} result${videos.length === 1 ? '' : 's'} for “${state.query}”` : state.view === 'home' && state.category !== 'All' ? `${videos.length} ${state.category.toLowerCase()} video${videos.length === 1 ? '' : 's'}` : '';
  grid.replaceChildren();
  const visible = videos.slice(0, PAGE_SIZE * (state.page + 1));
  visible.forEach(video => grid.append(createCard(video)));
  const isEmpty = !videos.length;
  $('#emptyState').hidden = !isEmpty; grid.hidden = isEmpty;
  $('#loadMoreButton').hidden = visible.length >= videos.length;
  if (isEmpty) {
    const hasLibrary = state.videos.length > 0;
    $('#emptyTitle').textContent = state.query ? 'No matching videos.' : hasLibrary ? 'Nothing to see here yet.' : 'Your library, your rules.';
    $('#emptyMessage').textContent = state.query ? 'Try another filename, resolution, duration, or category.' : hasLibrary ? 'This view is empty. Choose another section or organize videos into a playlist.' : 'Choose a folder to start building your personal collection.';
  }
}

function renderPlaylistList() {
  grid.replaceChildren(); grid.hidden = true; $('#emptyState').hidden = true; $('#loadMoreButton').hidden = true;
  const summary = $('#filterSummary'); summary.replaceChildren();
  const playlists = getPlaylists();
  if (!playlists.length) {
    grid.hidden = false;
    const empty = document.createElement('div'); empty.className = 'empty-state';
    const heading = document.createElement('h2'); heading.textContent = 'A playlist for every mood.';
    const message = document.createElement('p'); message.textContent = 'Group your videos into collections that stay on this device.';
    const button = document.createElement('button'); button.className = 'button button-primary'; button.textContent = 'Create playlist'; button.onclick = createPlaylistDialog;
    empty.append(heading, message, button); grid.append(empty); return;
  }
  grid.hidden = false; grid.className = 'playlist-list';
  for (const playlist of playlists) {
    const row = document.createElement('div'); row.className = 'playlist-row';
    const details = document.createElement('div'); const name = document.createElement('strong'); name.textContent = playlist.name; const count = document.createElement('small'); count.textContent = `${playlist.videos.length} videos`; count.style.cssText = 'display:block;color:#929997;font-size:11px'; details.append(name, count);
    const actions = document.createElement('div');
    const open = document.createElement('button'); open.textContent = 'Open'; open.onclick = () => { state.activePlaylist = playlist.id; state.view = 'playlistDetail'; state.page = 0; render(); };
    const rename = document.createElement('button'); rename.textContent = 'Rename'; rename.onclick = () => renamePlaylistDialog(playlist);
    const remove = document.createElement('button'); remove.textContent = 'Delete'; remove.onclick = () => { if (confirm(`Delete “${playlist.name}”?`)) { deletePlaylist(playlist.id); render(); } };
    actions.append(open, rename, remove); row.append(details, actions); grid.append(row);
  }
}

function renderSettings() {
  grid.replaceChildren(); grid.className = 'settings-list'; grid.hidden = false; $('#emptyState').hidden = true; $('#loadMoreButton').hidden = true;
  const settings = [
    ['Autoplay Shorts', 'Play the visible Short when you scroll to it.', 'autoplayShorts', true],
    ['Start Shorts muted', 'Avoid unexpected audio while browsing Shorts.', 'shortsMuted', true]
  ];
  for (const [label, description, key, fallback] of settings) {
    const row = document.createElement('div'); row.className = 'settings-row'; const text = document.createElement('div'); const title = document.createElement('strong'); title.textContent = label; const detail = document.createElement('small'); detail.textContent = description; text.append(title, detail);
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.className = 'switch'; toggle.checked = getPreference(key, fallback); toggle.onchange = () => setPreference(key, toggle.checked); row.append(text, toggle); grid.append(row);
  }
  const shortcutsRow = document.createElement('div'); shortcutsRow.className = 'settings-row'; const shortcutsText = document.createElement('div'); shortcutsText.innerHTML = '<strong>Keyboard shortcuts</strong><small>Control playback and search without leaving the keyboard.</small>'; const shortcutsButton = document.createElement('button'); shortcutsButton.className = 'button button-subtle'; shortcutsButton.textContent = 'View shortcuts'; shortcutsButton.onclick = showShortcuts; shortcutsRow.append(shortcutsText, shortcutsButton); grid.append(shortcutsRow);
  const historyRow = document.createElement('div'); historyRow.className = 'settings-row'; const historyText = document.createElement('div'); historyText.innerHTML = `<strong>Watch history</strong><small>${state.history.length} saved playback records</small>`; const clear = document.createElement('button'); clear.className = 'button button-subtle'; clear.textContent = 'Clear history'; clear.onclick = async () => { if (!confirm('Clear all local watch history?')) return; await clearHistory(); state.history = []; render(); toast('Watch history cleared.'); }; historyRow.append(historyText, clear); grid.append(historyRow);
  const exportRow = document.createElement('div'); exportRow.className = 'settings-row'; const exportText = document.createElement('div'); exportText.innerHTML = '<strong>Export library list</strong><small>Download video names and metadata. Video files are not included.</small>'; const exportButton = document.createElement('button'); exportButton.className = 'button button-subtle'; exportButton.textContent = 'Export JSON'; exportButton.onclick = exportManifest; exportRow.append(exportText, exportButton); grid.append(exportRow);
  const storageRow = document.createElement('div'); storageRow.className = 'settings-row'; const storageText = document.createElement('div'); storageText.innerHTML = `<strong>Local storage</strong><small>${state.videos.length} videos · ${formatBytes(state.videos.reduce((sum, video) => sum + video.size, 0))} indexed</small>`; storageRow.append(storageText); grid.append(storageRow);
}

function exportManifest() {
  const payload = state.videos.map(({ file, thumbnail, ...metadata }) => metadata);
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'surjotube-library.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderShorts() {
  browseView.hidden = true; shortsView.hidden = false; playerView.hidden = true;
  state.shorts?.dispose();
  state.shorts = mountShorts(shortsView, state.videos, {
    autoplay: () => getPreference('autoplayShorts', true), isMuted: () => getPreference('shortsMuted', true),
    setMuted: value => setPreference('shortsMuted', value),
    getReactions: () => getPreference('shortReactions', {}), saveReactions: value => setPreference('shortReactions', value),
    onImport: openDirectoryPicker, onComment: openComments,
    onWatch: video => updateProgress(video, 0, video.duration), toast
  });
}

function openModal(title, body, buttons = []) {
  const root = $('#modalRoot'); root.replaceChildren();
  const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div'); modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  const heading = document.createElement('h2'); heading.textContent = title; modal.append(heading);
  if (typeof body === 'string') { const text = document.createElement('p'); text.textContent = body; modal.append(text); } else modal.append(body);
  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const cancel = document.createElement('button'); cancel.className = 'button button-subtle'; cancel.textContent = 'Cancel'; cancel.onclick = () => root.replaceChildren(); actions.append(cancel);
  buttons.forEach(({ label, primary = false, onClick }) => { const button = document.createElement('button'); button.className = `button ${primary ? 'button-primary' : 'button-subtle'}`; button.textContent = label; button.onclick = () => onClick(root); actions.append(button); });
  modal.append(actions); backdrop.append(modal); backdrop.onclick = event => { if (event.target === backdrop) root.replaceChildren(); }; root.append(backdrop);
}
function createPlaylistDialog() {
  const input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Playlist name'; input.maxLength = 70;
  openModal('Create playlist', input, [{ label: 'Create', primary: true, onClick: root => { const name = input.value.trim(); if (!name) { toast('Enter a playlist name.', true); return; } createPlaylist(name); root.replaceChildren(); toast('Playlist created.'); render(); } }]); input.focus();
}
function renamePlaylistDialog(playlist) {
  const input = document.createElement('input'); input.type = 'text'; input.value = playlist.name; input.maxLength = 70;
  openModal('Rename playlist', input, [{ label: 'Save', primary: true, onClick: root => { if (!input.value.trim()) { toast('Enter a playlist name.', true); return; } renamePlaylist(playlist.id, input.value); root.replaceChildren(); render(); } }]); input.focus(); input.select();
}
function openPlaylistPicker(video) {
  const body = document.createElement('div'); const playlists = getPlaylists();
  if (!playlists.length) { const message = document.createElement('p'); message.textContent = 'Create a playlist before adding videos.'; body.append(message); }
  playlists.forEach(playlist => {
    const row = document.createElement('label'); row.className = 'settings-row'; row.style.padding = '9px 0'; const name = document.createElement('span'); name.textContent = playlist.name; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = playlist.videos.includes(video.id); checkbox.onchange = () => { togglePlaylistVideo(playlist.id, video.id); toast(checkbox.checked ? 'Added to playlist.' : 'Removed from playlist.'); }; row.append(name, checkbox); body.append(row);
  });
  openModal(`Add “${video.name}” to`, body, [{ label: 'New playlist', onClick: root => { root.replaceChildren(); createPlaylistDialog(); } }]);
}
function openVideoOptions(video) {
  const body = document.createElement('div');
  const info = document.createElement('p'); info.textContent = `${video.width && video.height ? `${video.width} × ${video.height}` : 'Resolution unavailable'} · ${formatDuration(video.duration)} · ${formatBytes(video.size)}`; body.append(info);
  openModal(video.name, body, [
    { label: isFavorite(video.id) ? 'Remove favorite' : 'Add favorite', onClick: root => { root.replaceChildren(); toggleFavorite(video); } },
    { label: 'Remove from library', primary: true, onClick: async root => { if (!confirm(`Remove “${video.name}” from Local YouTube? The original file will not be deleted.`)) return; root.replaceChildren(); await removeVideo(video.id); state.videos = state.videos.filter(item => item.id !== video.id); state.history = state.history.filter(item => item.id !== video.id); await refresh(); toast('Removed from your library.'); } }
  ]);
}
function openComments(video) {
  const body = document.createElement('div'); const key = `comments:${video.id}`; const comments = getPreference(key, []);
  const list = document.createElement('div'); list.className = 'comments-list';
  comments.forEach(comment => { const row = document.createElement('div'); row.className = 'comment-item'; row.textContent = comment.text; const date = document.createElement('small'); date.textContent = formatRelative(comment.at); row.append(date); list.append(row); });
  if (!comments.length) { const note = document.createElement('p'); note.textContent = 'No comments yet. Add a note for yourself.'; list.append(note); }
  const input = document.createElement('textarea'); input.placeholder = 'Add a local note…'; input.rows = 2; body.append(list, input);
  openModal('Comments', body, [{ label: 'Post', primary: true, onClick: root => { const text = input.value.trim(); if (!text) return; comments.unshift({ text, at: Date.now() }); setPreference(key, comments); root.replaceChildren(); toast('Comment saved on this device.'); } }]);
}

function openDirectoryPicker() {
  if (!window.showDirectoryPicker) {
    fileInput.setAttribute('webkitdirectory', ''); fileInput.setAttribute('directory', ''); fileInput.click();
    toast('Choose a folder in the file picker.'); return;
  }
  window.showDirectoryPicker({ mode: 'read' }).then(async handle => {
    await saveDirectoryHandle(handle);
    const files = walkDirectory(handle);
    await importFileStream(files);
  }).catch(error => { if (error.name !== 'AbortError') toast(error.message || 'Could not open that folder.', true); });
}
async function importFileStream(fileStream) {
  if (isImporting) return;
  isImporting = true; $('#folderButton').disabled = true;
  const known = new Set(state.videos.map(video => `${video.name}:${video.size}:${video.lastModified}`));
  let added = 0; let skipped = 0; let processed = 0;
  try {
    for await (const file of fileStream) {
      if (!isVideoFile(file)) continue;
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (known.has(key)) { skipped++; continue; }
      const video = await prepareVideo(file);
      await saveVideo(video); state.videos.unshift(video); known.add(key); added++; processed++;
      if (processed % 4 === 0) { updateCounts(); toast(`Adding videos… ${processed} processed`); }
    }
    state.videos.sort((a, b) => b.addedAt - a.addedAt); updateCounts(); state.page = 0;
    await refresh();
    toast(added ? `Added ${added} video${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} already in your library` : ''}.` : skipped ? 'These videos are already in your library.' : 'No supported video files found.');
  } catch (error) {
    toast(error.name === 'QuotaExceededError' ? 'Browser storage is full. Remove videos or free disk space and try again.' : error.message || 'Some videos could not be added.', true);
  } finally { isImporting = false; $('#folderButton').disabled = false; }
}

async function refreshPcVideos() {
  try {
    const response = await fetch('/api/videos', { cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json();
    const signature = result.videos.map(video => `${video.id}:${video.size}:${video.lastModified}`).join('|');
    if (result.videos.length && signature !== state.pcVideoSignature) {
      const existing = new Map(state.videos.filter(video => !video.fileUrl).map(video => [video.id, video]));
      state.pcVideoSignature = signature;
      state.videos = result.videos.map(video => ({
        ...video,
        thumbnail: existing.get(video.id)?.thumbnail || null,
        metadataError: '',
      }));
      updateCounts();
      render();
    }
  } catch (error) {
    // The browser-only mode still works if the backend is unavailable.
  }
}

async function refresh() {
  try { state.videos = await getVideos(); state.videos.sort((a, b) => b.addedAt - a.addedAt); state.history = await getHistory(); state.history.sort((a, b) => b.updatedAt - a.updatedAt); updateCounts(); render(); }
  catch (error) { toast(error.message || 'Could not load your local library.', true); }
}

function updateSearch() {
  state.query = $('#searchInput').value.trim(); $('#clearSearch').style.display = $('#searchInput').value ? 'block' : 'none'; state.page = 0; render();
  const root = $('#searchSuggestions'); const matches = getSuggestions(state.videos, $('#searchInput').value);
  root.replaceChildren();
  matches.forEach(video => { const button = document.createElement('button'); button.className = 'suggestion'; button.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>'; const name = document.createElement('span'); name.textContent = video.name; const duration = document.createElement('small'); duration.textContent = formatDuration(video.duration); button.append(name, duration); button.onclick = () => { $('#searchInput').value = video.name; state.query = video.name; root.hidden = true; render(); }; root.append(button); });
  root.hidden = !matches.length || !$('#searchInput').value;
}

$('#sidebar').addEventListener('click', event => { const button = event.target.closest('.nav-item[data-view]'); if (button) setView(button.dataset.view); });
$('#sidebarToggle').onclick = () => shell.classList.toggle('sidebar-collapsed');
$('#shuffleButton').onclick = playRandomVideo;
$('#refreshButton').onclick = async () => { await refreshPcVideos(); toast('Library refreshed.'); };
$('#folderButton').onclick = openDirectoryPicker;
fileInput.addEventListener('change', async () => { const files = [...fileInput.files]; fileInput.value = ''; fileInput.removeAttribute('webkitdirectory'); fileInput.removeAttribute('directory'); await importFileStream(files); });
$('#subtitleInput').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) state.player?.setSubtitle(file); event.target.value = ''; });
$('#searchInput').addEventListener('input', updateSearch);
$('#searchInput').addEventListener('focus', updateSearch);
$('#searchInput').addEventListener('keydown', event => { if (event.key === 'Escape') { $('#searchSuggestions').hidden = true; $('#searchInput').blur(); } if (event.key === 'Enter') $('#searchSuggestions').hidden = true; });
$('#clearSearch').onclick = () => { $('#searchInput').value = ''; updateSearch(); $('#searchInput').focus(); };
document.addEventListener('click', event => { if (!event.target.closest('.search-wrap')) $('#searchSuggestions').hidden = true; });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); } });
document.addEventListener('keydown', event => { if (event.key === '?' && !event.target.matches('input,textarea,select')) { event.preventDefault(); showShortcuts(); } });
sortSelect.onchange = () => { state.sort = sortSelect.value; render(); };
$('#newPlaylistButton').onclick = createPlaylistDialog;
$('#loadMoreButton').onclick = () => { state.page++; render(); };

async function reconnectSavedDirectory() {
  if (!window.showDirectoryPicker) return;
  try {
    const handle = await getDirectoryHandle();
    if (!handle) return;
    const permission = await handle.queryPermission?.({ mode: 'read' });
    if (permission === 'granted') await importFileStream(walkDirectory(handle));
  } catch (error) {
    await clearDirectoryHandle();
  }
}

try {
  await refresh();
  await refreshPcVideos();
  await reconnectSavedDirectory();
  setInterval(refreshPcVideos, 15000);
} catch (error) { toast(error.message || 'Local YouTube could not start.', true); }
