# 📝 Nosh Desktop - Feature-Packed Code & Note Editor

**Nosh** is a lightweight, Electron-powered desktop notepad and snippet organizer crafted specifically for programmers, engineers, and students. It bridges the gap between a simple scratchpad and a full IDE by combining multi-language syntax highlighting, Google Drive cloud synchronization, and native Spotify playback controls in one cohesive workspace.

---

## 🌟 Key Features

- **Multi-Language Code Blocks**: Integrated CodeMirror engine with syntax highlighting for C, C++, Java, JavaScript, Python, PHP, Ruby, Go, SQL, Shell, Markdown, YAML, Rust, Swift, and more.
- **Intelligent Autocomplete & Keymaps**: Includes bracket auto-closing, hints, and Sublime Text-style shortcuts.
- **Spotify Desktop Integration**:
  - Live now-playing track information (track name, artist, album artwork).
  - Play, pause, skip, and volume controls via circular radial slider.
  - Automatic token refresh flow.
- **Google Drive Cloud Sync**:
  - Automatic creation of dedicated `noshTheNotepad` Drive folder.
  - Backup, import, delete, and rename notes (`.nsh` files) directly to/from the cloud.
- **Dark Mode UI**: Sleek, modern dark-themed interface built for long coding and study sessions.
- **Customizable Context Menu**: Quick right-click shortcuts for formatting, snippet insertion, and file management.

---

## 🛠️ Tech Stack

- **Framework**: Electron (Main & Renderer IPC Architecture)
- **Editor Engine**: CodeMirror with language addons and autocomplete plugins
- **APIs & Integrations**:
  - Google Drive REST API (`googleapis`)
  - Spotify Web API
- **Styling**: Modern CSS3 (Custom Dark Theme, Iconify)
- **Utilities**: Node.js `fs`, `child_process`, `axios`

---

## 📁 Repository Structure

```text
nosh-source/
├── main.js             # Electron main process, window creation & IPC handlers
├── server.js           # Local authentication callback server for OAuth2
├── requirements.js     # CodeMirror modes, dependencies & configuration
├── script.js           # Core UI logic, editor actions & event dispatchers
├── code_block.js       # Code block generation, syntax highlighting & rendering
├── drive.js            # Google Drive OAuth2 & cloud file synchronization
├── spotify.js          # Spotify API client, playback status & UI controls
├── settings.js         # User preferences & configuration persistence
├── save.js             # Local file storage and note persistence
├── rightClick.js       # Custom contextual menu handlers
├── dark.css            # Dark theme stylesheet
├── index.html          # Main application window
└── package.json        # Dependencies & electron build scripts
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 16.x or higher
- npm or yarn

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/CGhost1908/nosh-source.git
   cd nosh-source
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **(Optional) Configure API Credentials:**
   If you plan to use Spotify and Google Drive integrations:
   - Provide your Spotify Client ID and Client Secret in `requirements.js`.
   - Provide your Google Drive OAuth2 Client ID and Client Secret in `drive.js`.

4. **Launch the application:**
   ```bash
   npm start
   ```

---

## 📜 Privacy & Policy

Nosh values user privacy. For information on how authentication tokens and note contents are handled, please review our [Privacy Policy](privacy-policy.md).

---

## 📄 License

This project is licensed under the MIT License.
