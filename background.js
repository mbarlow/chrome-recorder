// Background service worker for tab recording functionality
let recorder = null;
let stream = null;
let chunks = [];
let isRecording = false;
let recordingStartTime = null;

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
      recorder = null;
      stream = null;
      await chrome.storage.local.set({ isRecording: false });
    }
  }
});

// Start recording function
async function startRecording() {
  try {
    // Get current active tab for messaging
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!activeTab) {
      throw new Error("No active tab found");
    }

    // Inject script to trigger screen capture from content context
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: async () => {
        try {
          // Use getDisplayMedia for screen/tab capture
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              mediaSource: "screen",
            },
            audio: true,
          });

          // Store stream reference globally for background script access
          window.recordingStream = stream;
          return {
            success: true,
            hasAudio: stream.getAudioTracks().length > 0,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    });

    const result = results[0].result;
    if (!result.success) {
      throw new Error(result.error || "Failed to capture display media");
    }

    // Get the stream from the content script
    const [streamResult] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        if (window.recordingStream) {
          // Transfer stream tracks to background (this is tricky)
          return { hasStream: true };
        }
        return { hasStream: false };
      },
    });

    if (!streamResult.result.hasStream) {
      throw new Error("Failed to access recording stream");
    }

    // Since we can't directly transfer MediaStream between contexts,
    // we'll handle recording in the content script
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        if (window.recordingStream && !window.mediaRecorder) {
          const chunks = [];

          window.mediaRecorder = new MediaRecorder(window.recordingStream, {
            mimeType: "video/webm;codecs=vp9,opus",
          });

          window.mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              chunks.push(event.data);
            }
          };

          window.mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: "video/webm" });
            const url = URL.createObjectURL(blob);

            // Create download link
            const a = document.createElement("a");
            a.href = url;
            a.download = `tab-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // Cleanup
            URL.revokeObjectURL(url);
            window.recordingStream.getTracks().forEach((track) => track.stop());
            window.recordingStream = null;
            window.mediaRecorder = null;
          };

          window.mediaRecorder.start(1000);
        }
      },
    });

    // Update state
    isRecording = true;
    recordingStartTime = Date.now();
    await chrome.storage.local.set({ isRecording: true });
    await updateBadge("REC", "#ff0000");

    // Notify content script
    chrome.tabs
      .sendMessage(activeTab.id, {
        action: "recording-started",
        timestamp: recordingStartTime,
      })
      .catch(() => {
        // Content script might not be ready, ignore error
      });

    console.log("Recording started");
  } catch (error) {
    console.error("Failed to start recording:", error);
    throw error;
  }
}

// Stop recording function
async function stopRecording() {
  try {
    // Get current active tab
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (activeTab) {
      // Stop recording in content script
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          if (
            window.mediaRecorder &&
            window.mediaRecorder.state === "recording"
          ) {
            window.mediaRecorder.stop();
          }
        },
      });

      // Notify content script
      chrome.tabs
        .sendMessage(activeTab.id, {
          action: "recording-stopped",
        })
        .catch(() => {
          // Content script might not be ready, ignore error
        });
    }

    // Update state
    isRecording = false;
    recorder = null;
    stream = null;
    await chrome.storage.local.set({ isRecording: false });
    await updateBadge("", "#000000");

    console.log("Recording stopped");
  } catch (error) {
    console.error("Failed to stop recording:", error);
    throw error;
  }
}

// Save recording to downloads (handled in content script now)
async function saveRecording() {
  // This function is now handled in the content script
  // since the MediaRecorder runs there
  console.log("Recording save handled in content script");
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
      hasStream: !!stream,
    });
  } else if (request.action === "toggle-recording") {
    if (isRecording) {
      stopRecording().then(() => sendResponse({ success: true }));
    } else {
      startRecording().then(() => sendResponse({ success: true }));
    }
    return true; // Keep message channel open for async response
  }
});

// Clean up on extension shutdown
chrome.runtime.onSuspend.addListener(() => {
  if (isRecording && recorder) {
    recorder.stop();
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
});
