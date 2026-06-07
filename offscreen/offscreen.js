// Offscreen document for handling media recording
let mediaRecorder = null;
let recordingStream = null;
let chunks = [];

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
      await startRecording();
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
  }
});

async function startRecording() {
  try {
    // Request screen capture
    recordingStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        mediaSource: "screen",
      },
      audio: true,
    });

    // Initialize MediaRecorder
    chunks = [];
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(
      recordingStream,
      mimeType ? { mimeType } : undefined,
    );

    // Set up event handlers
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      await saveRecording();
    };

    mediaRecorder.onerror = (event) => {
      console.error("MediaRecorder error:", event.error);
    };

    // Handle stream ending (user stops sharing)
    recordingStream.getVideoTracks()[0].addEventListener("ended", () => {
      console.log("Screen sharing ended by user");
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    });

    // Start recording. No timeslice: the recorder emits a single,
    // self-contained blob on stop. Slicing into ~1s fragments risks
    // losing the first fragment (the EBML/init header), which produces
    // an unplayable file ("no supported format and MIME type").
    mediaRecorder.start();
    console.log("Recording started in offscreen document");
  } catch (error) {
    // Reset so a cancelled/failed start doesn't leave a half-open stream.
    if (recordingStream) {
      recordingStream.getTracks().forEach((track) => track.stop());
    }
    recordingStream = null;
    mediaRecorder = null;
    throw error;
  }
}

async function stopRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }

    if (recordingStream) {
      recordingStream.getTracks().forEach((track) => track.stop());
    }

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
      return;
    }

    // Use the type the recorder actually negotiated so the container
    // and the file always agree.
    const type = (mediaRecorder && mediaRecorder.mimeType) || "video/webm";
    const blob = new Blob(chunks, { type });
    const url = URL.createObjectURL(blob);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
    const filename = `chrome-recording-${timestamp}.${ext}`;

    // Create download link and trigger download
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    console.log(`Recording saved: ${filename}`);

    // Clean up
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10000);

    // Reset recording state
    mediaRecorder = null;
    recordingStream = null;
    chunks = [];

    // Notify background script that recording is complete
    chrome.runtime.sendMessage({
      action: "recording-complete",
    });
  } catch (error) {
    console.error("Failed to save recording:", error);
    throw error;
  }
}
