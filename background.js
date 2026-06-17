// Background service worker for Chrome Recorder.
//
// MV3 suspends this worker after ~30s idle, so in-memory variables can't be
// trusted across a recording. chrome.storage.local is the single source of
// truth; reads always come from storage so popup/shortcut/content-script see
// the real state even after the worker was torn down and respawned.

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log("Chrome Recorder extension installed");
  chrome.storage.local.set({
    isRecording: false,
    recordingStartTime: null,
    currentTabId: null,
    recordingCount: 0,
  });
});

// --- State (backed by storage) --------------------------------------------

async function getState() {
  const s = await chrome.storage.local.get([
    "isRecording",
    "recordingStartTime",
    "currentTabId",
  ]);
  return {
    isRecording: !!s.isRecording,
    recordingStartTime: s.recordingStartTime ?? null,
    currentTabId: s.currentTabId ?? null,
  };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

// --- Recording control -----------------------------------------------------

async function startRecording() {
  // Already running (e.g. worker was respawned and the shortcut/popup fired a
  // duplicate start) — ignore so we never open a second capture.
  const { isRecording } = await getState();
  if (isRecording) {
    return;
  }

  // Get current active tab
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab) {
    throw new Error("No active tab found");
  }

  // Check if tab URL is accessible. url can be undefined on restricted tabs.
  const url = activeTab.url || "";
  if (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:")
  ) {
    throw new Error(
      "Cannot record Chrome internal pages. Please navigate to a regular website (like google.com) and try again.",
    );
  }

  // Create offscreen document for recording
  await createOffscreenDocument();

  // Send message to offscreen document to start recording
  const response = await chrome.runtime.sendMessage({
    action: "start-recording",
    tabId: activeTab.id,
  });

  if (!response || !response.success) {
    // User dismissed the screen picker — not an error, just don't start.
    if (response && response.cancelled) {
      console.log("Recording cancelled by user");
      // Nothing was captured; drop the unused offscreen document.
      await closeOffscreenDocument();
      return;
    }
    await closeOffscreenDocument();
    throw new Error(response?.error || "Failed to start recording");
  }

  // Persist state, then reflect it in the UI surfaces.
  const recordingStartTime = Date.now();
  await setState({
    isRecording: true,
    recordingStartTime,
    currentTabId: activeTab.id,
  });
  await updateBadge("REC", "#ff0000");

  // Notify content script if possible. The rejection is async, so catch
  // on the promise — a try/catch won't see "receiving end does not exist".
  chrome.tabs
    .sendMessage(activeTab.id, {
      action: "recording-started",
      timestamp: recordingStartTime,
    })
    .catch(() => {}); // content script may not be injected on this tab

  console.log("Recording started");
}

async function stopRecording() {
  const { currentTabId } = await getState();

  // Send message to offscreen document to stop recording
  await chrome.runtime.sendMessage({
    action: "stop-recording",
  });

  // Notify content script if possible (async rejection — catch on promise).
  if (currentTabId) {
    chrome.tabs
      .sendMessage(currentTabId, { action: "recording-stopped" })
      .catch(() => {}); // content script may not be injected on this tab
  }

  // Clear state and UI. The offscreen document tears itself down once the
  // download is committed (recording-complete).
  await setState({
    isRecording: false,
    recordingStartTime: null,
    currentTabId: null,
  });
  await updateBadge("", "#000000");

  console.log("Recording stopped");
}

// Create offscreen document for recording
async function createOffscreenDocument() {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen/offscreen.html")],
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  // Create offscreen document
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen/offscreen.html"),
    reasons: ["USER_MEDIA"],
    justification: "Recording screen content",
  });
}

// Tear down the offscreen document so each recording starts from a fresh
// page — no stale MediaRecorder/stream/chunks carried between recordings.
async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    // No document open; nothing to close.
  }
}

// Update extension badge
async function updateBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch (error) {
    console.error("Failed to update badge:", error);
  }
}

// Toggle helper shared by the popup and the keyboard command.
async function toggleRecording() {
  const { isRecording } = await getState();
  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
}

// --- Messaging -------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get-status") {
    getState().then((state) => sendResponse(state));
    return true; // async read from storage
  } else if (request.action === "toggle-recording") {
    toggleRecording()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  } else if (request.action === "recording-complete") {
    // Handle recording completion from offscreen document. Clear any state
    // the stop path didn't (e.g. user ended sharing from the browser chrome).
    setState({
      isRecording: false,
      recordingStartTime: null,
      currentTabId: null,
    }).then(() => updateBadge("", "#000000"));
    // Download is already committed by the click(); safe to tear down now.
    closeOffscreenDocument();
    sendResponse({ success: true });
  }
});

// Keyboard shortcut (configurable at chrome://extensions/shortcuts).
if (chrome.commands) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-recording") {
      toggleRecording().catch((err) =>
        console.error("Shortcut toggle failed:", err),
      );
    }
  });
}

// Clean up on extension shutdown
chrome.runtime.onSuspend.addListener(() => {
  getState().then(({ isRecording }) => {
    if (isRecording) {
      stopRecording();
    }
  });
});
