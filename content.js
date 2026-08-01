// Content script for Chrome Recorder extension.
//
// Injected both by the manifest (on page load) and programmatically on
// record-start (so tabs open before the extension still get the indicator).
// The guard makes a second injection a no-op instead of stacking listeners.
if (!window.__chromeRecorderInjected) {
  window.__chromeRecorderInjected = true;

let recordingIndicator = null;
let isRecording = false;

// After the extension is reloaded/updated, content scripts already living on
// open tabs are orphaned: chrome.runtime is torn out, so touching it throws
// "Cannot read properties of undefined". Guard every message and, if we find
// ourselves orphaned, retire the now-dead indicator instead of erroring.
function extensionAlive() {
  return typeof chrome !== "undefined" && chrome.runtime && !!chrome.runtime.id;
}

function send(message) {
  if (!extensionAlive()) {
    hideRecordingIndicator();
    return;
  }
  try {
    const p = chrome.runtime.sendMessage(message);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    hideRecordingIndicator(); // context invalidated mid-call
  }
}

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

  // This script runs at document_start, so document.body can still be null
  // when a status check comes back early — appendChild would throw and the
  // indicator would silently never appear on that page. Wait for the body.
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", () => showRecordingIndicator(), {
      once: true,
    });
    return;
  }

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
        send({ action: "toggle-recording" });
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

// Ask the background whether a recording is in progress and match the pill to
// the answer. A null reply means the message didn't reach the background, not
// that recording stopped, so leave the indicator alone in that case.
function syncIndicator() {
  if (!extensionAlive()) return;
  chrome.runtime
    .sendMessage({ action: "get-status" })
    .then((status) => {
      if (!status) return; // messaging artifact — not a state reading
      if (status.isRecording) {
        if (!recordingIndicator) showRecordingIndicator();
        isRecording = true;
      } else {
        hideRecordingIndicator();
        isRecording = false;
      }
    })
    .catch(() => {});
}

syncIndicator();

// The background only messages the tab that was active when recording started,
// so tabs opened or focused later never heard about it. Re-check on focus:
// switching to a tab is the moment its indicator needs to be right.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncIndicator();
});

} // end __chromeRecorderInjected guard
