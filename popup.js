// Popup script for Tab Recorder extension
let timerInterval = null;

// DOM elements
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const statusDetailEl = document.getElementById("status-detail");
const timerEl = document.getElementById("timer");
const toggleBtn = document.getElementById("toggle-btn");
const loadingEl = document.getElementById("loading");

// Initialize popup
document.addEventListener("DOMContentLoaded", async () => {
  await updateStatus();

  // Set up button click handler
  toggleBtn.addEventListener("click", handleToggleClick);

  // Update status every second if recording
  setInterval(updateStatus, 1000);
});

// Handle toggle button click
async function handleToggleClick() {
  try {
    showLoading(true);
    toggleBtn.disabled = true;

    const response = await chrome.runtime.sendMessage({
      action: "toggle-recording",
    });

    if (response && response.success) {
      await updateStatus();
    } else {
      console.error("Failed to toggle recording");
    }
  } catch (error) {
    console.error("Error toggling recording:", error);
  } finally {
    showLoading(false);
    toggleBtn.disabled = false;
  }
}

// Update status display
async function updateStatus() {
  try {
    const status = await chrome.runtime.sendMessage({
      action: "get-status",
    });

    if (status.isRecording) {
      updateRecordingStatus(status.recordingStartTime);
    } else {
      updateIdleStatus();
    }
  } catch (error) {
    console.error("Error getting status:", error);
    updateErrorStatus();
  }
}

// Update UI for recording state
function updateRecordingStatus(startTime) {
  statusEl.className = "status recording";
  statusTextEl.textContent = "Recording in progress";
  statusDetailEl.textContent = "Active tab is being recorded";

  toggleBtn.textContent = "⏹️ Stop Recording";
  toggleBtn.className = "btn btn-danger";

  // Show and update timer
  if (startTime) {
    timerEl.style.display = "block";
    updateTimer(startTime);

    if (timerInterval) {
      clearInterval(timerInterval);
    }
    timerInterval = setInterval(() => updateTimer(startTime), 1000);
  }
}

// Update UI for idle state
function updateIdleStatus() {
  statusEl.className = "status idle";
  statusTextEl.textContent = "Ready to record";
  statusDetailEl.textContent = "Click button or use hotkey to start";

  toggleBtn.textContent = "🔴 Start Recording";
  toggleBtn.className = "btn btn-primary";

  // Hide timer
  timerEl.style.display = "none";
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Update UI for error state
function updateErrorStatus() {
  statusEl.className = "status";
  statusTextEl.textContent = "Error";
  statusDetailEl.textContent = "Please try again";

  toggleBtn.textContent = "🔴 Start Recording";
  toggleBtn.className = "btn btn-primary";

  timerEl.style.display = "none";
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Update recording timer
function updateTimer(startTime) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  timerEl.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

// Show/hide loading indicator
function showLoading(show) {
  if (show) {
    loadingEl.classList.add("show");
  } else {
    loadingEl.classList.remove("show");
  }
}

// Clean up on popup close
window.addEventListener("beforeunload", () => {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
});
