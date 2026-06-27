# Offline Slideshow Studio

Browser-only slideshow/video builder for images plus two audio tracks.

What it does:

- keeps user media in the browser rather than uploading to an application server
- guesses image order with natural filename sorting
- lets the user reorder slides interactively with drag/drop or up/down buttons
- accepts either individual images or a ZIP archive of images
- supports per-slide duration and per-slide transition selection
- mixes a primary audio track with background music
- applies configurable background-music start time, fade-in, and gain ratios
- exports MP4 by default, with WebM and GIF options

Implemented transition set:

- Cut
- Fade
- Crossfade
- Slide left
- Slide right
- Slide up
- Slide down
- Wipe left
- Wipe right
- Zoom in
- Zoom out

## Architecture

- Rendering: HTML canvas in the browser
- Timeline capture: `canvas.captureStream()` + `MediaRecorder`
- Final encoding / muxing: `ffmpeg.wasm`
- Audio mix: ffmpeg filter graph with `volume`, `adelay`, `afade`, and `amix`

## Current implementation

- user media stays in the browser
- ffmpeg, ffmpeg-core, and JSZip are vendored locally in `vendor/`
- `example/` contains a test bundle:
  - `images.zip`
  - `overlay.wav`
  - `background.wav`

## Run locally

This is a static app. Serve the folder from a local web server rather than opening `index.html` directly.

Example:

```bash
cd ~/Dropbox/Projects/offline-slideshow-studio
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

This repo includes [`.github/workflows/pages.yml`](./.github/workflows/pages.yml) for GitHub Pages deployment via Actions.

Typical setup:

1. Push the repo to GitHub.
2. In GitHub repository settings, set Pages source to GitHub Actions.
3. Push to `main` or run the workflow manually.

Because the site uses relative asset paths, it works as a project Pages site without changing the app base path.

## Example test mode

Click `Load sample assets` to load the ZIP and audio files from `example/`.

There is also an auto-run mode for browser automation:

```text
http://localhost:8080/?autoload=1&encoder=1&autoexport=1&expose=1
```

Useful flags:

- `autoload=1` loads assets from `example/`
- `encoder=1` loads ffmpeg
- `autopreview=1` renders preview
- `autoexport=1` renders export
- `expose=1` exposes the exported blob to automation code

## Suggested next hardening steps

1. Replace the real-time preview/export capture path with an offline frame pipeline so export time is not tied to wall-clock duration.
2. Add resumable export state and cancellation.
3. Add waveform preview and interactive audio trimming.
4. Add project save/load as JSON.
5. Add better order guessing from EXIF capture timestamps when available.

