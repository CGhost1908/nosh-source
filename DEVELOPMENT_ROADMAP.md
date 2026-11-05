# 🗺️ Nosh Desktop - Continuous Development Roadmap

## Legend
- 🟢 **DONE**: Implemented and verified by automated tests.
- 🟡 **IN PROGRESS**: Currently under active implementation.
- ⚪ **PLANNED**: Prioritized for next immediate sprint.

---

## Sprint 1: Reliability, Editor Polish & Productivity Fundamentals (COMPLETE)

| Task ID | Task Description | Priority | Status | Acceptance Criteria | Dependencies | Assigned Agent | Verification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TSK-01** | CodeMirror Auto-Save Synchronization | P0 | 🟢 DONE | CodeMirror `change` event triggers debounced auto-save timer when autoSave is enabled. | `code_block.js`, `script.js` | Backend Developer | `playwright-test.js` (Step 7) |
| **TSK-02** | Clean HTML Serialization on Save | P1 | 🟢 DONE | `saveFile()` strips out transient `.CodeMirror` internal DOM nodes so `.nsh` files stay clean on disk (90%+ size reduction). | `script.js`, `save.js` | Software Architect | Disk file inspect & reload test |
| **TSK-03** | In-App Sleek Rename Modal | P1 | 🟢 DONE | Replaces disruptive native `prompt()` in context menu with a dark theme modal matching design system. | `rightClick.js`, `index.html` | UI/UX Specialist | `test-app.js` (Step 6) |
| **TSK-04** | Document Status Bar (Words, Chars, Read Time) | P1 | 🟢 DONE | 26px footer bar with live word count, character count, estimated reading time, and sync status. | `index.html`, `dark.css`, `script.js` | Frontend Developer | Live assertion & dynamic updates |
| **TSK-05** | In-Document Find & Replace | P1 | 🟢 DONE | Floating dark bar with search input, replace input, match count, Next, Prev, and Replace All (`Ctrl+F` / `Ctrl+H` / `Escape`). | `index.html`, `dark.css`, `script.js` | Frontend Developer | `playwright-test.js` (Step 13) |
| **TSK-06** | Interactive Task Lists (Checklists) | P2 | 🟢 DONE | Toolbar button and keyboard handling to insert checklist items with toggleable state and disk persistence. | `index.html`, `script.js`, `dark.css` | Frontend Developer | `playwright-test.js` (Step 11) |
| **TSK-07** | Note Pinning ("Pin to Top") | P2 | 🟢 DONE | Pin action in context menu and quick button; pinned notes stay fixed at top of sidebar across reboots. | `save.js`, `dark.css`, `rightClick.js` | Backend Developer | `playwright-test.js` (Step 12) |
| **TSK-08** | Markdown Export (`.md`) & Copy Markdown | P2 | 🟢 DONE | Convert current note HTML & CodeMirrors to clean GitHub Flavored Markdown for export (`export-file-dialog`) or clipboard. | `script.js`, `main.js` | Software Architect | `playwright-test.js` (Step 14) |
| **TSK-09** | In-Block Language Switcher Dropdown | P2 | 🟢 DONE | Clicking the language badge on a code block opens a quick switcher to change mode live without losing text. | `code_block.js`, `dark.css` | Frontend Developer | `playwright-test.js` (Step 10) |

---

## Sprint 2: UI Themes, Offline Full-Text Search & Vault Sovereignty (COMPLETE)

| Task ID | Task Description | Priority | Status | Acceptance Criteria | Dependencies | Assigned Agent | Verification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TSK-10** | App Theme Variants (Obsidian, OLED Black, Nord, Tokyo) | P1 | 🟢 DONE | User can toggle overall UI palette between Obsidian (default), Pure Black OLED, Nord Slate, and Tokyo Night with live apply & persistence. | `dark.css`, `settings.js`, `index.html` | UI/UX Specialist | `playwright-test.js` (Step 16) |
| **TSK-11** | Full-Text Note Content Search | P1 | 🟢 DONE | Search bar filters by both title and full-text note content with real-time excerpt snippets and `<mark>` highlights. | `search.js`, `dark.css` | Performance Engineer | `playwright-test.js` (Step 15) |
| **TSK-12** | Local Media Assets Directory | P2 | 🟢 DONE | Dropped, inserted, or clipboard-pasted images are saved to `Saves/assets/` with portable relative paths rather than bloating notes with inline Base64 data URLs. | `imageVideo.js`, `script.js`, `save.js` | Backend Developer | `playwright-test.js` (Step 18) |
| **TSK-13** | Note Trash / Recycle Bin with Safe Recovery & Manager UI | P2 | 🟢 DONE | Deleting a note moves it safely to `.trash/` with Preferences UI manager to view, restore, or empty trash permanently. | `save.js`, `settings.js`, `index.html` | Security Engineer | `playwright-test.js` (Step 17, 22) |
| **TSK-14** | Code Block Line Wrap Toggle | P3 | 🟢 DONE | Per-block `Wrap` button toggling CodeMirror `lineWrapping` live without horizontal scrolling. | `code_block.js`, `dark.css` | Frontend Developer | `playwright-test.js` (Step 20) |

---

## Sprint 3: Power User Workflows, Quick Switcher & Knowledge Architecture (COMPLETE)

| Task ID | Task Description | Priority | Status | Acceptance Criteria | Dependencies | Assigned Agent | Verification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TSK-15** | Quick Switcher / Command Palette (`Ctrl+P` / `Ctrl+K`) | P1 | 🟢 DONE | Keyboard-driven modal to fuzzy jump to any note or execute any application action with arrow keys and Enter. | `palette.js`, `index.html`, `dark.css` | Frontend Developer | `playwright-test.js` (Step 19) |
| **TSK-16** | Markdown Drag & Drop Import | P2 | 🟢 DONE | Dragging `.md`, `.txt`, `.html`, or `.nsh` files parses markdown, headings, checklists, and code blocks directly into active note. | `script.js` | Backend Developer | File drop integration |
| **TSK-17** | Native PDF Export Engine | P2 | 🟢 DONE | Native Electron `printToPDF` engine generating crisp vector documents with dark syntax highlighting preserved. | `main.js`, `script.js` | Backend Developer | IPC handler verification |
| **TSK-18** | Bidirectional Note Linking (`[[Note Title]]`) | P1 | 🟢 DONE | Wiki-link syntax that converts references into interactive tags; clicking opens or auto-creates target note; preserves syntax in Markdown. | `save.js`, `visual.js`, `script.js`, `dark.css` | Software Architect | `playwright-test.js` (Step 21) |
| **TSK-19** | Bidirectional Backlinks Engine & Popover | P1 | 🟢 DONE | Real-time discovery of incoming note references with status bar badge and interactive navigation popover. | `save.js`, `index.html`, `dark.css` | Software Architect | `playwright-test.js` (Step 23) |
| **TSK-20** | Engineering Note Templates | P2 | 🟢 DONE | Pre-configured scaffold cards (RFC System Design, Bug Postmortem, Meeting Notes, Daily Log, Algorithm Showcase). | `save.js`, `index.html`, `dark.css` | UI/UX Specialist | `playwright-test.js` (Step 24) |
| **TSK-21** | Modern Revised Left Panel Refinement | P0 | 🟢 DONE | Modernized sidebar with refined active state (fixed border issue), sleek search, and compact Spotify card. | `index.html`, `dark.css`, `visual.js`, `save.js` | UI/UX Specialist | `test-app.js` (14/14) & `playwright-test.js` (25/25) |

---

## Sprint 4: Visual Knowledge Graph, Outline, Focus Mode & Tag Taxonomy (COMPLETE)

| Task ID | Task Description | Priority | Status | Acceptance Criteria | Dependencies | Assigned Agent | Verification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TSK-22** | Visual Interactive Knowledge Graph View | P1 | 🟢 DONE | Canvas 2D force-directed node graph mapping vault links, drag & drop physics, pan/zoom, hover highlighting, search filtering, and node click navigation (`Ctrl+G`). | `graph.js`, `index.html`, `dark.css` | Frontend Developer | `playwright-test.js` (Step 25) |
| **TSK-23** | Document Table of Contents / Outline Drawer | P1 | 🟢 DONE | Slide-out outline drawer hierarchy extracted from `h1, h2, h3, h4`, with one-click smooth scroll and accent pulse animation (`Ctrl+Shift+O`). | `visual.js`, `index.html`, `dark.css` | UI/UX Specialist | `playwright-test.js` (Step 26) |
| **TSK-24** | Distraction-Free Focus / Zen Mode | P2 | 🟢 DONE | Clean fullscreen writing experience collapsing toolbars and sidebars with spacious centered typography and hover exit pill (`Ctrl+Shift+F` / `F11` / `Escape`). | `visual.js`, `dark.css`, `index.html` | UI/UX Specialist | `playwright-test.js` (Step 27) |
| **TSK-25** | Vault Tag Taxonomy & Quick Filter (`#tags`) | P2 | 🟢 DONE | Automatic extraction of `#hashtags` from notes, rendered as clickable filter chips in sidebar with instant multi-facet search combination. | `search.js`, `save.js`, `dark.css` | Software Architect | `playwright-test.js` (Step 28) |

---

## Sprint 5: Future Horizons & Cloud Extensibility (PLANNED)

| Task ID | Task Description | Priority | Status | Acceptance Criteria | Dependencies | Assigned Agent |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TSK-26** | End-to-End Vault Passphrase Encryption | P2 | ⚪ PLANNED | Optional AES-GCM 256-bit passphrase protection for confidential local vaults and single-note lock. | `crypto`, `save.js` | Security Engineer |
| **TSK-27** | Split-Screen Editor & Markdown Live Preview | P2 | ⚪ PLANNED | Side-by-side editing view with real-time markdown preview rendering. | `script.js`, `dark.css` | Frontend Developer |
| **TSK-28** | Daily Journal Auto-Scaffolder | P3 | ⚪ PLANNED | Calendar-aware daily note generator with quick jump hotkeys (`Alt+D`). | `save.js`, `palette.js` | Frontend Developer |
