// Popup script for Chrome Recorder
let timerInterval = null;

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const timerEl = document.getElementById("timer");
const toggleBtn = document.getElementById("toggle-btn");
const webcamToggle = document.getElementById("webcam-toggle");
const cornersEl = document.getElementById("corners");
const webcamHint = document.getElementById("webcam-hint");

document.addEventListener("DOMContentLoaded", async () => {
  await updateStatus();
  toggleBtn.addEventListener("click", handleToggle);
  webcamToggle.addEventListener("change", handleWebcamToggle);
  cornersEl.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => handleCornerPick(b.dataset.corner));
  });
  setInterval(updateStatus, 1000);
});

async function handleToggle() {
  try {
    toggleBtn.disabled = true;
    const response = await chrome.runtime.sendMessage({
      action: "toggle-recording",
    });
    if (response && response.success) {
      await updateStatus();
    }
  } catch (error) {
    console.error("Error toggling recording:", error);
  } finally {
    toggleBtn.disabled = false;
  }
}

async function updateStatus() {
  try {
    const status = await chrome.runtime.sendMessage({
      action: "get-status",
    });
    if (status && status.isRecording) {
      showRecording(status.recordingStartTime);
    } else {
      showIdle();
    }
    renderWebcam(status || {});
  } catch (error) {
    console.error("Error getting status:", error);
    showIdle();
  }
}

// Reflect webcam settings (kept in sync so keyboard-shortcut changes show up
// while the popup is open).
function renderWebcam(state) {
  webcamToggle.checked = !!state.webcamEnabled;
  const corner = state.webcamCorner || "br";
  cornersEl.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.corner === corner);
  });
  cornersEl.classList.toggle("disabled", !state.webcamEnabled);
}

async function handleWebcamToggle() {
  const enable = webcamToggle.checked;
  if (enable && !(await isCameraGranted())) {
    // Can't request camera from the action popup — it closes the moment the
    // permission chip appears. Hand off to a real window that survives focus
    // loss; it grants the camera and enables the overlay itself.
    chrome.windows.create({
      url: chrome.runtime.getURL("popup/permission.html"),
      type: "popup",
      width: 360,
      height: 200,
      focused: true,
    });
    webcamToggle.checked = false;
    webcamHint.textContent = "Allow camera in the window that opened.";
    return;
  }
  webcamHint.textContent = "";
  await chrome.runtime.sendMessage({
    action: "set-webcam-enabled",
    enabled: enable,
  });
  await updateStatus();
}

async function isCameraGranted() {
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const st = await navigator.permissions.query({ name: "camera" });
      return st.state === "granted";
    }
  } catch (e) {
    // permissions.query may not support "camera" — assume not granted, which
    // routes through the permission window (safe either way).
  }
  return false;
}

async function handleCornerPick(corner) {
  await chrome.runtime.sendMessage({
    action: "set-webcam-corner",
    corner,
  });
  await updateStatus();
}

function showRecording(startTime) {
  statusDot.classList.add("recording");
  statusText.textContent = "Recording";
  toggleBtn.textContent = "Stop Recording";
  toggleBtn.classList.add("recording");

  if (startTime) {
    timerEl.classList.add("visible");
    updateTimer(startTime);
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => updateTimer(startTime), 1000);
  }
}

function showIdle() {
  statusDot.classList.remove("recording");
  statusText.textContent = "Ready";
  toggleBtn.textContent = "Start Recording";
  toggleBtn.classList.remove("recording");

  timerEl.classList.remove("visible");
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimer(startTime) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  timerEl.textContent =
    minutes.toString().padStart(2, "0") +
    ":" +
    seconds.toString().padStart(2, "0");
}

window.addEventListener("beforeunload", () => {
  if (timerInterval) clearInterval(timerInterval);
});
