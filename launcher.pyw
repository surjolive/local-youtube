import os
import socket
import threading
import webbrowser
import tkinter as tk
from http.server import ThreadingHTTPServer

import server

PORT = 8000


def get_lan_addresses():
    addresses = set()
    try:
        for address_info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = address_info[4][0]
            if not address.startswith("127."):
                addresses.add(address)
    except OSError:
        pass
    return sorted(addresses)


os.chdir(server.RESOURCE_DIR)
server.start_scan()
http_server = ThreadingHTTPServer(("0.0.0.0", PORT), server.LocalYouTubeHandler)
threading.Thread(target=http_server.serve_forever, daemon=True).start()

root = tk.Tk()
root.title("Local YouTube")
root.geometry("460x250")
root.resizable(False, False)

frame = tk.Frame(root, padx=24, pady=20)
frame.pack(fill="both", expand=True)

label = tk.Label(frame, text="Local YouTube is running", font=("Segoe UI", 16, "bold"))
label.pack(anchor="w")

local_label = tk.Label(frame, text="Local: http://localhost:8000", font=("Segoe UI", 11))
local_label.pack(anchor="w", pady=(12, 4))

lan_addresses = get_lan_addresses()
if lan_addresses:
    tk.Label(frame, text="Wi-Fi / LAN:", font=("Segoe UI", 10, "bold")).pack(anchor="w", pady=(8, 2))
    for address in lan_addresses:
        tk.Label(frame, text=f"  http://{address}:{PORT}", font=("Segoe UI", 11)).pack(anchor="w")
else:
    tk.Label(frame, text="No Wi-Fi/LAN address detected", font=("Segoe UI", 10)).pack(anchor="w", pady=(8, 2))

button_frame = tk.Frame(frame)
button_frame.pack(anchor="e", pady=(14, 0))

def open_app():
    webbrowser.open("http://localhost:8000")


tk.Button(button_frame, text="Open in browser", command=open_app, width=18).pack(side="left")
tk.Button(button_frame, text="Close", command=root.destroy, width=10).pack(side="left", padx=(8, 0))

open_app()
root.mainloop()
http_server.server_close()
