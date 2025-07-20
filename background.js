// Background service worker for tab recording functionality
let isRecording = false;
let recordingStartTime = null;
let currentTabId = null;

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log("Tab Recorder extension installed");
  chrome.storage.local.set({
    isRecording: false,
    recordingCount: 0,
  });
});

// Handle keyboard command
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-recording") {
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (error) {
      console.error("Recording toggle error:", error);
      await updateBadge("ERR", "#ff0000");

      // Reset state on error
      isRecording = false;
      currentTabId = null;
      await chrome.storage.local.set({ isRecording: false });

      // Show user-friendly error
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-48.png",
        title: "Tab Recorder Error",
        message: error.message,
      });
    }
  }
});

// Start recording function
async function startRecording() {
  try {
    // Get current active tab
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!activeTab) {
      throw new Error("No active tab found");
    }

    // Check if tab URL is accessible
    if (
      activeTab.url.startsWith("chrome://") ||
      activeTab.url.startsWith("chrome-extension://") ||
      activeTab.url.startsWith("edge://") ||
      activeTab.url.startsWith("about:")
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
      throw new Error(response?.error || "Failed to start recording");
    }

    // Update state
    isRecording = true;
    currentTabId = activeTab.id;
    recordingStartTime = Date.now();
    await chrome.storage.local.set({ isRecording: true });
    await updateBadge("REC", "#ff0000");

    // Notify content script if possible
    try {
      chrome.tabs.sendMessage(activeTab.id, {
        action: "recording-started",
        timestamp: recordingStartTime,
      });
    } catch (e) {
      // Content script might not be ready, that's ok
    }

    console.log("Recording started");

    // Show notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-48.png",
      title: "Recording Started",
      message: "Press Ctrl+Shift+R again to stop recording",
    });
  } catch (error) {
    console.error("Failed to start recording:", error);
    throw error;
  }
}

// Stop recording function
async function stopRecording() {
  try {
    // Send message to offscreen document to stop recording
    await chrome.runtime.sendMessage({
      action: "stop-recording",
    });

    // Notify content script if possible
    if (currentTabId) {
      try {
        chrome.tabs.sendMessage(currentTabId, {
          action: "recording-stopped",
        });
      } catch (e) {
        // Content script might not be ready, that's ok
      }
    }

    // Update state
    isRecording = false;
    currentTabId = null;
    await chrome.storage.local.set({ isRecording: false });
    await updateBadge("", "#000000");

    console.log("Recording stopped");

    // Show notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-48.png",
      title: "Recording Stopped",
      message: "Video saved to Downloads folder",
    });
  } catch (error) {
    console.error("Failed to stop recording:", error);
    throw error;
  }
}

// Create offscreen document for recording
async function createOffscreenDocument() {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen.html")],
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  // Create offscreen document
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: ["USER_MEDIA"],
    justification: "Recording screen content",
  });
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

// Handle popup messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get-status") {
    sendResponse({
      isRecording,
      recordingStartTime,
      currentTabId,
    });
  } else if (request.action === "toggle-recording") {
    if (isRecording) {
      stopRecording()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    } else {
      startRecording()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    }
    return true; // Keep message channel open for async response
  } else if (request.action === "recording-complete") {
    // Handle recording completion from offscreen document
    isRecording = false;
    currentTabId = null;
    chrome.storage.local.set({ isRecording: false });
    updateBadge("", "#000000");
    sendResponse({ success: true });
  }
});

// Clean up on extension shutdown
chrome.runtime.onSuspend.addListener(() => {
  if (isRecording) {
    stopRecording();
  }
});
