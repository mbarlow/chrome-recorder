// Offscreen document: capture + (optional) webcam picture-in-picture compositing.
//
// MediaRecorder can only record ONE stream, so to overlay the webcam we draw
// the screen full-frame + the webcam in a corner onto a <canvas> every frame
// and record canvas.captureStream(). Audio (system + mic) is mixed through an
// AudioContext into a single track that's present from the start — so the mic
// can be connected/disconnected mid-recording and still land in the file.

let mediaRecorder = null;
let chunks = [];

// Input streams + their <video> elements.
let screenStream = null;
let webcamStream = null;
let screenVideo = null;
let webcamVideo = null;

// Compositing.
let canvas = null;
let ctx = null;
let rafId = null;

// Audio mixing. The dest track is added to the recorder at start and stays put;
// sources connect/disconnect underneath it.
let audioCtx = null;
let audioDest = null;
const audioSources = {}; // key -> MediaStreamAudioSourceNode

// Live overlay state.
let webcamOn = false;
let corner = "br";

// PiP layout, as fractions of the canvas width.
const PIP_WIDTH_FRAC = 0.22;
const PIP_MARGIN_FRAC = 0.02;

// Pick the best container/codec the browser actually supports.
function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "start-recording") {
    try {
      await startRecording(request);
      sendResponse({ success: true });
    } catch (error) {
      // User dismissing the screen picker is expected, not a failure.
      const cancelled = error.name === "NotAllowedError";
      if (!cancelled) {
        console.error("Offscreen recording error:", error.name, error.message);
      }
      sendResponse({
        success: false,
        cancelled,
        error: error.message || String(error),
      });
    }
  } else if (request.action === "stop-recording") {
    try {
      await stopRecording();
      sendResponse({ success: true });
    } catch (error) {
      console.error("Offscreen stop error:", error);
      sendResponse({ success: false, error: error.message });
    }
  } else if (request.action === "set-webcam") {
    // Live toggle during a recording.
    setWebcam(request.enabled).catch((e) =>
      console.error("set-webcam failed:", e),
    );
    sendResponse({ success: true });
  } else if (request.action === "set-corner") {
    corner = request.corner || corner;
    sendResponse({ success: true });
  }
});

// --- Helpers ---------------------------------------------------------------

function makeVideoEl(stream) {
  const v = document.createElement("video");
  v.srcObject = stream;
  v.muted = true; // never play audio locally; we only read frames
  v.playsInline = true;
  v.play().catch(() => {});
  return v;
}

function waitForVideo(v) {
  return new Promise((resolve) => {
    if (v.readyState >= 1 && v.videoWidth) return resolve();
    v.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });
}

function connectAudio(key, stream) {
  if (!audioCtx || !audioDest || !stream) return;
  const tracks = stream.getAudioTracks();
  if (!tracks.length || audioSources[key]) return;
  const src = audioCtx.createMediaStreamSource(new MediaStream([tracks[0]]));
  src.connect(audioDest);
  audioSources[key] = src;
}

function disconnectAudio(key) {
  const src = audioSources[key];
  if (src) {
    try {
      src.disconnect();
    } catch (e) {}
    delete audioSources[key];
  }
}

// --- Webcam ----------------------------------------------------------------

async function enableWebcam() {
  if (webcamStream) return; // already open
  webcamStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: true,
  });
  webcamVideo = makeVideoEl(webcamStream);
  await waitForVideo(webcamVideo);
  connectAudio("mic", webcamStream); // route mic into the mixed track
  webcamOn = true;
}

function disableWebcam() {
  webcamOn = false;
  disconnectAudio("mic");
  if (webcamStream) {
    // Stop tracks so the camera light goes off while hidden.
    webcamStream.getTracks().forEach((t) => t.stop());
  }
  webcamStream = null;
  webcamVideo = null;
}

async function setWebcam(enabled) {
  if (enabled) {
    await enableWebcam();
  } else {
    disableWebcam();
  }
}

// --- Compositing -----------------------------------------------------------

function drawFrame() {
  if (!ctx || !canvas) return;
  const W = canvas.width;
  const H = canvas.height;

  // Screen fills the frame.
  if (screenVideo && screenVideo.readyState >= 2) {
    ctx.drawImage(screenVideo, 0, 0, W, H);
  }

  // Webcam PiP in the chosen corner, keeping the camera's own aspect ratio.
  if (webcamOn && webcamVideo && webcamVideo.readyState >= 2) {
    const camAspect =
      webcamVideo.videoWidth / webcamVideo.videoHeight || 16 / 9;
    const pipW = Math.round(W * PIP_WIDTH_FRAC);
    const pipH = Math.round(pipW / camAspect);
    const m = Math.round(W * PIP_MARGIN_FRAC);

    let x, y;
    if (corner === "bl") {
      x = m;
      y = H - pipH - m;
    } else if (corner === "tl") {
      x = m;
      y = m;
    } else if (corner === "tr") {
      x = W - pipW - m;
      y = m;
    } else {
      // "br" default
      x = W - pipW - m;
      y = H - pipH - m;
    }

    const radius = Math.round(pipW * 0.06);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, pipW, pipH, radius);
    ctx.clip();
    ctx.drawImage(webcamVideo, x, y, pipW, pipH);
    ctx.restore();

    // Subtle border to lift the overlay off the background.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, pipW, pipH, radius);
    ctx.lineWidth = Math.max(2, Math.round(pipW * 0.012));
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();
    ctx.restore();
  }

  rafId = requestAnimationFrame(drawFrame);
}

// --- Recording lifecycle ---------------------------------------------------

async function startRecording(opts) {
  try {
    corner = opts?.webcamCorner || "br";
    chunks = [];

    // 1) Screen capture (this is what the picker prompts for). Hint the
    //    monitor surface so the picker biases toward whole-output capture —
    //    a window pick would stay fixed on that window across workspace
    //    switches (notably on Wayland/Hyprland). ("mediaSource" is a
    //    non-standard constraint Chrome ignores; displaySurface is the real one.)
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor" },
      audio: true,
    });
    screenVideo = makeVideoEl(screenStream);
    await waitForVideo(screenVideo);

    // 2) Canvas sized to the captured screen.
    canvas = document.createElement("canvas");
    canvas.width = screenVideo.videoWidth || 1920;
    canvas.height = screenVideo.videoHeight || 1080;
    ctx = canvas.getContext("2d");

    // 3) Audio graph. The dest track is added to the recorder up front so
    //    sources (system audio now, mic later) can route into it live.
    audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") {
      await audioCtx.resume().catch(() => {});
    }
    audioDest = audioCtx.createMediaStreamDestination();
    connectAudio("screen", screenStream); // system/tab audio if shared

    // 4) Optional webcam at start.
    if (opts?.webcamEnabled) {
      try {
        await enableWebcam();
      } catch (e) {
        // No camera / permission not granted yet — record screen-only.
        console.warn("Webcam unavailable, recording screen only:", e.message);
        webcamOn = false;
      }
    }

    // 5) Start the compositor, then build the output stream from it.
    drawFrame();
    const canvasStream = canvas.captureStream(30);
    const outputTracks = [...canvasStream.getVideoTracks()];
    const mixedAudio = audioDest.stream.getAudioTracks();
    if (mixedAudio.length) outputTracks.push(mixedAudio[0]);
    const outputStream = new MediaStream(outputTracks);

    // 6) Record.
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(
      outputStream,
      mimeType ? { mimeType } : undefined,
    );
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    mediaRecorder.onstop = async () => {
      await saveRecording();
    };
    mediaRecorder.onerror = (event) => {
      console.error("MediaRecorder error:", event.error);
    };

    // Stop if the user ends screen sharing from the browser chrome.
    screenStream.getVideoTracks()[0].addEventListener("ended", () => {
      console.log("Screen sharing ended by user");
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
      stopInputs();
    });

    // No timeslice: one self-contained blob on stop (a sliced first
    // fragment can drop the init header and produce an unplayable file).
    mediaRecorder.start();
    console.log("Recording started in offscreen document");
  } catch (error) {
    // Reset so a cancelled/failed start doesn't leave half-open streams.
    stopInputs();
    mediaRecorder = null;
    throw error;
  }
}

// Stop all capture inputs and the draw loop (but not the recorder — its onstop
// still needs to flush the final blob).
function stopInputs() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
  if (webcamStream) webcamStream.getTracks().forEach((t) => t.stop());
  screenStream = null;
  webcamStream = null;
  screenVideo = null;
  webcamVideo = null;
  webcamOn = false;
}

async function stopRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop(); // triggers onstop -> saveRecording
    }
    stopInputs();
    console.log("Recording stopped in offscreen document");
  } catch (error) {
    console.error("Failed to stop recording:", error);
    throw error;
  }
}

async function saveRecording() {
  try {
    if (chunks.length === 0) {
      console.warn("No recording data to save");
    } else {
      // Use the type the recorder actually negotiated so the container
      // and the file always agree.
      const type = (mediaRecorder && mediaRecorder.mimeType) || "video/webm";
      const blob = new Blob(chunks, { type });
      const url = URL.createObjectURL(blob);

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
      const filename = `chrome-recording-${timestamp}.${ext}`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      console.log(`Recording saved: ${filename}`);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // Tear down everything for a clean next recording.
    stopInputs();
    if (audioCtx) {
      audioCtx.close().catch(() => {});
    }
    Object.keys(audioSources).forEach((k) => delete audioSources[k]);
    audioCtx = null;
    audioDest = null;
    canvas = null;
    ctx = null;
    mediaRecorder = null;
    chunks = [];

    // Notify background script that recording is complete
    chrome.runtime.sendMessage({ action: "recording-complete" });
  } catch (error) {
    console.error("Failed to save recording:", error);
    throw error;
  }
}
