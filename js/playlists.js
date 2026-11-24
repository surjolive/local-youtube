import { getPreference, setPreference } from './storage.js';

export function getPlaylists() { return getPreference('playlists', []); }
export function savePlaylists(playlists) { setPreference('playlists', playlists); }
export function createPlaylist(name) {
  const playlists = getPlaylists();
  const playlist = { id: crypto.randomUUID(), name: name.trim(), videos: [], createdAt: Date.now() };
  playlists.push(playlist);
  savePlaylists(playlists);
  return playlist;
}
export function renamePlaylist(id, name) {
  const playlists = getPlaylists().map(playlist => playlist.id === id ? { ...playlist, name: name.trim() } : playlist);
  savePlaylists(playlists);
}
export function deletePlaylist(id) { savePlaylists(getPlaylists().filter(playlist => playlist.id !== id)); }
export function togglePlaylistVideo(playlistId, videoId) {
  const playlists = getPlaylists().map(playlist => {
    if (playlist.id !== playlistId) return playlist;
    const videos = playlist.videos.includes(videoId) ? playlist.videos.filter(id => id !== videoId) : [...playlist.videos, videoId];
    return { ...playlist, videos };
  });
  savePlaylists(playlists);
}
