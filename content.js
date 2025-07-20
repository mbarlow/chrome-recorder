// Content script for Tab Recorder extension
// Provides visual feedback and tab-level recording indicators

let recordingIndicator = null;
let isRecording = false;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "recording-started") {
    showRecordingIndicator();
    isRecording = true;
  } else if (request.action === "recording-stopped") {
    hideRecordingIndicator();
    isRecording = false;
  }
});

// Create and show recording indicator
function showRecordingIndicator() {
  // Remove existing indicator if present
  hideRecordingIndicator();

  // Create indicator element
  recordingIndicator = document.createElement("div");
  recordingIndicator.id = "tab-recorder-indicator";
  recordingIndicator.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(255, 0, 0, 0.9);
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 600;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      display: flex;
      align-items: center;
      gap: 6px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      animation: pulse 2s infinite;
    ">
      <div style="
        width: 8px;
        height: 8px;
        background: white;
        border-radius: 50%;
        animation: blink 1s infinite;
      "></div>
      REC
    </div>
    <style>
      @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }
      @keyframes blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    </style>
  `;

  // Add to page
  document.body.appendChild(recordingIndicator);

  // Add click handler to stop recording
  recordingIndicator.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "toggle-recording" });
  });

  // Make it draggable (optional enhancement)
  makeIndicatorDraggable();
}

// Hide recording indicator
function hideRecordingIndicator() {
  if (recordingIndicator) {
    recordingIndicator.remove();
    recordingIndicator = null;
  }
}

// Make indicator draggable for better UX
function makeIndicatorDraggable() {
  if (!recordingIndicator) return;

  const indicator = recordingIndicator.firstElementChild;
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  indicator.style.cursor = "move";

  indicator.addEventListener("mousedown", (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = indicator.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    indicator.style.transition = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    const newLeft = Math.max(
      0,
      Math.min(window.innerWidth - indicator.offsetWidth, startLeft + deltaX),
    );
    const newTop = Math.max(
      0,
      Math.min(window.innerHeight - indicator.offsetHeight, startTop + deltaY),
    );

    indicator.style.left = newLeft + "px";
    indicator.style.top = newTop + "px";
    indicator.style.right = "auto";
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      indicator.style.transition = "";
    }
  });
}

// Clean up indicator on page unload
window.addEventListener("beforeunload", () => {
  hideRecordingIndicator();
});

// Initialize - check if recording is already in progress
chrome.runtime
  .sendMessage({ action: "get-status" })
  .then((status) => {
    if (status && status.isRecording) {
      showRecordingIndicator();
      isRecording = true;
    }
  })
  .catch(() => {
    // Extension might be starting up, ignore errors
  });
