# Chrome Recorder

Record your active browser tab, your window, or entire screen as a WebM video — with an optional webcam picture-in-picture overlay — using native Chrome. One click or a keyboard shortcut.

[chrome-recording-2026-04-08T02-24-19-256Z.webm](https://github.com/user-attachments/assets/50bf2c84-67f4-4e45-b505-2a8fc839c708)


## Features

- Record any browser tab with audio
- **Webcam picture-in-picture** — overlay your camera in a corner, streamer-style, with your mic mixed in
- Toggle the webcam and move it between corners mid-recording, by hotkey, without stopping
- Draggable recording indicator on the page — click to stop
- Keyboard shortcuts to start/stop without opening the popup
- Automatic save to Downloads as WebM
- Clean popup with live timer
- State survives the service worker sleeping — the timer and badge stay correct on long recordings

## Webcam overlay

Turn on **Webcam overlay** in the popup and pick a corner. The first time, Chrome asks for camera permission — grant it once. The screen capture stays the main video; your webcam rides in the chosen corner with your mic mixed into the audio.

Everything is composited into a single WebM — no separate files to stitch.

Mid-recording, by keyboard:

- `Ctrl+Shift+8` (`Cmd+Shift+8`) — show/hide the webcam. Hiding it turns the camera light off.
- `Ctrl+Shift+7` (`Cmd+Shift+7`) — move the webcam to the next corner.

The recording never pauses — toggling and moving the overlay leaves one continuous take.

There's no live self-view: the webcam is composited straight into the file, so you won't see yourself on screen while recording.

## Install

1. Download and unzip the latest release from the [releases page](https://github.com/mbarlow/chrome-recorder/releases), or clone this repo
2. Open `chrome://extensions`
3. Enable Developer Mode
4. Click "Load unpacked" and select the unzipped directory

## Usage

Click the extension icon and press "Start Recording", or press `Ctrl+Shift+9` (`Cmd+Shift+9` on Mac). Click the floating indicator on the page or hit the shortcut again to stop. The recording saves automatically to your Downloads folder.

Rebind any shortcut at `chrome://extensions/shortcuts`.

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+Shift+9` | Start / stop recording |
| `Ctrl/Cmd+Shift+8` | Show / hide webcam overlay |
| `Ctrl/Cmd+Shift+7` | Move webcam to next corner |

## License

MIT
