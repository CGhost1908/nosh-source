# 📊 Product Audit: Nosh Desktop

**Date**: November 2026  
**Auditor**: Lead Product Manager & UI/UX Specialist  
**Product**: Nosh Desktop v1.3.2+

---

## 1. Product Evaluation & Competitive Matrix

### A. Core Workflow Analysis
1. **Creation Workflow**:
   - *Current*: Click "New Note" or `Ctrl+N` → Generates `Untitled X` → Auto-selects in sidebar → Ready for typing.
   - *Assessment*: Fast and intuitive. Rating: **9/10**.
2. **Code Snippet Insertion**:
   - *Current*: Click Code Block icon → Modal opens → Search language (e.g., Python) → Inserts Mac-styled header with window dots and language badge → Focuses CodeMirror editor.
   - *Opportunity*: Once inserted, changing the language currently requires deleting and re-inserting the block. Adding an inline language picker directly on the header tag will elevate UX to **10/10**.
3. **Reading & Writing Experience**:
   - *Current*: Minimalist Obsidian-like dark paper, comfortable line-height (1.7), clean heading scale (H1-H4).
   - *Opportunity*: Missing live document analytics (word count, reading time) and interactive task lists.
4. **Cloud & Web Sharing**:
   - *Current*: Google Drive sync badge on sidebar cards; 1-click GitHub Pages publication with live webview preview in Settings.
   - *Assessment*: Outstanding differentiator compared to Obsidian and Notion.

---

## 2. Identified Product Opportunities (Ranked by User Value)

### 1. Document Analytics & Productivity Status Bar (High Value, High Polish)
- **User Story**: As a student or writer, I want to see my note's word count, character count, and estimated reading time at a glance.
- **Spec**: A discreet, 26px bottom status bar displaying:
  - `[Sync State]` (e.g. `Saved`, `Saving...`, `Unsaved`)
  - `X words | Y characters | ~Z min read`
  - `N code blocks`

### 2. In-Document Find & Replace Bar (High Value, Essential Workflow)
- **User Story**: As a developer reviewing a long note with scripts, I want to search and replace variable names or keywords without leaving the keyboard.
- **Spec**: Pressing `Ctrl+F` while the document has focus opens a sleek, floating dark toolbar in the top-right corner of the editor with search input, replace input, match counter (e.g., `1 of 4`), Next, Prev, and Replace All buttons.

### 3. Note Pinning ("Pin to Top") (High Value, Daily Organization)
- **User Story**: As an engineer with 30+ notes, I want to pin my daily scratchpad and API cheat sheet to the top of the sidebar.
- **Spec**: Pin icon on hover or right-click context menu "Pin Note". Pinned notes display a subtle accent pin badge and stay anchored above unpinned notes.

### 4. Interactive Task Lists / Checklists (High Value, Core Note Taking)
- **User Story**: As an engineer tracking sprint tasks or study items, I want interactive checklist items that toggle between completed (strikethrough) and pending.
- **Spec**: Toolbar button for Checklist. Creates `<div class="todo-item"><input type="checkbox"><span>Task</span></div>`. Toggling checkbox updates DOM state and marks document unsaved.

### 5. Markdown Interoperability (Export & Copy as Markdown) (High Value, Ecosystem Integration)
- **User Story**: As a developer, I want to draft notes in Nosh and export them as clean `.md` files or copy as formatted markdown for GitHub PR descriptions or Slack.
- **Spec**: 
  - "Export as Markdown" action in note dropdown.
  - "Copy as Markdown" in editor context menu.

### 6. In-App Note Renaming Modal (UX Polish)
- **User Story**: When I choose "Rename" from the context menu, I should get a sleek dark-themed in-app modal instead of a disruptive browser `prompt()`.

---

## 3. Product Scorecard Before vs. Target

| Metric | Baseline | Target Post-Evolution |
| :--- | :--- | :--- |
| **Visual Craft & Polish** | 8.5/10 | **9.8/10** |
| **Workflow Completeness** | 7.0/10 | **9.5/10** |
| **Code Block Ergonomics**| 8.0/10 | **9.5/10** |
| **Search & Navigation**   | 6.5/10 | **9.0/10** |
| **Data Interoperability** | 7.5/10 | **9.5/10** |
| **Test Reliability**     | 8.5/10 | **10.0/10** |
