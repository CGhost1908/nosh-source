# 🏗️ Nosh Desktop - Technical Architecture & Project Overview

## 1. System Architecture
Nosh is architected as an **Electron multi-process desktop application** that leverages Node.js integration in the renderer alongside strict IPC boundaries and a standalone local Express callback server.

```
┌─────────────────────────────────────────────────────────────┐
│                    Operating System (Win / Mac / Linux)     │
└──────────────┬────────────────────────────────┬─────────────┘
               │                                │
┌──────────────▼────────────────┐    ┌──────────▼─────────────┐
│    Electron Main Process      │    │  Local Express Server  │
│    (main.js)                  │    │  (Port 2222)           │
│  - Window Lifecycle & Splash  │    │  - /callback (Spotify) │
│  - Native Dialogs & Shell     │    │  - /drive-callback     │
│  - GitHub API Uploads         │    └──────────▲─────────────┘
└──────────────▲────────────────┘               │ (Tokens)
               │ (IPC invoke / send)            │
┌──────────────▼────────────────────────────────┴─────────────┐
│                   Electron Renderer Window                  │
│                   (index.html, dark.css)                    │
│  ┌───────────────────────┐  ┌────────────────────────────┐  │
│  │   UI & Navigation     │  │   Document & Code Engine   │  │
│  │  - Sidebar & Saves    │  │  - ContentEditable Paper   │  │
│  │  - Search & Sorting   │  │  - CodeMirror 5 (18 Modes) │  │
│  │  - Context Menus      │  │  - Rich Text Formatting    │  │
│  │  - Settings & Modals  │  │  - Interact.js Resizing    │  │
│  └───────────────────────┘  └────────────────────────────┘  │
│  ┌───────────────────────┐  ┌────────────────────────────┐  │
│  │   External Services   │  │   Persistence Layer        │  │
│  │  - Google Drive Sync  │  │  - Local .nsh Files (Disk) │  │
│  │  - Spotify Companion  │  │  - localStorage Settings  │  │
│  │  - GitHub Pages Web   │  │  - html2pdf Export         │  │
│  └───────────────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Directory & Module Map

| File / Directory | Layer | Purpose & Responsibilities |
| :--- | :--- | :--- |
| `main.js` | Main | Lifecycle management, frameless window, native file dialogs, OAuth server listeners. |
| `index.html` | Presentation | Single unified window header, sidebar, editor scroll view, modal dialogs. |
| `dark.css` | Styling | Production design system: CSS variables, Obsidian/Linear dark palette, typography. |
| `requirements.js` | Core | CodeMirror mode registrations, Sublime keymaps, global state, welcome dashboard template. |
| `save.js` | Data | File reading, note indexing, path traversal sanitization, Sortable.js drag-and-drop. |
| `script.js` | Controller | Window controls, debounced auto-save, PDF export, core keyboard shortcuts. |
| `code_block.js` | Editor | Multi-language code block factory, mac-dots header, live CodeMirror lifecycle, copy/delete. |
| `search.js` | Search | Real-time note filtering by title with clear button and empty states. |
| `imageVideo.js` | Media | Image and video insertion modal with interact.js drag resizing. |
| `drive.js` | Cloud | Google Drive OAuth2 integration, folder initialization, upload, diff and import. |
| `spotify.js` | Companion | Spotify Web API client, currently playing track polling, playback & volume controls. |
| `share.js` | Publishing | Standalone HTML generation, GitHub Contents API upload, live webview preview in settings. |
| `settings.js` | Config | Tabbed modal manager, font size persistence, integration connection status. |
| `rightClick.js` | UX | Context menu for sidebar notes (rename, duplicate, open folder, delete). |
| `view.css` | Web | CSS bundle served to standalone published notes on GitHub Pages. |
| `loading.html` | Presentation | Frameless splash card with pulsing logo during cold startup. |
| `playwright-test.js` | QA | Interactive E2E Playwright test suite for Electron. |
| `test-app.js` | QA | Headless integration test suite covering 14 user flows. |

---

## 3. IPC Communication Channels

| Channel Name | Direction | Payload | Purpose |
| :--- | :--- | :--- | :--- |
| `minimize` | Renderer → Main | None | Minimizes application window |
| `maximize` | Renderer → Main | None | Toggles window maximization |
| `is-maximized` | Renderer → Main (Invoke) | None | Returns boolean state |
| `close` | Renderer → Main | None | Triggers close lifecycle check |
| `confirm-close` | Main → Renderer | None | Asks renderer to check unsaved changes |
| `proceed-close` | Renderer → Main | `boolean` | Destroys window cleanly |
| `open-external` | Renderer → Main (Invoke) | `url: string` | Safely opens link in default OS browser |
| `open-folder` | Renderer → Main (Invoke) | `path: string` | Opens directory in Explorer/Finder |
| `open-file-dialog` | Renderer → Main (Invoke) | None | Native OS open file dialog for `.nsh` |
| `save-file-dialog` | Renderer → Main (Invoke) | `defaultName, content` | Native OS save as dialog |
| `upload-to-github` | Renderer → Main | `fileContent, randomID...` | Uploads note to GitHub Pages repository |
| `github-upload-response` | Main → Renderer | `success, randomID, owner...` | Returns public URL receipt |
| `spotify-token` | Main → Renderer | `access_token, refresh_token` | Delivers OAuth tokens from port 2222 |
| `drive-token` | Main → Renderer | `access_token, refresh_token` | Delivers Drive OAuth tokens from port 2222 |

---

## 4. Technology Stack & Dependencies

- **Runtime**: Node.js v24.19.0, Electron 40.4.1
- **Code Editor Engine**: CodeMirror 5.65.18 (Sublime keymaps, closebrackets, show-hint, 18 syntax modes)
- **APIs & Services**: Google APIs (`googleapis`), Axios, Express 4.21.2
- **Testing**: Playwright 1.64.1 (`_electron.launch`)
- **UI Libraries**: Iconify 2.1.0, Sortable.js 1.15.2, Interact.js 1.10.27, html2pdf.js 0.10.1
