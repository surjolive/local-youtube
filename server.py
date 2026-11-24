import html
import mimetypes
import os
import pathlib
import subprocess
import threading
import urllib.parse
import socket
import webbrowser
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mp3"}
SKIP_DIR_NAMES = {"$recycle.bin", "system volume information", "windows", "node_modules", ".git", "appdata"}
video_cache = []
scan_lock = threading.Lock()
scan_started = False
RESOURCE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
THUMBNAIL_DIR = os.path.join(RESOURCE_DIR, ".thumbnails")
COMPATIBLE_DIR = os.path.join(RESOURCE_DIR, ".compatible")
os.makedirs(THUMBNAIL_DIR, exist_ok=True)
os.makedirs(COMPATIBLE_DIR, exist_ok=True)


def available_drives():
    drives = []
    if os.name == "nt":
        import ctypes
        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        for index in range(26):
            if bitmask & (1 << index):
                drive = f"{chr(65 + index)}:\\"
                if os.path.isdir(drive):
                    drives.append(drive)
    else:
        drives = ["/"]
    return drives


def scan_drives():
    global video_cache
    found = []
    seen_paths = set()

    for drive in available_drives():
        for root, directories, files in os.walk(drive, onerror=lambda error: None):
            directories[:] = [
                name for name in directories
                if name.lower() not in SKIP_DIR_NAMES
                and not name.startswith(".")
            ]
            for name in files:
                extension = pathlib.Path(name).suffix.lower()
                if extension not in VIDEO_EXTENSIONS:
                    continue
                if name.lower().startswith("."):
                    continue
                path = os.path.abspath(os.path.join(root, name))
                if path in seen_paths:
                    continue
                seen_paths.add(path)
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                found.append({
                    "id": "pc-" + str(len(seen_paths)),
                    "name": name,
                    "path": path,
                    "size": stat.st_size,
                    "lastModified": int(stat.st_mtime * 1000),
                    "addedAt": int(stat.st_mtime * 1000),
                    "duration": 0,
                    "width": 0,
                    "height": 0,
                    "orientation": "unknown",
                    "type": mimetypes.guess_type(path)[0] or ("audio/mpeg" if extension == ".mp3" else "video/" + extension.lstrip(".")),
                    "mediaKind": "audio" if extension == ".mp3" else "video",
                    "fileUrl": "/media?path=" + urllib.parse.quote(path),
                    "thumbnailUrl": (None if extension == ".mp3" else "/thumbnail?path=" + urllib.parse.quote(path)),
                })

    found.sort(key=lambda video: (video["lastModified"], video["name"].lower()), reverse=True)
    for index, video in enumerate(found):
        video["id"] = f"pc-{index}-{abs(hash(video['path']))}"

    with scan_lock:
        video_cache = found


def start_scan():
    global scan_started
    with scan_lock:
        if scan_started:
            return
        scan_started = True
    threading.Thread(target=scan_drives, daemon=True).start()


class LocalYouTubeHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def send_json(self, payload, status=200):
        body = __import__("json").dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        global scan_started
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/drives":
            self.send_json({"drives": available_drives()})
            return

        if parsed.path == "/api/videos":
            start_scan()
            with scan_lock:
                payload = list(video_cache)
            self.send_json({"scanning": scan_started and not payload, "count": len(payload), "videos": payload})
            return

        if parsed.path == "/api/scan":
            with scan_lock:
                if not scan_started:
                    threading.Thread(target=scan_drives, daemon=True).start()
                    scan_started = True
            self.send_json({"started": True})
            return

        if parsed.path == "/thumbnail":
            query = urllib.parse.parse_qs(parsed.query)
            raw_path = query.get("path", [""])[0]
            path = os.path.abspath(raw_path)
            if pathlib.Path(path).suffix.lower() == ".mp3":
                self.send_error(404, "Audio thumbnails are unavailable")
                return
            allowed = any(path.lower().startswith(drive.lower()) for drive in available_drives())
            if not allowed or not os.path.isfile(path):
                self.send_error(404, "Video not found")
                return

            import hashlib
            cache_name = hashlib.sha1(path.encode("utf-8")).hexdigest() + ".jpg"
            cache_path = os.path.join(THUMBNAIL_DIR, cache_name)

            if not os.path.isfile(cache_path):
                ffmpeg = r"C:\Users\SURJO LIVE\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build-shared\bin\ffmpeg.exe"
                if os.path.isfile(ffmpeg):
                    subprocess.run([
                        ffmpeg, "-y", "-ss", "1", "-i", path,
                        "-frames:v", "1", "-vf", "scale=480:-2", "-update", "1", cache_path
                    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False)

            if not os.path.isfile(cache_path):
                body = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270"><rect width="480" height="270" fill="#202324"/><path d="m205 86 110 49-110 49z" fill="#fa4b3b"/></svg>'
                self.send_response(200)
                self.send_header("Content-Type", "image/svg+xml")
                self.send_header("Cache-Control", "public, max-age=3600")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            with open(cache_path, "rb") as image:
                body = image.read()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == "/compatible":
            query = urllib.parse.parse_qs(parsed.query)
            raw_path = query.get("path", [""])[0]
            path = os.path.abspath(raw_path)
            allowed = any(path.lower().startswith(drive.lower()) for drive in available_drives())
            if not allowed or not os.path.isfile(path):
                self.send_error(404, "Video not found")
                return

            import hashlib
            cache_name = hashlib.sha1(path.encode("utf-8")).hexdigest() + ".mp4"
            cache_path = os.path.join(COMPATIBLE_DIR, cache_name)

            if not os.path.isfile(cache_path):
                ffmpeg = r"C:\Users\SURJO LIVE\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build-shared\bin\ffmpeg.exe"
                if not os.path.isfile(ffmpeg):
                    self.send_error(500, "FFmpeg unavailable")
                    return
                temp_path = cache_path + ".tmp.mp4"
                subprocess.run([
                    ffmpeg, "-y", "-i", path,
                    "-map", "0:v:0", "-map", "0:a?",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+faststart", "-f", "mp4", temp_path
                ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3600, check=False)
                if os.path.isfile(temp_path) and os.path.getsize(temp_path) > 0:
                    os.replace(temp_path, cache_path)

            if not os.path.isfile(cache_path):
                self.send_error(500, "Could not convert this video")
                return

            parsed = urllib.parse.urlparse("/media")
            raw_path = cache_path
            path = os.path.abspath(raw_path)
            mime = "video/mp4"
            size = os.path.getsize(path)
            range_header = self.headers.get("Range")
            start = 0
            end = size - 1
            status = 200
            if range_header:
                try:
                    unit, range_text = range_header.split("=", 1)
                    if unit.strip().lower() == "bytes":
                        range_start, range_end = range_text.strip().split("-", 1)
                        start = int(range_start) if range_start else 0
                        if range_end:
                            end = min(int(range_end), end)
                        status = 206
                except (ValueError, AttributeError):
                    pass
            length = end - start + 1
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Accept-Ranges", "bytes")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            with open(path, "rb") as stream:
                stream.seek(start)
                remaining = length
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            return

        if parsed.path == "/media":
            query = urllib.parse.parse_qs(parsed.query)
            raw_path = query.get("path", [""])[0]
            path = os.path.abspath(raw_path)
            allowed = any(path.lower().startswith(drive.lower()) for drive in available_drives())
            if pathlib.Path(path).suffix.lower() not in {".mp4", ".mov", ".mp3"}:
                self.send_error(404, "Unsupported media format")
                return
            if not allowed or not os.path.isfile(path):
                self.send_error(404, "Video not found")
                return

            mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
            size = os.path.getsize(path)
            range_header = self.headers.get("Range")
            start = 0
            end = size - 1
            status = 200

            if range_header:
                try:
                    unit, range_text = range_header.split("=", 1)
                    if unit.strip().lower() == "bytes":
                        range_start, range_end = range_text.strip().split("-", 1)
                        start = int(range_start) if range_start else 0
                        if range_end:
                            end = min(int(range_end), end)
                        status = 206
                except (ValueError, AttributeError):
                    pass

            length = end - start + 1
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Accept-Ranges", "bytes")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Disposition", "inline; filename*=UTF-8''" + urllib.parse.quote(os.path.basename(path)))
            self.end_headers()

            with open(path, "rb") as stream:
                stream.seek(start)
                remaining = length
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            return

        super().do_GET()


def get_lan_addresses():
    addresses = set()
    try:
        for address_info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = address_info[4][0]
            if not address.startswith("127."):
                addresses.add(address)
    except OSError:
        pass

    for network_address in ("192.168.", "10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31."):
        addresses = {address for address in addresses if address.startswith(network_address)}
        if addresses:
            break
    return sorted(addresses)


if __name__ == "__main__":
    os.chdir(RESOURCE_DIR)
    start_scan()
    server = ThreadingHTTPServer(("0.0.0.0", 8000), LocalYouTubeHandler)
    for address in get_lan_addresses():
        pass
    webbrowser.open("http://localhost:8000")
    server.serve_forever()
