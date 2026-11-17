#!/usr/bin/env bash
# Starts a private invisible display, so an agent's windows never reach the user's screen.
# Prints DISPLAY=:N XVFB_PID=<pid>. Run apps with that DISPLAY, then kill the PID when done.
set -euo pipefail

fifo=$(mktemp -u)
mkfifo "$fifo"
# -displayfd picks a free display number and writes it once the server is ready.
setsid Xvfb -displayfd 3 -screen 0 2560x1440x24 -nolisten tcp 3>"$fifo" >/dev/null 2>&1 &
pid=$!
read -r display <"$fifo"
rm "$fifo"
echo "DISPLAY=:$display XVFB_PID=$pid"
