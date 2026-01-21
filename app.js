const MAX_SECONDS = 120;
const DB_NAME = "flip-it-reverse-it";
const STORE_NAME = "clips";
const CLIP_KEY = "latest";
const RECORD_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
];

const state = {
  original: null,
  mimic: null,
  reversed: null,
  mimicReversed: null,
};

let audioCtx;
let currentSource = null;
let recording = null;
let dbPromise;

const elements = {
  maxSeconds: document.getElementById("maxSeconds"),
  clearStorage: document.getElementById("clearStorage"),
  recordOriginal: document.getElementById("recordOriginal"),
  playOriginal: document.getElementById("playOriginal"),
  playReverse: document.getElementById("playReverse"),
  downloadOriginal: document.getElementById("downloadOriginal"),
  uploadOriginal: document.getElementById("uploadOriginal"),
  uploadOriginalInput: document.getElementById("uploadOriginalInput"),
  originalStatus: document.getElementById("originalStatus"),
  originalDuration: document.getElementById("originalDuration"),
  originalFormat: document.getElementById("originalFormat"),
  recordMimic: document.getElementById("recordMimic"),
  playMimic: document.getElementById("playMimic"),
  playMimicReverse: document.getElementById("playMimicReverse"),
  downloadMimic: document.getElementById("downloadMimic"),
  uploadMimic: document.getElementById("uploadMimic"),
  uploadMimicInput: document.getElementById("uploadMimicInput"),
  mimicStatus: document.getElementById("mimicStatus"),
  mimicDuration: document.getElementById("mimicDuration"),
  mimicFormat: document.getElementById("mimicFormat"),
  transportStatus: document.getElementById("transportStatus"),
  trackASource: document.getElementById("trackASource"),
  trackAToggle: document.getElementById("trackAToggle"),
  trackAStop: document.getElementById("trackAStop"),
  trackAScrub: document.getElementById("trackAScrub"),
  trackAElapsed: document.getElementById("trackAElapsed"),
  trackADuration: document.getElementById("trackADuration"),
  trackAWave: document.getElementById("trackAWave"),
  trackAPlayhead: document.getElementById("trackAPlayhead"),
  trackBSource: document.getElementById("trackBSource"),
  trackBToggle: document.getElementById("trackBToggle"),
  trackBStop: document.getElementById("trackBStop"),
  trackBScrub: document.getElementById("trackBScrub"),
  trackBElapsed: document.getElementById("trackBElapsed"),
  trackBDuration: document.getElementById("trackBDuration"),
  trackBWave: document.getElementById("trackBWave"),
  trackBPlayhead: document.getElementById("trackBPlayhead"),
};

const trackStates = {
  A: {
    selection: "original",
    isPlaying: false,
    source: null,
    startTime: 0,
    offset: 0,
    rafId: null,
  },
  B: {
    selection: "originalReverse",
    isPlaying: false,
    source: null,
    startTime: 0,
    offset: 0,
    rafId: null,
  },
};

const waveformState = {
  original: null,
  mimic: null,
  samples: 360,
};

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function chooseMimeType() {
  if (!window.MediaRecorder) return null;
  return RECORD_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function setStatus(el, text) {
  el.textContent = text;
}

function updateProgress(stateLabel, elapsed = 0) {
  const stamp = formatTime(elapsed);
  setStatus(elements.transportStatus, `${stateLabel} \u2022 ${stamp}`);
}

function resetProgress() {
  setStatus(elements.transportStatus, "No playback running.");
}

function setRecordButtonState(button, isRecording) {
  button.classList.toggle("is-recording", isRecording);
  button.innerHTML = isRecording ? "&#9632;" : "&#9679;";
  button.setAttribute("aria-label", isRecording ? "Stop recording" : "Record");
}

function setControlsEnabled(enabled) {
  const controls = [
    elements.playOriginal,
    elements.playReverse,
    elements.downloadOriginal,
    elements.uploadOriginal,
    elements.playMimic,
    elements.playMimicReverse,
    elements.downloadMimic,
    elements.uploadMimic,
    elements.trackAToggle,
    elements.trackAStop,
    elements.trackAScrub,
    elements.trackBSource,
    elements.trackASource,
    elements.trackBToggle,
    elements.trackBStop,
    elements.trackBScrub,
  ];
  controls.forEach((control) => {
    control.disabled = !enabled;
  });
}

async function decodeBlob(blob) {
  const ctx = ensureAudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

async function handleUploadedFile(type, file) {
  if (!file) return;
  stopAllPlayback(true);
  try {
    const buffer = await decodeBlob(file);
    if (type === "original") {
      state.original = {
        blob: file,
        buffer,
        duration: buffer.duration,
        mimeType: file.type,
      };
      state.reversed = reverseAudioBuffer(buffer);
      setStatus(elements.originalStatus, "Uploaded.");
      updatePanel("original");
    } else {
      state.mimic = {
        blob: file,
        buffer,
        duration: buffer.duration,
        mimeType: file.type,
      };
      state.mimicReversed = reverseAudioBuffer(buffer);
      setStatus(elements.mimicStatus, "Uploaded.");
      updatePanel("mimic");
    }

    await saveToDb();
    setStatus(elements.transportStatus, "Upload saved.");
  } catch (error) {
    if (type === "original") {
      setStatus(elements.originalStatus, "Upload failed.");
    } else {
      setStatus(elements.mimicStatus, "Upload failed.");
    }
  }
}

function reverseAudioBuffer(buffer) {
  const ctx = ensureAudioContext();
  const reversed = ctx.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    const reversedData = reversed.getChannelData(channel);
    for (let i = 0, j = data.length - 1; i < data.length; i += 1, j -= 1) {
      reversedData[i] = data[j];
    }
  }

  return reversed;
}

function buildWaveform(buffer, samples = waveformState.samples) {
  const data = buffer.getChannelData(0);
  const length = data.length;
  const blockSize = Math.max(1, Math.floor(length / samples));
  const peaks = new Float32Array(samples);

  for (let i = 0; i < samples; i += 1) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, length);
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      const value = Math.abs(data[j]);
      if (value > peak) peak = value;
    }
    peaks[i] = peak;
  }

  return peaks;
}

function getWaveColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    primary: styles.getPropertyValue("--wave-primary").trim() || "#1e1e1c",
    secondary: styles.getPropertyValue("--wave-secondary").trim() || "#c4512f",
    line: styles.getPropertyValue("--wave-line").trim() || "rgba(0,0,0,0.1)",
    grid: styles.getPropertyValue("--wave-grid").trim() || "rgba(0,0,0,0.06)",
    diff: styles.getPropertyValue("--wave-diff").trim() || "rgba(229,183,94,0.5)",
  };
}

function resizeCanvas(canvas) {
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawWaveformLayer(ctx, width, height, data, color, flip = false, alpha = 1) {
  if (!data) return;
  const mid = height / 2;
  const len = data.length;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();

  for (let i = 0; i < len; i += 1) {
    const index = flip ? len - 1 - i : i;
    const x = (i / (len - 1)) * width;
    const amp = data[index] * (height * 0.45);
    ctx.moveTo(x, mid - amp);
    ctx.lineTo(x, mid + amp);
  }

  ctx.stroke();
  ctx.restore();
}

function drawTrackWaveform(trackKey) {
  const canvas = trackKey === "A" ? elements.trackAWave : elements.trackBWave;
  if (!canvas) return;

  const setup = resizeCanvas(canvas);
  if (!setup) return;

  const { ctx, width, height } = setup;
  ctx.clearRect(0, 0, width, height);

  const colors = getWaveColors();
  const mid = height / 2;
  const tickCount = 8;

  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= tickCount; i += 1) {
    const x = (i / tickCount) * width;
    ctx.moveTo(x, 6);
    ctx.lineTo(x, height - 6);
  }
  ctx.stroke();

  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();

  const original = waveformState.original;
  const mimic = waveformState.mimic;

  const track = trackStates[trackKey];
  const primarySelected =
    trackKey === "A"
      ? track.selection === "original"
      : track.selection === "originalReverse";

  const primaryAlpha = primarySelected ? 0.9 : 0.45;
  const secondaryAlpha = primarySelected ? 0.45 : 0.9;

  const originalFlip = trackKey === "B";
  const mimicFlip = trackKey === "A";

  if (original && mimic) {
    const length = Math.min(original.length, mimic.length);
    if (length > 1) {
    ctx.save();
    ctx.strokeStyle = colors.diff;
    ctx.lineWidth = 2;
    for (let i = 0; i < length; i += 1) {
      const originalIndex = originalFlip ? length - 1 - i : i;
      const mimicIndex = mimicFlip ? length - 1 - i : i;
      const diff =
        Math.abs(original[originalIndex] - mimic[mimicIndex]) * (height * 0.42);
      const x = (i / (length - 1)) * width;
      ctx.beginPath();
      ctx.moveTo(x, mid - diff);
      ctx.lineTo(x, mid + diff);
      ctx.stroke();
    }
    ctx.restore();
    }
  }

  if (trackKey === "A") {
    drawWaveformLayer(
      ctx,
      width,
      height,
      original,
      colors.primary,
      false,
      primaryAlpha
    );
    drawWaveformLayer(
      ctx,
      width,
      height,
      mimic,
      colors.secondary,
      true,
      secondaryAlpha
    );
  } else {
    drawWaveformLayer(
      ctx,
      width,
      height,
      original,
      colors.primary,
      true,
      primaryAlpha
    );
    drawWaveformLayer(
      ctx,
      width,
      height,
      mimic,
      colors.secondary,
      false,
      secondaryAlpha
    );
  }
}

function refreshWaveforms() {
  waveformState.original = state.original
    ? buildWaveform(state.original.buffer)
    : null;
  waveformState.mimic = state.mimic ? buildWaveform(state.mimic.buffer) : null;
  drawTrackWaveform("A");
  drawTrackWaveform("B");
}

function stopPreviewPlayback() {
  if (currentSource) {
    currentSource.stop();
    currentSource.disconnect();
    currentSource = null;
  }
}

function stopTrackPlayback(trackKey, resetOffset = false) {
  const track = trackStates[trackKey];
  if (track.source) {
    track.source.onended = null;
    try {
      track.source.stop();
    } catch (error) {
      // Source might already be stopped.
    }
    track.source.disconnect();
    track.source = null;
  }
  if (track.rafId) {
    window.cancelAnimationFrame(track.rafId);
    track.rafId = null;
  }
  track.isPlaying = false;
  if (resetOffset) {
    track.offset = 0;
  }
  updateTrackUI(trackKey);
  updatePlayhead(trackKey);
}

function stopAllPlayback(resetOffsets = false) {
  stopPreviewPlayback();
  stopTrackPlayback("A", resetOffsets);
  stopTrackPlayback("B", resetOffsets);
}

function playBuffer(buffer, label) {
  if (!buffer) return;
  stopAllPlayback(false);

  const ctx = ensureAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  currentSource = source;

  setStatus(elements.transportStatus, label);

  source.onended = () => {
    if (currentSource === source) {
      currentSource = null;
      setStatus(elements.transportStatus, "No playback running.");
    }
  };
}

function getTrackUi(trackKey) {
  if (trackKey === "A") {
    return {
      toggle: elements.trackAToggle,
      stop: elements.trackAStop,
      scrub: elements.trackAScrub,
      select: elements.trackASource,
      elapsed: elements.trackAElapsed,
      duration: elements.trackADuration,
    };
  }
  return {
    toggle: elements.trackBToggle,
    stop: elements.trackBStop,
    scrub: elements.trackBScrub,
    select: elements.trackBSource,
    elapsed: elements.trackBElapsed,
    duration: elements.trackBDuration,
  };
}

function getTrackBuffer(trackKey) {
  const selection = trackStates[trackKey].selection;
  if (trackKey === "A") {
    return selection === "original" ? state.original?.buffer : state.mimicReversed;
  }
  return selection === "originalReverse" ? state.reversed : state.mimic?.buffer;
}

function updateTrackUI(trackKey) {
  const track = trackStates[trackKey];
  const ui = getTrackUi(trackKey);
  const buffer = getTrackBuffer(trackKey);
  const hasBuffer = Boolean(buffer);
  const duration = hasBuffer ? buffer.duration : 0;
  const displayOffset = hasBuffer ? Math.min(track.offset, duration) : 0;

  if (hasBuffer) {
    track.offset = displayOffset;
  }

  ui.scrub.max = hasBuffer ? duration : 1;
  ui.scrub.value = displayOffset;
  ui.elapsed.textContent = formatTime(displayOffset);
  ui.duration.textContent = formatTime(duration);

  ui.select.value = track.selection;
  ui.toggle.innerHTML = track.isPlaying ? "&#10074;&#10074;" : "&#9654;";
  ui.toggle.setAttribute("aria-label", track.isPlaying ? "Pause" : "Play");

  ui.toggle.disabled = !hasBuffer;
  ui.stop.disabled = !hasBuffer;
  ui.scrub.disabled = !hasBuffer;

  updatePlayhead(trackKey);
}

function updateTransportUI() {
  updateTrackUI("A");
  updateTrackUI("B");
  drawTrackWaveform("A");
  drawTrackWaveform("B");
}

function updatePlayhead(trackKey) {
  const track = trackStates[trackKey];
  const buffer = getTrackBuffer(trackKey);
  const playhead =
    trackKey === "A" ? elements.trackAPlayhead : elements.trackBPlayhead;
  const duration = buffer ? buffer.duration : 0;
  const progress = duration ? Math.min(track.offset / duration, 1) : 0;
  playhead.style.left = `${progress * 100}%`;
}

function updateDownloadButtons() {
  setDownloadState(elements.downloadOriginal, Boolean(state.original?.blob));
  setDownloadState(elements.downloadMimic, Boolean(state.mimic?.blob));
}

function setDownloadState(button, hasClip) {
  button.disabled = !hasClip;
  button.setAttribute(
    "aria-label",
    hasClip ? "Download clip" : "Download unavailable"
  );
}

function startTrackProgress(trackKey) {
  const track = trackStates[trackKey];
  const ui = getTrackUi(trackKey);

  if (track.rafId) {
    window.cancelAnimationFrame(track.rafId);
  }

  const tick = () => {
    if (!track.isPlaying) return;
    const buffer = getTrackBuffer(trackKey);
    if (!buffer) {
      stopTrackPlayback(trackKey, true);
      return;
    }
    const ctx = ensureAudioContext();
    const duration = buffer.duration;
    track.offset = Math.min(ctx.currentTime - track.startTime, duration);
    ui.scrub.value = track.offset;
    ui.elapsed.textContent = formatTime(track.offset);
    ui.duration.textContent = formatTime(duration);
    updatePlayhead(trackKey);

    track.rafId = window.requestAnimationFrame(tick);
  };

  track.rafId = window.requestAnimationFrame(tick);
}

function startTrackPlayback(trackKey) {
  const track = trackStates[trackKey];
  const buffer = getTrackBuffer(trackKey);
  if (!buffer) {
    setStatus(elements.transportStatus, `Track ${trackKey} source not ready.`);
    return;
  }

  stopAllPlayback(false);

  const ctx = ensureAudioContext();
  const source = ctx.createBufferSource();
  const offset = Math.min(track.offset, buffer.duration);

  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0, offset);

  track.source = source;
  track.isPlaying = true;
  track.startTime = ctx.currentTime - offset;

  setStatus(elements.transportStatus, `Track ${trackKey} playing.`);
  updateTrackUI(trackKey);
  startTrackProgress(trackKey);

  source.onended = () => {
    if (track.source === source) {
      stopTrackPlayback(trackKey, true);
      setStatus(elements.transportStatus, "No playback running.");
    }
  };
}

function pauseTrackPlayback(trackKey) {
  const track = trackStates[trackKey];
  if (!track.isPlaying) return;
  const ctx = ensureAudioContext();
  track.offset = Math.max(0, ctx.currentTime - track.startTime);
  stopTrackPlayback(trackKey, false);
  setStatus(elements.transportStatus, `Track ${trackKey} paused.`);
}

function stopTrackPlaybackFully(trackKey) {
  stopTrackPlayback(trackKey, true);
  setStatus(elements.transportStatus, `Track ${trackKey} stopped.`);
}

function seekTrack(trackKey, value) {
  const track = trackStates[trackKey];
  const buffer = getTrackBuffer(trackKey);
  if (!buffer) return;
  track.offset = Math.max(0, Math.min(value, buffer.duration));
  if (track.isPlaying) {
    startTrackPlayback(trackKey);
  } else {
    updateTrackUI(trackKey);
  }
}

function switchTrackSource(trackKey, selection) {
  const track = trackStates[trackKey];
  const wasPlaying = track.isPlaying;
  const ctx = ensureAudioContext();
  const currentOffset = wasPlaying
    ? Math.max(0, ctx.currentTime - track.startTime)
    : track.offset;

  track.selection = selection;
  const buffer = getTrackBuffer(trackKey);
  const duration = buffer ? buffer.duration : 0;
  track.offset = Math.min(currentOffset, duration || currentOffset);

  updateTrackUI(trackKey);

  if (wasPlaying && buffer) {
    startTrackPlayback(trackKey);
  }
  drawTrackWaveform(trackKey);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function extensionForMime(mimeType) {
  if (!mimeType) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("wav")) return "wav";
  return "audio";
}

function encodeWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  let offset = 0;

  function writeString(value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i));
      offset += 1;
    }
  }

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;
  writeString("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  const channelData = [];
  for (let channel = 0; channel < numChannels; channel += 1) {
    channelData.push(audioBuffer.getChannelData(channel));
  }

  for (let i = 0; i < numFrames; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function startRecording(type) {
  if (recording) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus(elements.transportStatus, "Microphone access not supported.");
    return;
  }

  if (!window.MediaRecorder) {
    setStatus(elements.transportStatus, "Recording not supported in this browser.");
    return;
  }

  stopAllPlayback(false);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    const mimeType = chooseMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());

      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const buffer = await decodeBlob(blob);

      if (type === "original") {
        state.original = {
          blob,
          buffer,
          duration: buffer.duration,
          mimeType: blob.type,
        };
        state.reversed = reverseAudioBuffer(buffer);
        updatePanel("original");
        setStatus(elements.originalStatus, "Recorded.");
      } else {
        state.mimic = {
          blob,
          buffer,
          duration: buffer.duration,
          mimeType: blob.type,
        };
        state.mimicReversed = reverseAudioBuffer(buffer);
        updatePanel("mimic");
        setStatus(elements.mimicStatus, "Recorded.");
      }

      await saveToDb();

      setStatus(elements.transportStatus, "Recording saved.");
    });

    recorder.start();

    recording = {
      type,
      recorder,
      stream,
      startTime: Date.now(),
      timer: null,
    };

    const label = type === "original" ? "Recording original" : "Recording mimic";
    setStatus(elements.transportStatus, `${label}...`);

    recording.timer = window.setInterval(() => {
      const elapsed = (Date.now() - recording.startTime) / 1000;
      updateProgress(label, elapsed);
      if (elapsed >= MAX_SECONDS) {
        stopRecording();
      }
    }, 120);

    if (type === "original") {
      setStatus(elements.originalStatus, "Recording...");
      setRecordButtonState(elements.recordOriginal, true);
      setRecordButtonState(elements.recordMimic, false);
    } else {
      setStatus(elements.mimicStatus, "Recording...");
      setRecordButtonState(elements.recordMimic, true);
      setRecordButtonState(elements.recordOriginal, false);
    }

    setControlsEnabled(false);
  } catch (error) {
    setStatus(elements.transportStatus, "Microphone access denied.");
  }
}

function stopRecording() {
  if (!recording) return;
  if (recording.recorder.state === "recording") {
    recording.recorder.stop();
  }

  if (recording.timer) {
    window.clearInterval(recording.timer);
  }

  if (recording.type === "original") {
    setRecordButtonState(elements.recordOriginal, false);
    setStatus(elements.originalStatus, "Processing...");
  } else {
    setRecordButtonState(elements.recordMimic, false);
    setStatus(elements.mimicStatus, "Processing...");
  }

  recording = null;
  setControlsEnabled(true);
  resetProgress();
}

function updatePanel(type) {
  if (type === "original" && state.original) {
    elements.originalDuration.textContent = formatTime(state.original.duration);
    elements.originalFormat.textContent = state.original.mimeType || "audio";
  }

  if (type === "mimic" && state.mimic) {
    elements.mimicDuration.textContent = formatTime(state.mimic.duration);
    elements.mimicFormat.textContent = state.mimic.mimeType || "audio";
  }

  updateTransportUI();
  updateDownloadButtons();
  refreshWaveforms();
}

function resetPanels() {
  elements.originalDuration.textContent = "--:--";
  elements.originalFormat.textContent = "--";
  elements.mimicDuration.textContent = "--:--";
  elements.mimicFormat.textContent = "--";
  setStatus(elements.originalStatus, "Ready.");
  setStatus(elements.mimicStatus, "Record your attempt.");
  setStatus(elements.transportStatus, "No playback running.");
  updateTransportUI();
  updateDownloadButtons();
  refreshWaveforms();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getClipRecord(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(CLIP_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putClipRecord(db, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(data);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearClipRecord(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(CLIP_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function saveToDb() {
  if (!dbPromise) return;
  const db = await dbPromise;
  const payload = {
    key: CLIP_KEY,
    originalBlob: state.original?.blob || null,
    mimicBlob: state.mimic?.blob || null,
    updatedAt: Date.now(),
  };
  await putClipRecord(db, payload);
}

async function loadFromDb() {
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    const record = await getClipRecord(db);
    if (!record) return;

    if (record.originalBlob) {
      const buffer = await decodeBlob(record.originalBlob);
      state.original = {
        blob: record.originalBlob,
        buffer,
        duration: buffer.duration,
        mimeType: record.originalBlob.type,
      };
      state.reversed = reverseAudioBuffer(buffer);
      updatePanel("original");
    }

    if (record.mimicBlob) {
      const buffer = await decodeBlob(record.mimicBlob);
      state.mimic = {
        blob: record.mimicBlob,
        buffer,
        duration: buffer.duration,
        mimeType: record.mimicBlob.type,
      };
      state.mimicReversed = reverseAudioBuffer(buffer);
      updatePanel("mimic");
    }

    if (record.originalBlob || record.mimicBlob) {
      setStatus(elements.transportStatus, "Loaded from local storage.");
    }
  } catch (error) {
    setStatus(elements.transportStatus, "Local storage unavailable.");
  }
}

async function clearStorage() {
  if (!dbPromise) return;
  const db = await dbPromise;
  stopAllPlayback(true);
  await clearClipRecord(db);
  state.original = null;
  state.mimic = null;
  state.reversed = null;
  state.mimicReversed = null;
  resetPanels();
  resetProgress();
}

function attachEvents() {
  elements.recordOriginal.addEventListener("click", () => {
    if (recording) {
      stopRecording();
    } else {
      startRecording("original");
    }
  });

  elements.recordMimic.addEventListener("click", () => {
    if (recording) {
      stopRecording();
    } else {
      startRecording("mimic");
    }
  });

  elements.playOriginal.addEventListener("click", () => {
    if (!state.original) {
      setStatus(elements.originalStatus, "Record something first.");
      return;
    }
    playBuffer(state.original.buffer, "Playing original.");
  });

  elements.playReverse.addEventListener("click", () => {
    if (!state.reversed) {
      setStatus(elements.originalStatus, "Record something first.");
      return;
    }
    playBuffer(state.reversed, "Playing reverse.");
  });

  elements.playMimic.addEventListener("click", () => {
    if (!state.mimic) {
      setStatus(elements.mimicStatus, "Record your mimic first.");
      return;
    }
    playBuffer(state.mimic.buffer, "Playing mimic.");
  });

  elements.playMimicReverse.addEventListener("click", () => {
    if (!state.mimicReversed) {
      setStatus(elements.mimicStatus, "Record your mimic first.");
      return;
    }
    playBuffer(state.mimicReversed, "Playing mimic reverse.");
  });

  elements.trackAToggle.addEventListener("click", () => {
    if (trackStates.A.isPlaying) {
      pauseTrackPlayback("A");
    } else {
      startTrackPlayback("A");
    }
  });

  elements.trackAStop.addEventListener("click", () => {
    stopTrackPlaybackFully("A");
  });

  elements.trackAScrub.addEventListener("input", (event) => {
    seekTrack("A", Number(event.target.value));
  });

  elements.trackASource.addEventListener("change", (event) => {
    switchTrackSource("A", event.target.value);
  });

  elements.trackBToggle.addEventListener("click", () => {
    if (trackStates.B.isPlaying) {
      pauseTrackPlayback("B");
    } else {
      startTrackPlayback("B");
    }
  });

  elements.trackBStop.addEventListener("click", () => {
    stopTrackPlaybackFully("B");
  });

  elements.trackBScrub.addEventListener("input", (event) => {
    seekTrack("B", Number(event.target.value));
  });

  elements.trackBSource.addEventListener("change", (event) => {
    switchTrackSource("B", event.target.value);
  });

  elements.downloadOriginal.addEventListener("click", () => {
    if (!state.original) return;
    const ext = extensionForMime(state.original.mimeType);
    downloadBlob(state.original.blob, `original-${Date.now()}.${ext}`);
  });

  elements.downloadMimic.addEventListener("click", () => {
    if (!state.mimic) return;
    const ext = extensionForMime(state.mimic.mimeType);
    downloadBlob(state.mimic.blob, `mimic-${Date.now()}.${ext}`);
  });

  elements.uploadOriginal.addEventListener("click", () => {
    elements.uploadOriginalInput.click();
  });

  elements.uploadOriginalInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    await handleUploadedFile("original", file);
    event.target.value = "";
  });

  elements.uploadMimic.addEventListener("click", () => {
    elements.uploadMimicInput.click();
  });

  elements.uploadMimicInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    await handleUploadedFile("mimic", file);
    event.target.value = "";
  });

  elements.clearStorage.addEventListener("click", () => {
    clearStorage();
  });
}

function init() {
  elements.maxSeconds.textContent = `${MAX_SECONDS}s`;
  setControlsEnabled(true);
  updateTransportUI();
  updateDownloadButtons();
  dbPromise = openDb();
  loadFromDb();
  attachEvents();
  window.addEventListener("resize", () => {
    drawTrackWaveform("A");
    drawTrackWaveform("B");
  });
}

init();
