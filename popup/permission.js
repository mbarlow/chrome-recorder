// One-time camera-grant page. The action popup closes the instant Chrome's
// permission chip takes focus, which rejects getUserMedia — so we request it
// here in a real window that survives focus loss. The grant persists for the
// extension origin, which the headless offscreen document then reuses.
const msg = document.getElementById("msg");

(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    stream.getTracks().forEach((t) => t.stop()); // only needed the grant
    msg.textContent = "✓ Camera enabled. This window will close.";
    // Record the grant so the popup stops routing back here, and enable the
    // overlay now that the camera is usable.
    await chrome.storage.local.set({ cameraGranted: true });
    chrome.runtime.sendMessage({ action: "set-webcam-enabled", enabled: true });
    setTimeout(() => window.close(), 1200);
  } catch (e) {
    msg.textContent =
      "Camera access was blocked. Allow it for this extension, then try the toggle again.";
  }
})();
