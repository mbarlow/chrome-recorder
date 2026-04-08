// Content script for Chrome Recorder extension

let recordingIndicator = null;
let isRecording = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "recording-started") {
    showRecordingIndicator();
    isRecording = true;
  } else if (request.action === "recording-stopped") {
    hideRecordingIndicator();
    isRecording = false;
  }
});

function showRecordingIndicator() {
  hideRecordingIndicator();

  recordingIndicator = document.createElement("div");
  recordingIndicator.id = "chrome-recorder-indicator";

  const style = document.createElement("style");
  style.textContent = `
    #chrome-recorder-indicator .cr-pill {
      position: fixed;
      top: 16px;
      right: 16px;
      background: rgba(0, 0, 0, 0.8);
      color: #E5E5E5;
      padding: 6px 12px;
      border-radius: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 12px;
      font-weight: 500;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 7px;
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s ease;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    }
    #chrome-recorder-indicator .cr-pill:hover {
      background: rgba(0, 0, 0, 0.9);
    }
    #chrome-recorder-indicator .cr-dot {
      width: 8px;
      height: 8px;
      background: #EF4444;
      border-radius: 50%;
      animation: cr-blink 1.2s ease-in-out infinite;
      flex-shrink: 0;
    }
    #chrome-recorder-indicator .cr-pill:hover .cr-dot {
      animation: none;
      background: #EF4444;
      border-radius: 2px;
    }
    #chrome-recorder-indicator .cr-label {}
    #chrome-recorder-indicator .cr-pill:hover .cr-label-rec { display: none; }
    #chrome-recorder-indicator .cr-pill:hover .cr-label-stop { display: inline; }
    #chrome-recorder-indicator .cr-label-stop { display: none; }
    @keyframes cr-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.25; }
    }
  `;

  const pill = document.createElement("div");
  pill.className = "cr-pill";
  pill.innerHTML = `
    <div class="cr-dot"></div>
    <span class="cr-label">
      <span class="cr-label-rec">REC</span>
      <span class="cr-label-stop">Stop</span>
    </span>
  `;

  recordingIndicator.appendChild(style);
  recordingIndicator.appendChild(pill);
  document.body.appendChild(recordingIndicator);

  // Click vs drag handling
  let dragStartX, dragStartY, didDrag;

  pill.addEventListener("mousedown", (e) => {
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    didDrag = false;

    const rect = pill.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    pill.style.transition = "none";

    function onMove(e) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;

      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        didDrag = true;
      }

      if (didDrag) {
        const newLeft = Math.max(0, Math.min(window.innerWidth - pill.offsetWidth, e.clientX - offsetX));
        const newTop = Math.max(0, Math.min(window.innerHeight - pill.offsetHeight, e.clientY - offsetY));
        pill.style.left = newLeft + "px";
        pill.style.top = newTop + "px";
        pill.style.right = "auto";
      }
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      pill.style.transition = "";

      if (!didDrag) {
        chrome.runtime.sendMessage({ action: "toggle-recording" });
      }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
}

function hideRecordingIndicator() {
  if (recordingIndicator) {
    recordingIndicator.remove();
    recordingIndicator = null;
  }
}

window.addEventListener("beforeunload", () => {
  hideRecordingIndicator();
});

chrome.runtime
  .sendMessage({ action: "get-status" })
  .then((status) => {
    if (status && status.isRecording) {
      showRecordingIndicator();
      isRecording = true;
    }
  })
  .catch(() => {});
