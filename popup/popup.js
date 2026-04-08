// Popup script for Chrome Recorder
let timerInterval = null;

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const timerEl = document.getElementById("timer");
const toggleBtn = document.getElementById("toggle-btn");

document.addEventListener("DOMContentLoaded", async () => {
  await updateStatus();
  toggleBtn.addEventListener("click", handleToggle);
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
    if (status.isRecording) {
      showRecording(status.recordingStartTime);
    } else {
      showIdle();
    }
  } catch (error) {
    console.error("Error getting status:", error);
    showIdle();
  }
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
