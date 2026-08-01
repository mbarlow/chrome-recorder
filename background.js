// Background service worker for Chrome Recorder.
//
// MV3 suspends this worker after ~30s idle, so in-memory variables can't be
// trusted across a recording. chrome.storage.local is the single source of
// truth; reads always come from storage so popup/shortcut/content-script see
// the real state even after the worker was torn down and respawned.

// Valid webcam overlay corners, in cycle order (bottom-right is the default,
// streamer-standard spot).
const CORNERS = ["br", "bl", "tl", "tr"];

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log("Chrome Recorder extension installed");
  chrome.storage.local.set({
    isRecording: false,
    isStarting: false,
    recordingStartTime: null,
    currentTabId: null,
    // Webcam overlay settings persist across recordings.
    webcamEnabled: false,
    webcamCorner: "br",
  });
});

// --- State (backed by storage) --------------------------------------------

async function getState() {
  const s = await chrome.storage.local.get([
    "isRecording",
    "isStarting",
    "recordingStartTime",
    "currentTabId",
    "webcamEnabled",
    "webcamCorner",
  ]);
  return {
    isRecording: !!s.isRecording,
    isStarting: !!s.isStarting,
    recordingStartTime: s.recordingStartTime ?? null,
    currentTabId: s.currentTabId ?? null,
    webcamEnabled: !!s.webcamEnabled,
    webcamCorner: CORNERS.includes(s.webcamCorner) ? s.webcamCorner : "br",
  };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

// Every message we send to the offscreen document carries target:"offscreen"
// so that document can ignore traffic meant for us (see offscreen.js — an
// unfiltered listener there answers get-status with null and breaks the UI).
function toOffscreen(message) {
  return chrome.runtime.sendMessage({ ...message, target: "offscreen" });
}

// Relay a message to the offscreen document. No-op (swallowed) when no
// offscreen doc / popup is listening — used for live overlay tweaks.
async function relayToOffscreen(message) {
  try {
    await toOffscreen(message);
  } catch (e) {
    // No receiving end (not recording, or popup closed) — nothing to update.
  }
}

// --- Webcam overlay settings ----------------------------------------------

async function setWebcamEnabled(enabled) {
  await setState({ webcamEnabled: enabled });
  await relayToOffscreen({ action: "set-webcam", enabled });
}

async function setWebcamCorner(corner) {
  if (!CORNERS.includes(corner)) return;
  await setState({ webcamCorner: corner });
  await relayToOffscreen({ action: "set-corner", corner });
}

async function toggleWebcam() {
  const { webcamEnabled } = await getState();
  await setWebcamEnabled(!webcamEnabled);
}

async function cycleCorner() {
  const { webcamCorner } = await getState();
  const next = CORNERS[(CORNERS.indexOf(webcamCorner) + 1) % CORNERS.length];
  await setWebcamCorner(next);
}

// --- Recording control -----------------------------------------------------

async function startRecording() {
  // Already running (e.g. worker was respawned and the shortcut/popup fired a
  // duplicate start) — ignore so we never open a second capture. `isStarting`
  // covers the gap while the screen picker is up: isRecording isn't true yet,
  // so without it a second shortcut press opens a second picker.
  const { isRecording, isStarting } = await getState();
  if (isRecording || isStarting) {
    return;
  }
  await setState({ isStarting: true });
  try {
    await startRecordingInner();
  } finally {
    await setState({ isStarting: false });
  }
}

async function startRecordingInner() {
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

  // Send message to offscreen document to start recording, seeding the
  // current webcam overlay settings.
  const { webcamEnabled, webcamCorner } = await getState();
  const response = await toOffscreen({
    action: "start-recording",
    tabId: activeTab.id,
    webcamEnabled,
    webcamCorner,
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

  // Ensure the indicator's content script is present. The manifest only
  // injects it on pages loaded after install, so tabs already open when the
  // extension loaded would otherwise show no indicator. Re-injection is a
  // no-op (guarded), and on (re)run it self-checks status and shows the pill.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["content.js"],
    });
  } catch (e) {
    // Restricted page (e.g. the Web Store) — can't inject; skip silently.
  }

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

  // Ask the offscreen document to stop. This MUST NOT be able to abort the
  // rest of the function: if the offscreen document is gone (crashed, already
  // torn down, worker respawned mid-teardown) the send rejects with "Receiving
  // end does not exist", and an uncaught rejection here used to leave
  // isRecording stuck true forever — badge pinned to REC, and every later stop
  // attempt failing the same way. Stopping the UI state is unconditional.
  try {
    await toOffscreen({ action: "stop-recording" });
  } catch (e) {
    console.warn("Offscreen document not reachable on stop:", e.message);
    // Nothing is capturing; make sure no orphan document lingers.
    await closeOffscreenDocument();
  }

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
    isStarting: false,
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
  // Traffic addressed to the offscreen document is none of our business.
  if (request?.target === "offscreen") return false;

  if (request.action === "get-status") {
    getState().then((state) => sendResponse(state));
    return true; // async read from storage
  } else if (request.action === "toggle-recording") {
    toggleRecording()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  } else if (request.action === "set-webcam-enabled") {
    // From the popup. Relays live to the offscreen doc if recording.
    setWebcamEnabled(!!request.enabled)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (request.action === "set-webcam-corner") {
    setWebcamCorner(request.corner)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (request.action === "recording-complete") {
    // Handle recording completion from offscreen document. This also covers
    // the path where the stop path never ran — e.g. the user ended sharing
    // from the browser chrome — so hide the on-page indicator here too,
    // otherwise the pill lingers and its next click starts a new recording.
    getState()
      .then(({ currentTabId }) => {
        if (currentTabId) {
          chrome.tabs
            .sendMessage(currentTabId, { action: "recording-stopped" })
            .catch(() => {});
        }
        return setState({
          isRecording: false,
          isStarting: false,
          recordingStartTime: null,
          currentTabId: null,
        });
      })
      .then(() => updateBadge("", "#000000"));
    // Download is already committed by the click(); safe to tear down now.
    closeOffscreenDocument();
    sendResponse({ success: true });
    return false;
  }

  return false;
});

// Keyboard shortcuts (configurable at chrome://extensions/shortcuts).
if (chrome.commands) {
  const handlers = {
    "toggle-recording": toggleRecording,
    "toggle-webcam": toggleWebcam,
    "cycle-corner": cycleCorner,
  };
  chrome.commands.onCommand.addListener((command) => {
    const handler = handlers[command];
    if (handler) {
      handler().catch((err) =>
        console.error(`Shortcut "${command}" failed:`, err),
      );
    }
  });
}

// NOTE: there is deliberately no chrome.runtime.onSuspend handler here.
//
// MV3 suspends this worker after ~30s idle, which during a recording is the
// normal case — nothing keeps the worker alive while the offscreen document
// captures. An onSuspend handler that called stopRecording() therefore ended
// the user's recording on a timer: it messaged the offscreen document to stop
// and save, cleared the badge, and hid the on-page indicator. Routine worker
// recycling is not a signal that the user wants to stop.
//
// Recording state lives in chrome.storage.local and the capture lives in the
// offscreen document, so both survive suspension. The worker respawns on the
// next message and reads the truth back out of storage.
