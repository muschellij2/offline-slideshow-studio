# Offline Slideshow Studio

Browser-only slideshow/video builder for images plus two audio tracks.

What it does:

- keeps user media in the browser rather than uploading to an application server
- guesses image order with natural filename sorting
- lets the user reorder slides interactively with drag/drop or up/down buttons
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

## Current constraint

The app is serverless from a media-processing standpoint, but `app.js` currently loads `ffmpeg.wasm` from jsDelivr at runtime. That means:

- user media is not uploaded to your backend
- the browser does fetch library assets from a CDN unless you vendor them locally

If you need a fully air-gapped deployment, replace the CDN URLs in `app.js` with local files under something like `vendor/ffmpeg/`.

## Run locally

This is a static app. Serve the folder from a local web server rather than opening `index.html` directly.

Example:

```bash
cd offline-slideshow-studio
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Suggested next hardening steps

1. Vendor `@ffmpeg/ffmpeg`, `@ffmpeg/util`, and `@ffmpeg/core` locally for true offline use.
2. Add resumable export state and cancellation.
3. Add waveform preview and interactive audio trimming.
4. Add project save/load as JSON.
5. Add better order guessing from EXIF capture timestamps when available.
