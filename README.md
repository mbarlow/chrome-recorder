# 📹 Chrome Tab Recorder Extension

A Chrome extension that allows you to record the active browser tab (with audio) using keyboard shortcuts and save recordings as WebM video files locally.

## ✨ Features

- 🎬 **One-click recording** of active browser tab with audio
- ⌨️ **Hotkey control** (`Ctrl+Shift+R` / `Cmd+Shift+R`)
- 🎨 **Visual recording indicator** with draggable positioning
- 💾 **Automatic local save** as WebM files
- 🎛️ **Clean popup interface** with recording timer
- 🌙 **Dark theme** with modern UI design

## 🗂️ Project Structure

```
tab-recorder-extension/
├── manifest.json          # Extension configuration (Manifest V3)
├── background.js          # Service worker for recording logic
├── popup.html            # Extension popup interface
├── popup.js              # Popup interaction logic
├── content.js            # Content script for visual indicators
├── icons/                # Extension icons (16, 32, 48, 128px)
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md             # This file
```

## 🚀 Installation

### Development Installation

1. **Clone or download** this project to your local machine
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer mode** (toggle in top-right corner)
4. **Click "Load unpacked"** and select the project folder
5. **Pin the extension** to your toolbar for easy access

### Icon Assets Required

Create the following icon files in the `icons/` directory:
- `icon-16.png` (16x16px)
- `icon-32.png` (32x32px)
- `icon-48.png` (48x48px)
- `icon-128.png` (128x128px)

## 🎮 Usage

### Starting/Stopping Recording

**Method 1: Keyboard Shortcut**
- Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- Press again to stop recording

**Method 2: Extension Popup**
- Click the extension icon in the toolbar
- Click "Start Recording" / "Stop Recording" button

**Method 3: Visual Indicator**
- Click the red "REC" indicator that appears during recording

### Recording Features

- **Auto-save**: Recordings automatically download to your default Downloads folder
- **Filename format**: `tab-recording-YYYY-MM-DDTHH-MM-SS.webm`
- **Audio capture**: Includes tab audio (music, videos, etc.)
- **Visual feedback**: Recording indicator with timer and pulse animation
- **Draggable indicator**: Move the recording indicator anywhere on screen

## 🔧 Technical Details

### Permissions Used

- `tabCapture` - Record active browser tab video and audio
- `downloads` - Save recorded files to local Downloads folder
- `storage` - Store recording state and preferences
- `activeTab` - Access current tab for recording

### Browser Compatibility

- **Chrome**: v88+ (Manifest V3 support required)
- **Edge**: v88+ (Chromium-based)
- **Audio**: Captures tab audio including media playback

### File Format

- **Video codec**: VP9
- **Audio codec**: Opus
- **Container**: WebM
- **Quality**: Adaptive based on tab content

## 🛠️ Development

### Local Development Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd tab-recorder-extension

# Load in Chrome
# 1. Open chrome://extensions/
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select this directory
```

### Code Architecture

**Service Worker (`background.js`)**
- Handles MediaRecorder API and tab capture
- Manages recording state and file downloads
- Processes keyboard shortcuts

**Content Script (`content.js`)**
- Injects visual recording indicator
- Provides user feedback during recording
- Handles indicator interactions

**Popup Interface (`popup.html` + `popup.js`)**
- Manual recording controls
- Real-time status display with timer
- Modern dark-themed UI

### Error Handling

- **Stream capture failures**: Graceful degradation with user notification
- **Permission issues**: Clear error messages and retry options
- **State recovery**: Handles browser restart during recording

## 🧪 Testing Scenarios

| Scenario | Expected Behavior |
|----------|------------------|
| Press hotkey on video tab | Starts recording with audio |
| Press hotkey again | Stops recording, downloads WebM |
| Close tab during recording | Auto-stops recording, saves file |
| Multiple tabs open | Records only the active tab |
| Audio-only tab | Records audio with black video |
| Browser restart | Resets recording state |

## 🔄 Future Enhancements

- [ ] **Screen recording** (entire screen vs tab only)
- [ ] **MP4 export** option with ffmpeg integration
- [ ] **Cloud upload** to Google Drive or Dropbox
- [ ] **Recording scheduling** with start/stop times
- [ ] **Webcam overlay** for picture-in-picture
- [ ] **Real-time streaming** to RTMP servers
- [ ] **Settings page** for custom hotkeys and quality options

## 🐛 Troubleshooting

**Recording not starting:**
- Ensure tab has media content playing
- Check Chrome permissions in settings
- Verify extension is enabled and updated

**No audio in recording:**
- Confirm tab audio is unmuted
- Check system audio output is working
- Some tabs may block audio capture

**Files not downloading:**
- Check Chrome download permissions
- Verify Downloads folder has write access
- Clear browser storage if issues persist

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly in Chrome
5. Submit a pull request

---

**Note**: This extension requires Chrome 88+ with Manifest V3 support. Tab audio capture may be limited by the source tab's audio policy.
