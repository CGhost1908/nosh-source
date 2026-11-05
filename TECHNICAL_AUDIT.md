# 🔍 Technical Audit Report: Nosh Desktop

**Date**: November 2026  
**Auditor**: Lead Architect & QA Engineering Lead  
**Scope**: Codebase integrity, runtime errors, state management, security boundaries, performance bottlenecks, dependencies, and test coverage.

---

## 1. Executive Summary
Following the complete initial redesign of the UI and topbar unification, Nosh has achieved a solid baseline: 14/14 automated integration tests pass, and 10/10 Playwright E2E interactive steps pass. However, an in-depth code audit reveals several critical technical debt items, state edge cases, and performance opportunities that must be addressed to reach production excellence.

---

## 2. Findings by Category

### A. Critical Technical Debt & Edge Cases
1. **HTML File Format vs. CodeMirror DOM Bloat**:
   - *Issue*: `saveFile()` writes `content.innerHTML` directly to disk. Although `processCodeBlock()` was hardened to strip stale `.CodeMirror` elements on load, raw `.nsh` files still store the entire transient CodeMirror DOM tree (up to 300 extra lines of HTML per code block).
   - *Impact*: Files are 5-10x larger on disk than necessary; opening large notes causes unnecessary HTML parsing overhead.
   - *Recommendation*: Clean the saved HTML before writing to disk by sanitizing out internal `.CodeMirror` wrappers, retaining only `<textarea class="code" ...>` with current code text.
2. **Sidebar Context Menu `prompt()` Native Freeze**:
   - *Issue*: In `rightClick.js` (line 51), note renaming uses the browser's native `prompt('Enter new note name:', contextTargetNote)`.
   - *Impact*: In a frameless dark mode Electron application, `prompt()` triggers a synchronous Win32 dialog that blocks the renderer process and breaks the dark theme aesthetic.
   - *Recommendation*: Replace `prompt()` with an in-app sleek modal or inline input inside `#saves-container`.
3. **In-Document Find & Replace Missing**:
   - *Issue*: `Ctrl+F` currently only focuses the sidebar note title filter. There is no in-editor search for text or code snippets inside the open document.
   - *Impact*: Engineers working with long notes cannot locate terms or replace variable names easily.
   - *Recommendation*: Implement an in-editor floating Find & Replace bar with match count, Next, Previous, and Replace All.

### B. State Management & Reliability
1. **Unsaved Indicator Synchronicity on Code Change**:
   - *Issue*: In `code_block.js`, when a user types into a CodeMirror editor, `cm.on('change', ...)` flags `hasUnsavedChanges = true` and updates `textarea.value`. However, if auto-save is enabled (`localStorage.getItem('autoSave') === 'true'`), the debounced auto-save timer is only triggered on `#content.addEventListener('input')`, which does NOT fire for CodeMirror keystrokes!
   - *Impact*: Changes typed exclusively inside code blocks are not auto-saved unless the user also types in the main rich text area.
   - *Recommendation*: Route `cm.on('change')` through the central debounced auto-save trigger function.
2. **Note Pinning & Categorization**:
   - *Issue*: Notes are strictly sorted by manual drag-and-drop or alphabetical order. Users cannot pin critical reference notes (e.g., Cheat Sheets, Daily Tasks) to the top.
   - *Impact*: In workspaces with 20+ notes, frequently used notes are lost in the scroll list.
   - *Recommendation*: Introduce a `pinnedNotes` array in `localStorage` and a pin toggle on the note card & context menu.

### C. Security & Boundaries
1. **Content Security Policy (CSP)**:
   - *Issue*: A warning was logged: `Electron Security Warning (Insecure Content-Security-Policy)`. While a CSP meta tag was added in `index.html`, inline script evaluation warnings still occur in dev mode due to CodeMirror and external CDN icon bundles.
   - *Impact*: Potential XSS vector if untrusted HTML is pasted into a note.
   - *Recommendation*: Consolidate CSP directives; ensure strict origin handling.
2. **Path Traversal Protection**:
   - *Status*: Verified. `path.basename()` is utilized across `save.js`, `main.js`, and `drive.js` preventing directory traversal (`../../`).
3. **Local Express OAuth Server Binding**:
   - *Status*: Verified. Express is bound to `127.0.0.1` and handles only `/callback` and `/drive-callback`.

### D. Performance & UX Bottlenecks
1. **Missing Document Analytics Status Bar**:
   - *Issue*: No word count, character count, or estimated reading time is displayed to the user.
   - *Impact*: Users taking study or technical documentation notes have no feedback on note length.
   - *Recommendation*: Add a minimalist, zero-latency footer status bar displaying words, characters, read time, and active sync status.
2. **Checklist / Task List Support**:
   - *Issue*: Only ordered (`<ol>`) and unordered (`<ul>`) lists exist. Developers frequently need interactive checkboxes (`- [ ] / - [x]`) for sprint tasks.
   - *Recommendation*: Add an interactive checklist action to the editor toolbar.

---

## 3. Summary of Action Items
| ID | Title | Priority | Complexity | Risk |
| :--- | :--- | :--- | :--- | :--- |
| **AUD-01** | Connect CodeMirror changes to debounced Auto-Save | P0 | Low | Low |
| **AUD-02** | Sanitize CodeMirror DOM tree during `saveFile()` | P1 | Medium | Medium |
| **AUD-03** | Replace native `prompt()` rename with Sleek Rename Modal | P1 | Low | Low |
| **AUD-04** | Build In-Document Find & Replace bar (`Ctrl+F` in doc) | P1 | Medium | Low |
| **AUD-05** | Add Word, Character, and Read Time Status Bar | P1 | Low | Low |
| **AUD-06** | Add Note Pinning (`Pin to Top`) feature | P2 | Medium | Low |
| **AUD-07** | Add Interactive Checklist / Task List support | P2 | Medium | Low |
| **AUD-08** | Add Markdown Export (`.md`) and Copy as Markdown | P2 | Medium | Low |
| **AUD-09** | Add in-block Language Switcher dropdown | P2 | Medium | Low |
