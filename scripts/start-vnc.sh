#!/bin/bash
# Start Xvfb (virtual framebuffer), fluxbox (window manager), x11vnc, and noVNC
# This enables manual browser login via noVNC in the browser

VNC_PORT="${VNC_PORT:-6080}"
DISPLAY_NUM=":99"

export DISPLAY=$DISPLAY_NUM

# Start virtual display
Xvfb $DISPLAY_NUM -screen 0 1280x720x24 &
sleep 1

# Start window manager (minimal)
fluxbox &
sleep 1

# Start VNC server on the virtual display
x11vnc -display $DISPLAY_NUM -nopw -forever -shared -rfbport 5900 &
sleep 1

# Start noVNC websocket proxy
websockify --web /usr/share/novnc/ $VNC_PORT localhost:5900 &

echo "noVNC available at http://localhost:$VNC_PORT"
