---
name: this-machine
description: open window, run app, GUI, screenshot, keys, native app, Qt, Electron, --headed, xdg-open, browser, image viewer, DISPLAY, Xvfb, xdotool, GPU, hwdec, NVDEC.
---

# This machine

This is the user's own desktop: Linux Mint, XFCE on X11, an NVIDIA RTX 4070 SUPER. The user works on this screen while agents run, and a new window takes their keyboard. Never open anything on it.

## Never open anything on the user's screen

- Don't use `xdg-open`, a browser, an image viewer, or a file manager. To look at an image, read it with your file tool and embed it in your reply. Use `gh` for PRs and a T3 preview tab for web pages.
- Never pass `--headed` or set `PIXVITTA_TEST_HEADED=1`, and never run the Electron app or the native app on the real display.

## Every window goes on a hidden display

`pnpm app` and the Electron tests already use one. For anything else, such as the native app, start your own:

```sh
.agents/skills/this-machine/screen.sh                      # prints DISPLAY=:N XVFB_PID=<pid>
DISPLAY=:N native/linux/build/pixvitta <folder> &
W=$(DISPLAY=:N xdotool search --sync --onlyvisible --class pixvitta | head -1)
DISPLAY=:N xdotool windowfocus --sync $W key Right         # focus it once, then press keys
DISPLAY=:N import -window root .tmp/screen.png             # screenshot, then read it
kill <app pid> <xvfb pid>                                  # when done
```

Set `DISPLAY=:N` from `screen.sh` explicitly on every command. Your shell's `DISPLAY` is the user's screen, so an app that inherits it opens there.

Keys work: focus the window once with `windowfocus`, then send them. The hidden display has no window manager, so nothing focuses it for you. After that, plain `DISPLAY=:N xdotool key Right` reaches it. If `xdotool` is missing, ask the user to run `sudo apt install xdotool` once, and do not look for another way to send keys.

Clicks are out of scope. If checking a change needs the mouse (buttons, drag, hover), do not try it on the hidden display, and do not improvise with `xdotool click`. Skip that check and tell the user in your reply that it was not checked.

Wait on the app, never with a sleep: `xdotool search --sync` waits for a window to appear. The native app's title is `<file> - Pixvitta`, so `DISPLAY=:N xdotool search --sync --name '^b.png - Pixvitta'` waits until a key press has moved to `b.png`.

It renders with Mesa's software OpenGL: slow, but correct for looks, layout, and keys.

## GPU work needs no window

- The core's tests and corpus check need no display: `cargo test --release --manifest-path native/core/Cargo.toml`.
- To check hardware decoding, run libmpv with `vo=null` and `hwdec=nvdec-copy`, and read `hwdec-current`. NVDEC works here. VA-API does not, because `nvidia-vaapi-driver` is not installed.

## When you need the real screen

Only the zero-copy render path, where frames go from the GPU straight into Qt, needs a real GPU-backed window. Ask the user first and say what and for how long, such as "I need your screen for about 30 seconds to check zero-copy video." Run it only after a yes, and close it when done.
