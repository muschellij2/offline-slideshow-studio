const TRANSITIONS = [
  { value: "none", label: "Cut" },
  { value: "fade", label: "Fade" },
  { value: "crossfade", label: "Crossfade" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-right", label: "Slide right" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-down", label: "Slide down" },
  { value: "wipe-left", label: "Wipe left" },
  { value: "wipe-right", label: "Wipe right" },
  { value: "zoom-in", label: "Zoom in" },
  { value: "zoom-out", label: "Zoom out" },
];

const els = {
  imagesInput: document.querySelector("#images-input"),
  voiceInput: document.querySelector("#voice-input"),
  musicInput: document.querySelector("#music-input"),
  loadSampleBtn: document.querySelector("#load-sample-btn"),
  imageList: document.querySelector("#image-list"),
  defaultTransitionSelect: document.querySelector("#default-transition-select"),
  guessOrderBtn: document.querySelector("#guess-order-btn"),
  applyDefaultTransitionBtn: document.querySelector("#apply-default-transition-btn"),
  widthInput: document.querySelector("#width-input"),
  heightInput: document.querySelector("#height-input"),
  fpsInput: document.querySelector("#fps-input"),
  fitSelect: document.querySelector("#fit-select"),
  durationInput: document.querySelector("#duration-input"),
  transitionDurationInput: document.querySelector("#transition-duration-input"),
  outputFormatSelect: document.querySelector("#output-format-select"),
  voiceVolumeInput: document.querySelector("#voice-volume-input"),
  musicVolumeInput: document.querySelector("#music-volume-input"),
  musicStartInput: document.querySelector("#music-start-input"),
  musicFadeInput: document.querySelector("#music-fade-input"),
  previewBtn: document.querySelector("#preview-btn"),
  exportBtn: document.querySelector("#export-btn"),
  canvas: document.querySelector("#preview-canvas"),
  previewVideo: document.querySelector("#preview-video"),
  previewProgressBar: document.querySelector("#preview-progress-bar"),
  exportProgressBar: document.querySelector("#export-progress-bar"),
  logOutput: document.querySelector("#log-output"),
  downloadLink: document.querySelector("#download-link"),
  quickPreviewDialog: document.querySelector("#quick-preview-dialog"),
  quickPreviewTitle: document.querySelector("#quick-preview-title"),
  quickPreviewImage: document.querySelector("#quick-preview-image"),
  quickPreviewDownload: document.querySelector("#quick-preview-download"),
  quickPreviewCloseBtn: document.querySelector("#quick-preview-close-btn"),
  resetEqualFitBtn: document.querySelector("#reset-equal-fit-btn"),
  timingOverlay: document.querySelector("#timing-overlay"),
  timingStills: document.querySelector("#timing-stills"),
  timingTransitions: document.querySelector("#timing-transitions"),
  timingRequested: document.querySelector("#timing-requested"),
  timingEffective: document.querySelector("#timing-effective"),
  timingWarning: document.querySelector("#timing-warning"),
  previewStatus: document.querySelector("#preview-status"),
  exportStatus: document.querySelector("#export-status"),
};

const state = {
  slides: [],
  voiceFile: null,
  musicFile: null,
  voiceDuration: null,
  ffmpeg: null,
  ffmpegLoaded: false,
  ffmpegLoadPromise: null,
  dragIndex: null,
  objectUrls: [],
  lastExportBlob: null,
  lastPreviewBlob: null,
};

const SAMPLE_ASSETS = {
  imagesZip: "./example/images.zip",
  voice: "./example/overlay.wav",
  music: "./example/background.wav",
};

const canvasCtx = els.canvas.getContext("2d");

function log(message) {
  els.logOutput.textContent += `${message}\n`;
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function setStatus(el, value) {
  el.textContent = value;
}

function setProgress(kind, value) {
  const normalized = Math.max(0, Math.min(1, value));
  if (kind === "preview") els.previewProgressBar.value = normalized;
  if (kind === "export") els.exportProgressBar.value = normalized;
}

function setButtonState(kind, disabled) {
  if (kind === "preview") els.previewBtn.disabled = disabled;
  if (kind === "export") els.exportBtn.disabled = disabled;
}

function populateTransitions() {
  TRANSITIONS.forEach((transition) => {
    const option = document.createElement("option");
    option.value = transition.value;
    option.textContent = transition.label;
    els.defaultTransitionSelect.append(option);
  });
  els.defaultTransitionSelect.value = "fade";
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function guessSortedSlides(files) {
  return [...files]
    .sort((a, b) => {
      const byName = naturalCompare(a.name, b.name);
      if (byName !== 0) return byName;
      return a.lastModified - b.lastModified;
    })
    .map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}`,
      file,
      transition: index === 0 ? "none" : els.defaultTransitionSelect.value,
      duration: Number(els.durationInput.value) || 3,
      img: null,
      thumbUrl: null,
    }));
}

function formatSeconds(seconds) {
  return `${seconds.toFixed(2)}s`;
}

function getRequestedStillsDuration() {
  return state.slides.reduce((sum, slide) => sum + Math.max(0.01, Number(slide.duration) || 0), 0);
}

function getRequestedTransitionDuration() {
  const transitionDuration = Math.max(0, Number(els.transitionDurationInput.value) || 0);
  return transitionDuration * Math.max(0, state.slides.length - 1);
}

function getRequestedTimelineDuration() {
  return getRequestedStillsDuration() + getRequestedTransitionDuration();
}

function getEffectiveVideoDuration() {
  const requested = getRequestedTimelineDuration();
  if (!state.voiceDuration || state.voiceDuration <= 0) {
    return requested;
  }
  return state.voiceDuration;
}

function getTimingImpact() {
  const overlay = state.voiceDuration || 0;
  const requestedStills = getRequestedStillsDuration();
  const requestedTransitions = getRequestedTransitionDuration();
  const requestedTotal = requestedStills + requestedTransitions;
  const effectiveTotal = state.voiceDuration && state.voiceDuration > 0 ? state.voiceDuration : requestedTotal;

  let warning = "";

  if (state.voiceDuration && requestedTotal > state.voiceDuration) {
    const cutoff = state.voiceDuration;
    const stillItems = buildTimeline({ transitionDuration: Math.max(0, Number(els.transitionDurationInput.value) || 0) }).items
      .filter((item) => item.type === "still");
    const truncated = stillItems.find((item) => cutoff > item.start && cutoff < item.end);
    const unseen = stillItems.filter((item) => item.start >= cutoff);

    const parts = [
      `Requested timeline exceeds overlay by ${formatSeconds(requestedTotal - state.voiceDuration)}.`
    ];

    if (truncated) {
      parts.push(`Slide ${truncated.slideIndex + 1} will be cut short.`);
    }

    if (unseen.length) {
      const unseenIndexes = unseen.map((item) => item.slideIndex + 1);
      parts.push(`Slides ${unseenIndexes.join(", ")} will not be fully reached.`);
    }

    warning = parts.join(" ");
  } else if (state.voiceDuration && requestedTotal < state.voiceDuration) {
    warning = `Requested timeline is shorter than the overlay by ${formatSeconds(state.voiceDuration - requestedTotal)}. The final slide will remain on screen for the extra time.`;
  }

  return {
    overlay,
    requestedStills,
    requestedTransitions,
    requestedTotal,
    effectiveTotal,
    warning,
  };
}

function updateTimingSummary() {
  const timing = getTimingImpact();
  els.timingOverlay.textContent = state.voiceDuration ? formatSeconds(timing.overlay) : "Not loaded";
  els.timingStills.textContent = formatSeconds(timing.requestedStills);
  els.timingTransitions.textContent = formatSeconds(timing.requestedTransitions);
  els.timingRequested.textContent = formatSeconds(timing.requestedTotal);
  els.timingEffective.textContent = formatSeconds(timing.effectiveTotal);

  if (timing.warning) {
    els.timingWarning.textContent = timing.warning;
    els.timingWarning.classList.remove("hidden");
  } else {
    els.timingWarning.textContent = "";
    els.timingWarning.classList.add("hidden");
  }
}

function initializeSlideDurations() {
  const defaultDuration = Math.max(0.01, Number(els.durationInput.value) || 3);
  state.slides.forEach((slide) => {
    slide.duration = defaultDuration;
  });
}

function setDefaultDurationFromOverlay(applyToSlides = false) {
  if (!state.slides.length || !state.voiceDuration || state.voiceDuration <= 0) {
    return;
  }

  const transitionDuration = Math.max(0, Number(els.transitionDurationInput.value) || 0);
  const transitionCount = Math.max(0, state.slides.length - 1);
  const availableStillTime = Math.max(0.01, state.voiceDuration - (transitionDuration * transitionCount));
  const equalDuration = Math.max(0.01, availableStillTime / state.slides.length);

  els.durationInput.value = equalDuration.toFixed(2);

  if (applyToSlides) {
    state.slides.forEach((slide) => {
      slide.duration = equalDuration;
    });
  }
}

async function loadImageForSlide(slide) {
  const url = URL.createObjectURL(slide.file);
  state.objectUrls.push(url);
  slide.thumbUrl = url;
  slide.img = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
  return slide;
}

async function handleImages(files) {
  cleanupUrls();
  const slides = guessSortedSlides(files);
  state.slides = await Promise.all(slides.map(loadImageForSlide));
  initializeSlideDurations();
  updateTimingSummary();
  renderImageList();
}

function cleanupUrls() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
}

function isZipFile(file) {
  return file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
}

function isImageFilename(name) {
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(name);
}

function isIgnoredZipEntry(name) {
  const normalized = name.replace(/\\/g, "/");
  const basename = normalized.split("/").at(-1) || normalized;
  return normalized.startsWith("__MACOSX/") || basename.startsWith("._") || basename === ".DS_Store";
}

async function extractImagesFromZip(zipFile) {
  if (!window.JSZip) {
    throw new Error("JSZip is not available.");
  }

  log(`Reading ZIP archive: ${zipFile.name}`);
  const zip = await window.JSZip.loadAsync(zipFile);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && !isIgnoredZipEntry(entry.name) && isImageFilename(entry.name))
    .sort((a, b) => naturalCompare(a.name, b.name));

  if (!entries.length) {
    throw new Error(`No supported image files found in ${zipFile.name}`);
  }

  const files = await Promise.all(entries.map(async (entry, index) => {
    const blob = await entry.async("blob");
    const filename = entry.name.split("/").at(-1) || `image-${index + 1}.png`;
    return new File([blob], filename, {
      type: blob.type || guessMimeTypeFromFilename(filename),
      lastModified: Date.now() + index,
    });
  }));

  return files;
}

function guessMimeTypeFromFilename(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".avif")) return "image/avif";
  return "application/octet-stream";
}

async function normalizeImageInputs(fileList) {
  const files = [...fileList];
  const expanded = [];

  for (const file of files) {
    if (isZipFile(file)) {
      const zipImages = await extractImagesFromZip(file);
      expanded.push(...zipImages);
      continue;
    }

    if (file.type.startsWith("image/") || isImageFilename(file.name)) {
      expanded.push(file);
    }
  }

  if (!expanded.length) {
    throw new Error("No supported image files were provided.");
  }

  return expanded;
}

function moveSlide(from, to) {
  if (to < 0 || to >= state.slides.length || from === to) return;
  const [slide] = state.slides.splice(from, 1);
  state.slides.splice(to, 0, slide);
  renderImageList();
}

async function reGuessCurrentOrder() {
  if (!state.slides.length) return;
  const files = state.slides.map((slide) => slide.file);
  await handleImages(files);
}

function renderImageList() {
  const list = els.imageList;
  list.innerHTML = "";
  list.classList.toggle("empty", state.slides.length === 0);
  if (state.slides.length === 0) {
    list.textContent = "Add images to begin.";
    return;
  }

  state.slides.forEach((slide, index) => {
    const item = document.createElement("div");
    item.className = "image-item";
    item.draggable = true;
    item.dataset.index = String(index);

    item.addEventListener("dragstart", () => {
      state.dragIndex = index;
      item.classList.add("dragging");
    });

    item.addEventListener("dragend", () => {
      state.dragIndex = null;
      item.classList.remove("dragging");
    });

    item.addEventListener("dragover", (event) => {
      event.preventDefault();
    });

    item.addEventListener("drop", (event) => {
      event.preventDefault();
      if (state.dragIndex === null) return;
      moveSlide(state.dragIndex, index);
    });

    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.src = slide.thumbUrl;
    thumb.alt = slide.file.name;

    const meta = document.createElement("div");
    meta.className = "image-meta";
    meta.innerHTML = `
      <strong>${index + 1}. ${slide.file.name}</strong>
      <div class="compact-controls">
        <label class="field">
          <span>Transition</span>
          <select data-role="transition" class="transition-select">
            ${TRANSITIONS.map((t) => `<option value="${t.value}" ${t.value === slide.transition ? "selected" : ""}>${t.label}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Seconds</span>
          <input data-role="duration" class="duration-input" type="number" min="0.01" step="0.01" value="${slide.duration.toFixed(2)}" />
        </label>
      </div>
      <div class="slide-actions">
        <button type="button" data-role="quick-preview" class="mini-button">Quick GIF</button>
      </div>
      <div class="drag-hint">Drag to reorder</div>
    `;

    const transitionSelect = meta.querySelector('[data-role="transition"]');
    const quickPreviewButton = meta.querySelector('[data-role="quick-preview"]');
    const durationInput = meta.querySelector('[data-role="duration"]');

    transitionSelect.addEventListener("change", (event) => {
      slide.transition = event.target.value;
      updateTimingSummary();
    });

    durationInput.addEventListener("change", (event) => {
      slide.duration = Math.max(0.01, Number(event.target.value) || 3);
      event.target.value = slide.duration.toFixed(2);
      updateTimingSummary();
    });

    quickPreviewButton.addEventListener("click", () => {
      createSlideQuickPreview(index, quickPreviewButton).catch(handleError);
    });

    if (index === 0) {
      transitionSelect.value = "none";
      transitionSelect.disabled = true;
      slide.transition = "none";
    }

    item.append(thumb, meta);
    list.append(item);
  });
}

function readSettings() {
  return {
    width: Math.max(320, Number(els.widthInput.value) || 1280),
    height: Math.max(240, Number(els.heightInput.value) || 720),
    fps: Math.max(12, Number(els.fpsInput.value) || 30),
    fit: els.fitSelect.value,
    defaultDuration: Math.max(0.01, Number(els.durationInput.value) || 3),
    transitionDuration: Math.max(0, Number(els.transitionDurationInput.value) || 0.8),
    outputFormat: els.outputFormatSelect.value,
    voiceVolume: Math.max(0, Number(els.voiceVolumeInput.value) || 1),
    musicVolume: Math.max(0, Number(els.musicVolumeInput.value) || 0.35),
    musicStart: Math.max(0, Number(els.musicStartInput.value) || 0),
    musicFade: Math.max(0, Number(els.musicFadeInput.value) || 1.5),
  };
}

function getMimeType(format) {
  const candidates = format === "webm"
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
}

function getCaptureBitrate(settings, isPreview = false) {
  const pixelFactor = (settings.width * settings.height) / (1280 * 720);
  const fpsFactor = settings.fps / 30;
  const base = isPreview ? 1_200_000 : 2_000_000;
  return Math.max(600_000, Math.round(base * pixelFactor * fpsFactor));
}

function getNativeRecorderMimeType(format) {
  const webmCandidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];

  if (format === "mp4") {
    const mp4Candidates = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
    ];
    return mp4Candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
  }

  if (format === "webm") {
    return webmCandidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
  }

  return "";
}

function isNativeExportSupported(format) {
  return Boolean(getNativeRecorderMimeType(format));
}

function updateCanvasSize(width, height) {
  els.canvas.width = width;
  els.canvas.height = height;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function drawImageFit(ctx, img, width, height, mode = "contain", alpha = 1, transform = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const scale = mode === "cover"
    ? Math.max(width / img.width, height / img.height)
    : Math.min(width / img.width, height / img.height);
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  const tx = transform.x ?? 0;
  const ty = transform.y ?? 0;
  const zoom = transform.scale ?? 1;
  ctx.translate(width / 2, height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-width / 2, -height / 2);
  ctx.drawImage(img, x + tx, y + ty, drawWidth, drawHeight);
  ctx.restore();
}

function renderTransitionFrame(ctx, current, next, progress, settings) {
  const { width, height, fit } = settings;
  const eased = easeInOut(progress);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  switch (current.transition) {
    case "none":
      drawImageFit(ctx, next.img, width, height, fit);
      break;
    case "fade":
    case "crossfade":
      drawImageFit(ctx, current.img, width, height, fit, 1 - eased);
      drawImageFit(ctx, next.img, width, height, fit, eased);
      break;
    case "slide-left":
      drawImageFit(ctx, current.img, width, height, fit, 1, { x: -width * eased });
      drawImageFit(ctx, next.img, width, height, fit, 1, { x: width * (1 - eased) });
      break;
    case "slide-right":
      drawImageFit(ctx, current.img, width, height, fit, 1, { x: width * eased });
      drawImageFit(ctx, next.img, width, height, fit, 1, { x: -width * (1 - eased) });
      break;
    case "slide-up":
      drawImageFit(ctx, current.img, width, height, fit, 1, { y: -height * eased });
      drawImageFit(ctx, next.img, width, height, fit, 1, { y: height * (1 - eased) });
      break;
    case "slide-down":
      drawImageFit(ctx, current.img, width, height, fit, 1, { y: height * eased });
      drawImageFit(ctx, next.img, width, height, fit, 1, { y: -height * (1 - eased) });
      break;
    case "wipe-left":
      drawImageFit(ctx, current.img, width, height, fit);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width * eased, height);
      ctx.clip();
      drawImageFit(ctx, next.img, width, height, fit);
      ctx.restore();
      break;
    case "wipe-right":
      drawImageFit(ctx, current.img, width, height, fit);
      ctx.save();
      ctx.beginPath();
      ctx.rect(width * (1 - eased), 0, width * eased, height);
      ctx.clip();
      drawImageFit(ctx, next.img, width, height, fit);
      ctx.restore();
      break;
    case "zoom-in":
      drawImageFit(ctx, current.img, width, height, fit, 1 - eased);
      drawImageFit(ctx, next.img, width, height, fit, eased, { scale: 1.12 - 0.12 * eased });
      break;
    case "zoom-out":
      drawImageFit(ctx, current.img, width, height, fit, 1 - eased, { scale: 1 + 0.15 * eased });
      drawImageFit(ctx, next.img, width, height, fit, eased);
      break;
    default:
      drawImageFit(ctx, next.img, width, height, fit);
  }
}

function drawStillFrame(ctx, slide, settings) {
  ctx.clearRect(0, 0, settings.width, settings.height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, settings.width, settings.height);
  drawImageFit(ctx, slide.img, settings.width, settings.height, settings.fit);
}

function buildTimeline(settings, previewLimit = null) {
  const items = [];
  let currentTime = 0;
  const transitionDuration = settings.transitionDuration;

  state.slides.forEach((slide, index) => {
    const holdDuration = Math.max(0.01, slide.duration);
    items.push({
      type: "still",
      slideIndex: index,
      start: currentTime,
      end: currentTime + holdDuration,
    });
    currentTime += holdDuration;

    const next = state.slides[index + 1];
    if (next && transitionDuration > 0) {
      items.push({
        type: "transition",
        slideIndex: index,
        nextIndex: index + 1,
        start: currentTime,
        end: currentTime + transitionDuration,
      });
      currentTime += transitionDuration;
    }
  });

  if (state.voiceDuration && state.voiceDuration > 0) {
    currentTime = state.voiceDuration;
  }

  if (previewLimit === null) return { items, duration: currentTime };

  return {
    items: items.filter((item) => item.start < previewLimit),
    duration: Math.min(previewLimit, currentTime),
  };
}

function drawTimelineAt(time, timeline, settings) {
  const item = timeline.items.find((entry) => time >= entry.start && time < entry.end) || timeline.items.at(-1);
  if (!item) return;

  if (item.type === "still") {
    drawStillFrame(canvasCtx, state.slides[item.slideIndex], settings);
    return;
  }

  const progress = (time - item.start) / (item.end - item.start);
  renderTransitionFrame(
    canvasCtx,
    state.slides[item.slideIndex],
    state.slides[item.nextIndex],
    progress,
    settings
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getQuickPreviewDimensions() {
  return { width: 320, height: 180 };
}

function openQuickPreview(blob, filename, title) {
  const url = URL.createObjectURL(blob);
  state.objectUrls.push(url);
  els.quickPreviewTitle.textContent = title;
  els.quickPreviewImage.src = url;
  els.quickPreviewDownload.href = url;
  els.quickPreviewDownload.download = filename;
  els.quickPreviewDownload.classList.remove("hidden");
  els.quickPreviewDialog.showModal();
}

async function createSlideQuickPreview(index, button) {
  if (!window.GIF) {
    throw new Error("GIF preview library is not available.");
  }

  const slide = state.slides[index];
  if (!slide) return;

  const nextSlide = state.slides[index + 1] || slide;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Building GIF...";

  try {
    const { width, height } = getQuickPreviewDimensions();
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    const offscreenCtx = offscreenCanvas.getContext("2d");
    const gif = new window.GIF({
      workers: 2,
      quality: 10,
      width,
      height,
      workerScript: new URL("./vendor/gifjs/package/dist/gif.worker.js", window.location.href).toString(),
    });

    const quickSettings = {
      width,
      height,
      fit: els.fitSelect.value,
      transitionDuration: Math.max(0.2, Math.min(1.2, Number(els.transitionDurationInput.value) || 0.8)),
    };

    const holdFrames = 4;
    const transitionFrames = slide.transition === "none" || nextSlide === slide ? 1 : 8;

    for (let i = 0; i < holdFrames; i += 1) {
      drawStillFrame(offscreenCtx, slide, quickSettings);
      gif.addFrame(offscreenCanvas, { copy: true, delay: 120 });
    }

    if (nextSlide !== slide) {
      for (let i = 0; i < transitionFrames; i += 1) {
        const progress = transitionFrames === 1 ? 1 : i / (transitionFrames - 1);
        renderTransitionFrame(offscreenCtx, slide, nextSlide, progress, quickSettings);
        gif.addFrame(offscreenCanvas, { copy: true, delay: 90 });
      }
    }

    const gifBlob = await new Promise((resolve, reject) => {
      gif.on("finished", resolve);
      gif.on("abort", () => reject(new Error("GIF generation was aborted.")));
      gif.render();
    });

    openQuickPreview(
      gifBlob,
      `${slide.file.name.replace(/\.[^.]+$/, "")}-transition-preview.gif`,
      `Quick GIF: ${slide.file.name}`
    );
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function createMixedAudioTrack(settings) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio is not available in this browser.");
  }

  const audioContext = new AudioContextClass();
  const destination = audioContext.createMediaStreamDestination();
  let voiceSource = null;
  let musicSource = null;

  if (state.voiceFile) {
    const voiceBuffer = await audioContext.decodeAudioData(await state.voiceFile.arrayBuffer());
    voiceSource = audioContext.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    const voiceGain = audioContext.createGain();
    voiceGain.gain.value = settings.voiceVolume;
    voiceSource.connect(voiceGain).connect(destination);
  }

  if (state.musicFile) {
    const musicBuffer = await audioContext.decodeAudioData(await state.musicFile.arrayBuffer());
    musicSource = audioContext.createBufferSource();
    musicSource.buffer = musicBuffer;
    const musicGain = audioContext.createGain();
    musicGain.gain.setValueAtTime(0, 0);
    if (settings.musicStart > 0) {
      musicGain.gain.setValueAtTime(0, settings.musicStart);
    }
    if (settings.musicFade > 0) {
      musicGain.gain.linearRampToValueAtTime(
        settings.musicVolume,
        settings.musicStart + settings.musicFade
      );
    } else {
      musicGain.gain.setValueAtTime(settings.musicVolume, settings.musicStart);
    }
    musicSource.connect(musicGain).connect(destination);
  }

  await audioContext.resume();
  voiceSource?.start(0);
  musicSource?.start(settings.musicStart);

  return {
    audioContext,
    destination,
    stop() {
      try { voiceSource?.stop(); } catch {}
      try { musicSource?.stop(); } catch {}
      audioContext.close().catch(() => {});
    },
  };
}

async function recordTimeline(settings, previewLimit = null, progressKind = "preview", format = "webm") {
  if (state.slides.length === 0) {
    throw new Error("No images selected.");
  }

  updateCanvasSize(settings.width, settings.height);
  const timeline = buildTimeline(settings, previewLimit);
  const videoStream = els.canvas.captureStream(settings.fps);
  const audioSession = await createMixedAudioTrack(settings);
  const combinedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...audioSession.destination.stream.getAudioTracks(),
  ]);
  const mimeType = format === "webm"
    ? getNativeRecorderMimeType("webm")
    : getNativeRecorderMimeType(settings.outputFormat);
  if (!mimeType) {
    audioSession.stop();
    throw new Error(`Native ${format.toUpperCase()} recording is not supported in this browser.`);
  }

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: getCaptureBitrate(settings, previewLimit !== null),
  });
  const chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
  });

  recorder.start();
  setStatus(els.previewStatus, previewLimit ? "Rendering preview" : "Rendering frames");
  setProgress(progressKind, 0);
  log(`MediaRecorder bitrate: ${recorder.videoBitsPerSecond || getCaptureBitrate(settings, previewLimit !== null)} bps`);

  const frameDurationMs = 1000 / settings.fps;
  const startTime = performance.now();
  let elapsedSeconds = 0;

  while (elapsedSeconds < timeline.duration) {
    drawTimelineAt(Math.min(elapsedSeconds, timeline.duration), timeline, settings);
    setProgress(progressKind, Math.min(1, elapsedSeconds / timeline.duration));
    await wait(frameDurationMs);
    elapsedSeconds = (performance.now() - startTime) / 1000;
  }

  drawTimelineAt(timeline.duration, timeline, settings);
  recorder.stop();
  const blob = await finished;
  audioSession.stop();
  combinedStream.getTracks().forEach((track) => track.stop());
  setProgress(progressKind, 1);
  setStatus(els.previewStatus, previewLimit ? "Preview ready" : "Frame render done");
  return { blob, duration: timeline.duration, mimeType };
}

async function loadFfmpeg() {
  if (state.ffmpegLoaded) return state.ffmpeg;
  if (state.ffmpegLoadPromise) return state.ffmpegLoadPromise;

  setStatus(els.ffmpegStatus, "Loading");
  setProgress("load", 0.05);
  setButtonState("load", true);
  log("Loading ffmpeg.wasm...");
  state.ffmpegLoadPromise = (async () => {
    try {
      setStatus(els.ffmpegStatus, "Importing modules");
      setProgress("load", 0.2);
      const { FFmpeg } = await import("./vendor/ffmpeg/package/dist/esm/index.js");
      const { fetchFile } = await import("./vendor/util/package/dist/esm/index.js");

      const ffmpeg = new FFmpeg();
      ffmpeg.on("log", ({ message }) => log(message));
      ffmpeg.on("progress", ({ progress }) => {
        setProgress("preview", progress);
        setProgress("export", progress);
      });

      setStatus(els.ffmpegStatus, "Loading core");
      setProgress("load", 0.45);
      const classWorkerURL = new URL("./vendor/ffmpeg/package/dist/esm/worker.js", window.location.href).toString();
      const coreURL = new URL("./vendor/core/package/dist/esm/ffmpeg-core.js", window.location.href).toString();
      const wasmURL = new URL("./vendor/core/package/dist/esm/ffmpeg-core.wasm", window.location.href).toString();
      await ffmpeg.load({
        classWorkerURL,
        coreURL,
        wasmURL,
      });

      state.ffmpeg = { ffmpeg, fetchFile };
      state.ffmpegLoaded = true;
      setStatus(els.ffmpegStatus, "Loaded");
      setProgress("load", 1);
      updateEncoderDependentButtons();
      log("ffmpeg.wasm ready.");
      return state.ffmpeg;
    } catch (error) {
      setStatus(els.ffmpegStatus, "Error");
      setProgress("load", 0);
      throw error;
    } finally {
      setButtonState("load", false);
      state.ffmpegLoadPromise = null;
      updateEncoderDependentButtons();
    }
  })();

  return state.ffmpegLoadPromise;
}

function secondsToMs(seconds) {
  return Math.max(0, Math.round(seconds * 1000));
}

function buildMuxArgs({
  videoInputName,
  voiceInputName,
  musicInputName,
  outputName,
  durationSeconds,
  settings,
  outputFormat,
}) {
  let args = [];

  if (voiceInputName || musicInputName) {
    const filterParts = [];
    const mixLabels = [];
    let inputIndex = 1;

    if (voiceInputName) {
      filterParts.push(`[${inputIndex}:a]volume=${settings.voiceVolume}[voice]`);
      mixLabels.push("[voice]");
      inputIndex += 1;
    }

    if (musicInputName) {
      const delay = secondsToMs(settings.musicStart);
      const musicFilters = [
        `volume=${settings.musicVolume}`,
        delay > 0 ? `adelay=${delay}|${delay}` : null,
        settings.musicFade > 0 ? `afade=t=in:st=${settings.musicStart}:d=${settings.musicFade}` : null,
      ].filter(Boolean).join(",");
      filterParts.push(`[${inputIndex}:a]${musicFilters}[music]`);
      mixLabels.push("[music]");
    }

    filterParts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0:duration=longest[aout]`);

    args = ["-i", videoInputName];
    if (voiceInputName) args.push("-i", voiceInputName);
    if (musicInputName) args.push("-i", musicInputName);
    args.push(
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-t",
      String(durationSeconds)
    );
  } else {
    args = ["-i", videoInputName, "-t", String(durationSeconds)];
  }

  if (outputFormat === "mp4") {
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "stillimage",
      "-crf",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-shortest",
      outputName
    );
  } else if (outputFormat === "gif") {
    args.push("-vf", `fps=${settings.fps},scale=${settings.width}:-1:flags=lanczos`, outputName);
  } else {
    args.push(
      "-c:v",
      "libvpx-vp9",
      "-c:a",
      "libopus",
      "-b:v",
      "2M",
      "-shortest",
      outputName
    );
  }

  return args;
}

async function transcodeExport(recordedBlob, settings, durationSeconds) {
  const { ffmpeg, fetchFile } = await loadFfmpeg();
  setProgress("export", 0);
  setStatus(els.exportStatus, "Preparing");

  try { await ffmpeg.deleteFile("slideshow.webm"); } catch {}
  try { await ffmpeg.deleteFile("voice.wav"); } catch {}
  try { await ffmpeg.deleteFile("voice.mp3"); } catch {}
  try { await ffmpeg.deleteFile("music.wav"); } catch {}
  try { await ffmpeg.deleteFile("music.mp3"); } catch {}
  try { await ffmpeg.deleteFile("export.mp4"); } catch {}
  try { await ffmpeg.deleteFile("export.webm"); } catch {}
  try { await ffmpeg.deleteFile("export.gif"); } catch {}

  await ffmpeg.writeFile("slideshow.webm", await fetchFile(recordedBlob));
  if (state.voiceFile) {
    await ffmpeg.writeFile(`voice.${getExtension(state.voiceFile.name, "wav")}`, await fetchFile(state.voiceFile));
  }
  if (state.musicFile) {
    await ffmpeg.writeFile(`music.${getExtension(state.musicFile.name, "wav")}`, await fetchFile(state.musicFile));
  }

  const voiceInputName = state.voiceFile ? `voice.${getExtension(state.voiceFile.name, "wav")}` : null;
  const musicInputName = state.musicFile ? `music.${getExtension(state.musicFile.name, "wav")}` : null;
  const outputName = settings.outputFormat === "mp4"
    ? "export.mp4"
    : settings.outputFormat === "gif"
      ? "export.gif"
      : "export.webm";
  const args = buildMuxArgs({
    videoInputName: "slideshow.webm",
    voiceInputName,
    musicInputName,
    outputName,
    durationSeconds,
    settings,
    outputFormat: settings.outputFormat,
  });

  setStatus(els.exportStatus, "Encoding");
  log(`Running ffmpeg for ${settings.outputFormat.toUpperCase()} export...`);
  log(`ffmpeg ${args.join(" ")}`);
  await ffmpeg.exec(args);
  const data = await ffmpeg.readFile(outputName);
  setStatus(els.exportStatus, "Done");
  setProgress("export", 1);

  return new Blob([data.buffer], { type: mimeForOutput(outputName) });
}

async function muxPreview(recordedBlob, settings, durationSeconds) {
  const { ffmpeg, fetchFile } = await loadFfmpeg();
  setProgress("preview", 0);
  setStatus(els.previewStatus, "Muxing preview audio");

  try { await ffmpeg.deleteFile("preview-slideshow.webm"); } catch {}
  try { await ffmpeg.deleteFile("preview-voice.wav"); } catch {}
  try { await ffmpeg.deleteFile("preview-voice.mp3"); } catch {}
  try { await ffmpeg.deleteFile("preview-music.wav"); } catch {}
  try { await ffmpeg.deleteFile("preview-music.mp3"); } catch {}
  try { await ffmpeg.deleteFile("preview.webm"); } catch {}

  await ffmpeg.writeFile("preview-slideshow.webm", await fetchFile(recordedBlob));
  if (state.voiceFile) {
    await ffmpeg.writeFile(`preview-voice.${getExtension(state.voiceFile.name, "wav")}`, await fetchFile(state.voiceFile));
  }
  if (state.musicFile) {
    await ffmpeg.writeFile(`preview-music.${getExtension(state.musicFile.name, "wav")}`, await fetchFile(state.musicFile));
  }

  const voiceInputName = state.voiceFile ? `preview-voice.${getExtension(state.voiceFile.name, "wav")}` : null;
  const musicInputName = state.musicFile ? `preview-music.${getExtension(state.musicFile.name, "wav")}` : null;
  const args = buildMuxArgs({
    videoInputName: "preview-slideshow.webm",
    voiceInputName,
    musicInputName,
    outputName: "preview.webm",
    durationSeconds,
    settings,
    outputFormat: "webm",
  });

  log("Running ffmpeg for WEBM preview...");
  log(`ffmpeg ${args.join(" ")}`);
  await ffmpeg.exec(args);
  const data = await ffmpeg.readFile("preview.webm");
  setStatus(els.previewStatus, "Preview ready");
  setProgress("preview", 1);
  return new Blob([data.buffer], { type: "video/webm" });
}

function mimeForOutput(filename) {
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".gif")) return "image/gif";
  return "video/webm";
}

function getExtension(filename, fallback) {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.at(-1).toLowerCase() : fallback;
}

async function preview() {
  setButtonState("preview", true);
  try {
    const settings = readSettings();
    const previewSettings = {
      ...settings,
      outputFormat: "webm",
    };
    const { blob } = await recordTimeline(previewSettings, 12, "preview", "webm");
    state.lastPreviewBlob = blob;
    const url = URL.createObjectURL(blob);
    state.objectUrls.push(url);
    els.previewVideo.src = url;
    els.previewVideo.load();
  } finally {
    setButtonState("preview", false);
  }
}

async function exportVideo() {
  setButtonState("export", true);
  try {
    const settings = readSettings();
    if (settings.outputFormat === "gif") {
      throw new Error("GIF export is not supported in the current browser-only build.");
    }

    if (settings.outputFormat === "mp4" && !isNativeExportSupported("mp4")) {
      throw new Error("MP4 export is not supported in this browser without a different encoder stack. Use WebM for now.");
    }

    const { blob } = await recordTimeline(settings, null, "export", settings.outputFormat);
    const outputBlob = blob;
    state.lastExportBlob = outputBlob;
    const url = URL.createObjectURL(outputBlob);
    state.objectUrls.push(url);
    els.downloadLink.href = url;
    els.downloadLink.download = `slideshow-export.${settings.outputFormat}`;
    els.downloadLink.textContent = `Download ${settings.outputFormat.toUpperCase()} export`;
    els.downloadLink.classList.remove("hidden");
  } finally {
    setButtonState("export", false);
  }
}

function applyDefaultTransitionToAll() {
  const value = els.defaultTransitionSelect.value;
  state.slides.forEach((slide, index) => {
    slide.transition = index === 0 ? "none" : value;
  });
  renderImageList();
}

async function getAudioDuration(file) {
  const url = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read audio metadata for ${file.name}`));
    };
    audio.src = url;
  });
}

async function fileFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch sample asset: ${url}`);
  }
  const blob = await response.blob();
  const filename = decodeURIComponent(url.split("/").at(-1));
  return new File([blob], filename, {
    type: blob.type || undefined,
    lastModified: Date.now(),
  });
}

async function loadSampleAssets() {
  log("Loading sample assets...");
  const imageZip = await fileFromUrl(SAMPLE_ASSETS.imagesZip);
  const imageFiles = await extractImagesFromZip(imageZip);
  await handleImages(imageFiles);

  state.voiceFile = await fileFromUrl(SAMPLE_ASSETS.voice);
  state.musicFile = await fileFromUrl(SAMPLE_ASSETS.music);
  state.voiceDuration = await getAudioDuration(state.voiceFile);
  setDefaultDurationFromOverlay(true);
  updateTimingSummary();
  renderImageList();

  setStatus(els.previewStatus, "Samples loaded");
  log("Sample assets ready.");
}

async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function runAutoMode() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("autoload")) return;

  try {
    await loadSampleAssets();

    if (params.get("autopreview") === "1") {
      await preview();
    }

    if (params.get("autoexport") === "1") {
      await exportVideo();
      if (params.get("expose") === "1" && state.lastExportBlob) {
        window.__AUTO_EXPORT_BASE64__ = await blobToBase64(state.lastExportBlob);
        window.__AUTO_EXPORT_NAME__ = els.downloadLink.download || "slideshow-export.mp4";
      }
    }

    window.__AUTO_RUN_DONE__ = true;
  } catch (error) {
    window.__AUTO_RUN_ERROR__ = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

function bindEvents() {
  els.imagesInput.addEventListener("change", async (event) => {
    if (event.target.files?.length) {
      const normalized = await normalizeImageInputs(event.target.files);
      await handleImages(normalized);
    }
  });

  els.voiceInput.addEventListener("change", (event) => {
    state.voiceFile = event.target.files?.[0] || null;
    if (!state.voiceFile) {
      state.voiceDuration = null;
      updateTimingSummary();
      renderImageList();
      return;
    }

    getAudioDuration(state.voiceFile)
      .then((duration) => {
        state.voiceDuration = duration;
        setDefaultDurationFromOverlay(true);
        updateTimingSummary();
        renderImageList();
      })
      .catch(handleError);
  });

  els.musicInput.addEventListener("change", (event) => {
    state.musicFile = event.target.files?.[0] || null;
  });

  els.guessOrderBtn.addEventListener("click", async () => {
    if (els.imagesInput.files?.length) {
      const normalized = await normalizeImageInputs(els.imagesInput.files);
      await handleImages(normalized);
      return;
    }

    await reGuessCurrentOrder();
  });

  els.loadSampleBtn.addEventListener("click", () => loadSampleAssets().catch(handleError));
  els.resetEqualFitBtn.addEventListener("click", () => {
    setDefaultDurationFromOverlay(true);
    updateTimingSummary();
    renderImageList();
  });

  els.transitionDurationInput.addEventListener("change", () => {
    updateTimingSummary();
  });

  els.durationInput.addEventListener("change", () => {
    els.durationInput.value = String(Math.max(0.01, Number(els.durationInput.value) || 3));
  });

  els.applyDefaultTransitionBtn.addEventListener("click", applyDefaultTransitionToAll);
  els.previewBtn.addEventListener("click", () => preview().catch(handleError));
  els.exportBtn.addEventListener("click", () => exportVideo().catch(handleError));
  els.quickPreviewCloseBtn.addEventListener("click", () => els.quickPreviewDialog.close());
}

function handleError(error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`ERROR: ${message}`);
  setStatus(els.previewStatus, "Error");
  setStatus(els.exportStatus, "Error");
  console.error(error);
}

populateTransitions();
bindEvents();
setButtonState("preview", false);
setButtonState("export", false);
updateTimingSummary();
log("App ready. Load images or a ZIP, add audio, then preview or export.");
runAutoMode().catch(handleError);
