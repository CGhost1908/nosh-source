// Unified Interactive Undo / Redo Engine for Nosh Editor & CodeMirror Blocks
// =========================================================================

(function (global) {
    'use strict';

    const MAX_UNDO_STEPS = 150;
    const TYPING_BURST_DEBOUNCE_MS = 650;
    const TRANSIENT_SELECTOR = '.CodeMirror, .media-toolbar, .media-resize-handle, .table-col-resizer, .block-drag-handle, .media-drag-handle';

    const noteStates = new Map();

    let isApplyingUndoRedo = false;
    let suspendDepth = 0;
    let txDepth = 0;
    let txBeforeState = null;
    let pendingBurst = null;
    let pendingCmDiscrete = null;
    let pendingExternalRestore = null;
    let isComposing = false;
    let listenersAttached = false;

    function getEditorEl() {
        return (typeof content !== 'undefined' && content) ? content : document.getElementById('content');
    }

    function getActiveNoteKey() {
        return (typeof activeNoteName !== 'undefined' && activeNoteName) ? String(activeNoteName) : null;
    }

    function isTransientElement(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        return Boolean(
            node.classList.contains('CodeMirror') ||
            node.classList.contains('media-toolbar') ||
            node.classList.contains('media-resize-handle') ||
            node.classList.contains('table-col-resizer') ||
            node.classList.contains('block-drag-handle') ||
            node.classList.contains('media-drag-handle')
        );
    }

    function ensureNoteState(noteKey) {
        if (!noteKey) return null;
        let state = noteStates.get(noteKey);
        if (!state) {
            state = {
                undoStack: [],
                redoStack: [],
                committedState: null,
                lastSavedHtml: null
            };
            noteStates.set(noteKey, state);
        }
        return state;
    }

    function getSafeCleanHTML() {
        const editorEl = getEditorEl();
        if (!editorEl) return '';
        if (typeof getCleanContentHTML === 'function') {
            return getCleanContentHTML();
        }
        return editorEl.innerHTML;
    }

    // Walk up from node to nearest non-transient Element inside root
    function getNonTransientHostElement(node, root) {
        let cur = node;
        while (cur && cur !== root) {
            if (cur.nodeType === Node.ELEMENT_NODE && !isTransientElement(cur)) {
                // Make sure no ancestor between cur and root is transient
                let blocked = false;
                let check = cur.parentElement;
                while (check && check !== root) {
                    if (isTransientElement(check)) {
                        blocked = true;
                        break;
                    }
                    check = check.parentElement;
                }
                if (!blocked) return cur;
            }
            cur = cur.parentNode;
        }
        return root;
    }

    function getCleanElementPath(targetEl, root) {
        const path = [];
        let cur = targetEl;
        while (cur && cur !== root) {
            const parent = cur.parentElement;
            if (!parent) return null;
            const cleanChildren = Array.from(parent.children).filter(ch => !isTransientElement(ch));
            const idx = cleanChildren.indexOf(cur);
            if (idx === -1) return null;
            path.unshift(idx);
            cur = parent;
        }
        return cur === root ? path : null;
    }

    function resolveCleanElementPath(path, root) {
        if (!root || !Array.isArray(path)) return null;
        let cur = root;
        for (let i = 0; i < path.length; i++) {
            const cleanChildren = Array.from(cur.children).filter(ch => !isTransientElement(ch));
            if (path[i] < 0 || path[i] >= cleanChildren.length) {
                return null;
            }
            cur = cleanChildren[path[i]];
        }
        return cur;
    }

    // Count characters inside hostEl before (targetNode, targetOffset), ignoring transient subtrees
    function countCharOffsetBeforePoint(hostEl, targetNode, targetOffset) {
        let count = 0;
        let found = false;

        function walk(node) {
            if (found || !node) return;
            if (node !== hostEl && isTransientElement(node)) return;

            if (node === targetNode) {
                if (node.nodeType === Node.TEXT_NODE) {
                    count += Math.min(targetOffset, node.nodeValue.length);
                    found = true;
                    return;
                }
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const children = node.childNodes;
                    const limit = Math.min(targetOffset, children.length);
                    for (let i = 0; i < limit; i++) {
                        walkAll(children[i]);
                    }
                    found = true;
                    return;
                }
            }

            if (node.nodeType === Node.TEXT_NODE) {
                count += node.nodeValue.length;
                return;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                const children = node.childNodes;
                for (let i = 0; i < children.length; i++) {
                    if (found) break;
                    walk(children[i]);
                }
            }
        }

        function walkAll(node) {
            if (!node) return;
            if (isTransientElement(node)) return;
            if (node.nodeType === Node.TEXT_NODE) {
                count += node.nodeValue.length;
                return;
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
                for (let i = 0; i < node.childNodes.length; i++) {
                    walkAll(node.childNodes[i]);
                }
            }
        }

        walk(hostEl);
        return count;
    }

    function encodeDomPoint(container, offset, root) {
        if (!root || !container || !root.contains(container)) return null;
        if (container === root && offset >= root.childNodes.length) {
            return { elPath: [], charOffset: 0, atRootEnd: true };
        }
        const hostEl = getNonTransientHostElement(container, root);
        const elPath = getCleanElementPath(hostEl, root);
        if (!elPath) return null;
        const charOffset = countCharOffsetBeforePoint(hostEl, container, offset);
        return { elPath, charOffset, atRootEnd: false };
    }

    function resolveDomPoint(encoded, root) {
        if (!encoded || !root) return null;
        if (encoded.atRootEnd) {
            return { node: root, offset: root.childNodes.length };
        }
        const hostEl = resolveCleanElementPath(encoded.elPath, root);
        if (!hostEl) return null;

        let targetOffset = Math.max(0, encoded.charOffset || 0);
        const textNodes = [];

        function collectText(node) {
            if (!node) return;
            if (node !== hostEl && isTransientElement(node)) return;
            if (node.nodeType === Node.TEXT_NODE) {
                textNodes.push(node);
                return;
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
                for (let i = 0; i < node.childNodes.length; i++) {
                    collectText(node.childNodes[i]);
                }
            }
        }
        collectText(hostEl);

        if (textNodes.length === 0) {
            return { node: hostEl, offset: 0 };
        }

        let remaining = targetOffset;
        for (let i = 0; i < textNodes.length; i++) {
            const tn = textNodes[i];
            const len = tn.nodeValue.length;
            if (remaining <= len) {
                return { node: tn, offset: remaining };
            }
            remaining -= len;
        }

        const last = textNodes[textNodes.length - 1];
        return { node: last, offset: last.nodeValue.length };
    }

    function getCmBlockIndex(wrapper) {
        const editorEl = getEditorEl();
        if (!editorEl || !wrapper) return -1;
        const wrappers = Array.from(editorEl.querySelectorAll('.code-block-wrapper'));
        return wrappers.indexOf(wrapper);
    }

    function captureEditorSelection() {
        const editorEl = getEditorEl();
        if (!editorEl) return null;

        const activeEl = document.activeElement;
        if (activeEl && activeEl.matches && activeEl.matches('input.checklist-checkbox') && editorEl.contains(activeEl)) {
            const path = getCleanElementPath(activeEl, editorEl);
            if (path) {
                return { kind: 'element', path };
            }
        }

        const cmEl = activeEl && activeEl.closest ? activeEl.closest('.CodeMirror') : null;
        if (cmEl && cmEl.CodeMirror && editorEl.contains(cmEl)) {
            const wrapper = cmEl.closest('.code-block-wrapper');
            const blockIndex = getCmBlockIndex(wrapper);
            if (blockIndex !== -1) {
                const cm = cmEl.CodeMirror;
                return {
                    kind: 'cm',
                    blockIndex,
                    anchor: { line: cm.getCursor('anchor').line, ch: cm.getCursor('anchor').ch },
                    head: { line: cm.getCursor('head').line, ch: cm.getCursor('head').ch }
                };
            }
        }

        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (editorEl.contains(range.startContainer) && editorEl.contains(range.endContainer)) {
                const start = encodeDomPoint(range.startContainer, range.startOffset, editorEl);
                const end = encodeDomPoint(range.endContainer, range.endOffset, editorEl);
                if (start && end) {
                    return { kind: 'dom', start, end };
                }
            }
        }

        return null;
    }

    function clampCmPos(cm, pos) {
        const maxLine = Math.max(0, cm.lineCount() - 1);
        const line = Math.max(0, Math.min(maxLine, pos ? pos.line : 0));
        const lineText = cm.getLine(line) || '';
        const ch = Math.max(0, Math.min(lineText.length, pos ? pos.ch : 0));
        return { line, ch };
    }

    function focusElementSafe(el) {
        if (!el || typeof el.focus !== 'function') return;
        try {
            el.focus({ preventScroll: true });
        } catch (_) {
            el.focus();
        }
    }

    function restoreEditorSelection(selState) {
        const editorEl = getEditorEl();
        if (!editorEl) return;

        if (!selState) {
            focusElementSafe(editorEl);
            return;
        }

        if (selState.kind === 'cm') {
            const wrappers = editorEl.querySelectorAll('.code-block-wrapper');
            const wrapper = wrappers[selState.blockIndex];
            const cmEl = wrapper ? wrapper.querySelector('.CodeMirror') : null;
            if (cmEl && cmEl.CodeMirror) {
                const cm = cmEl.CodeMirror;
                cm.focus();
                const anchor = clampCmPos(cm, selState.anchor);
                const head = clampCmPos(cm, selState.head);
                cm.setSelection(anchor, head, { origin: '+undo-restore', scroll: false });
                return;
            }
        }

        if (selState.kind === 'element' && Array.isArray(selState.path)) {
            const targetEl = resolveCleanElementPath(selState.path, editorEl);
            if (targetEl) {
                focusElementSafe(targetEl);
                return;
            }
        }

        if (selState.kind === 'dom') {
            const startPt = resolveDomPoint(selState.start, editorEl);
            const endPt = resolveDomPoint(selState.end, editorEl);
            if (startPt && endPt) {
                try {
                    const startEl = startPt.node.nodeType === Node.ELEMENT_NODE ? startPt.node : startPt.node.parentElement;
                    const ceHost = (startEl && startEl.closest('[contenteditable="true"]')) || editorEl;
                    focusElementSafe(ceHost);

                    const range = document.createRange();
                    range.setStart(startPt.node, startPt.offset);
                    range.setEnd(endPt.node, endPt.offset);
                    const sel = window.getSelection();
                    if (sel) {
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                    return;
                } catch (_) {}
            }
        }

        // Fallback: place caret cleanly inside body block or firstH1
        focusElementSafe(editorEl);
        const fallbackEl = editorEl.querySelector('p, h1, h2, h3, .checklist-text');
        if (fallbackEl && typeof placeCaretInElement === 'function') {
            placeCaretInElement(fallbackEl, false);
        }
    }

    function captureState() {
        return {
            html: getSafeCleanHTML(),
            selection: captureEditorSelection()
        };
    }

    function readCmWrapperSnapshot(wrapper) {
        const textarea = wrapper ? wrapper.querySelector('textarea.code') : null;
        const cmEl = wrapper ? wrapper.querySelector('.CodeMirror') : null;
        const cm = cmEl && cmEl.CodeMirror ? cmEl.CodeMirror : null;
        return {
            blockIndex: getCmBlockIndex(wrapper),
            code: cm ? cm.getValue() : (textarea ? (textarea.value || textarea.textContent || '') : ''),
            mode: textarea ? (textarea.getAttribute('language') || 'javascript') : 'javascript',
            label: textarea ? (textarea.getAttribute('data-label') || 'JavaScript') : 'JavaScript',
            manual: wrapper ? wrapper.getAttribute('data-manual-lang') : null
        };
    }

    function buildCmMeta(beforeWrap, afterWrap) {
        if (!beforeWrap || !afterWrap || beforeWrap.blockIndex < 0 || beforeWrap.blockIndex !== afterWrap.blockIndex) {
            return null;
        }
        return {
            blockIndex: afterWrap.blockIndex,
            beforeCode: beforeWrap.code,
            afterCode: afterWrap.code,
            beforeMode: beforeWrap.mode,
            afterMode: afterWrap.mode,
            beforeLabel: beforeWrap.label,
            afterLabel: afterWrap.label,
            beforeManual: beforeWrap.manual,
            afterManual: afterWrap.manual
        };
    }

    function pushEntry(noteKey, entry) {
        if (!noteKey || !entry || !entry.before || !entry.after) return false;
        if (entry.before.html === entry.after.html) return false;

        const state = ensureNoteState(noteKey);
        state.undoStack.push(entry);
        if (state.undoStack.length > MAX_UNDO_STEPS) {
            state.undoStack.shift();
        }
        state.redoStack.length = 0;
        state.committedState = {
            html: entry.after.html,
            selection: entry.after.selection
        };
        updateUndoRedoButtons();
        return true;
    }

    function clearPendingBurstState() {
        if (pendingBurst && pendingBurst.timer) {
            clearTimeout(pendingBurst.timer);
        }
        pendingBurst = null;
        pendingCmDiscrete = null;
    }

    function flushPendingTyping() {
        if (!pendingBurst) return;
        const burst = pendingBurst;
        clearPendingBurstState();

        const noteKey = getActiveNoteKey();
        if (!noteKey || burst.noteKey !== noteKey) return;

        const afterState = captureState();
        let cmMeta = null;
        if (burst.cmWrapper && burst.cmBeforeSnap && burst.cmWrapper.isConnected) {
            const afterWrap = readCmWrapperSnapshot(burst.cmWrapper);
            cmMeta = buildCmMeta(burst.cmBeforeSnap, afterWrap);
        }

        pushEntry(noteKey, {
            before: burst.before,
            after: afterState,
            cmMeta
        });
    }

    function scheduleBurstCommit() {
        if (!pendingBurst) return;
        if (pendingBurst.timer) {
            clearTimeout(pendingBurst.timer);
        }
        pendingBurst.timer = setTimeout(() => {
            flushPendingTyping();
        }, TYPING_BURST_DEBOUNCE_MS);
    }

    function getBaselineBeforeState(noteKey) {
        const state = ensureNoteState(noteKey);
        if (state && state.committedState) {
            return {
                html: state.committedState.html,
                selection: captureEditorSelection() || state.committedState.selection
            };
        }
        return captureState();
    }

    function beginTransaction() {
        const noteKey = getActiveNoteKey();
        if (!noteKey || isApplyingUndoRedo || suspendDepth > 0) {
            return { commit: () => {}, cancel: () => {} };
        }

        txDepth++;
        if (txDepth === 1) {
            flushPendingTyping();
            txBeforeState = {
                noteKey,
                state: captureState()
            };
        }

        let finished = false;
        return {
            commit: () => {
                if (finished) return false;
                finished = true;
                if (txDepth <= 0) return false;
                txDepth--;
                if (txDepth > 0) return false;

                const start = txBeforeState;
                txBeforeState = null;
                const currentNoteKey = getActiveNoteKey();
                if (!start || !currentNoteKey || start.noteKey !== currentNoteKey) return false;

                const afterState = captureState();
                return pushEntry(currentNoteKey, {
                    before: start.state,
                    after: afterState
                });
            },
            cancel: () => {
                if (finished) return;
                finished = true;
                if (txDepth > 0) txDepth--;
                if (txDepth === 0) {
                    txBeforeState = null;
                }
            }
        };
    }

    function runWithUndo(fn) {
        const tx = beginTransaction();
        let failed = false;
        try {
            return fn();
        } catch (err) {
            failed = true;
            tx.cancel();
            throw err;
        } finally {
            if (!failed) {
                tx.commit();
            }
        }
    }

    function peekCommittedState() {
        const noteKey = getActiveNoteKey();
        if (!noteKey) return null;
        flushPendingTyping();
        const state = ensureNoteState(noteKey);
        if (state && state.committedState) {
            return {
                html: state.committedState.html,
                selection: captureEditorSelection() || state.committedState.selection
            };
        }
        return captureState();
    }

    function commitFromBaseline(beforeState) {
        const noteKey = getActiveNoteKey();
        if (!noteKey || !beforeState || isApplyingUndoRedo || suspendDepth > 0) return false;
        clearPendingBurstState();
        const afterState = captureState();
        return pushEntry(noteKey, {
            before: beforeState,
            after: afterState
        });
    }

    function tryFastCodeMirrorPatch(entry, direction, oppositeState) {
        const editorEl = getEditorEl();
        const meta = entry && entry.cmMeta;
        if (!editorEl || !meta || meta.beforeMode !== meta.afterMode) return false;

        const noteKey = getActiveNoteKey();
        const noteState = ensureNoteState(noteKey);
        if (!noteState || !noteState.committedState || noteState.committedState.html !== oppositeState.html) {
            return false;
        }

        const wrappers = editorEl.querySelectorAll('.code-block-wrapper');
        const wrapper = wrappers[meta.blockIndex];
        if (!wrapper) return false;

        const cmEl = wrapper.querySelector('.CodeMirror');
        const textarea = wrapper.querySelector('textarea.code');
        const cm = cmEl && cmEl.CodeMirror ? cmEl.CodeMirror : null;
        if (!cm || !textarea) return false;

        const targetCode = direction === 'undo' ? meta.beforeCode : meta.afterCode;
        const targetMode = direction === 'undo' ? meta.beforeMode : meta.afterMode;
        const targetLabel = direction === 'undo' ? meta.beforeLabel : meta.afterLabel;
        const targetManual = direction === 'undo' ? meta.beforeManual : meta.afterManual;

        if (cm.getValue() !== targetCode) {
            cm.setValue(targetCode);
        }
        textarea.value = targetCode;
        textarea.textContent = targetCode;
        textarea.setAttribute('language', targetMode);
        textarea.setAttribute('data-label', targetLabel);

        if (targetManual) {
            wrapper.setAttribute('data-manual-lang', targetManual);
        } else {
            wrapper.removeAttribute('data-manual-lang');
        }

        if (cm.getOption('mode') !== targetMode) {
            cm.setOption('mode', targetMode);
        }

        const tag = wrapper.querySelector('.code-lang-tag');
        const langName = tag ? tag.querySelector('.lang-name') : null;
        if (langName) langName.textContent = targetLabel;

        cm.refresh();
        return true;
    }

    function hydrateRestoredContent(editorEl) {
        if (typeof processCodeBlock === 'function') {
            processCodeBlock();
        }
        if (typeof processChecklists === 'function') {
            processChecklists();
        }
        if (typeof processLoadedMedia === 'function') {
            processLoadedMedia();
        }
        if (typeof processInternalLinks === 'function') {
            processInternalLinks(editorEl, { bindingsOnly: true });
        }
        if (typeof processMathFormulas === 'function') {
            processMathFormulas(editorEl, { renderExistingOnly: true });
        }
        if (typeof processTables === 'function') {
            processTables(editorEl);
        }
    }

    function syncAfterRestoreUI(noteState, restoredHtml) {
        const editorEl = getEditorEl();
        const noteKey = getActiveNoteKey();

        // Check live H1 title vs activeNoteName
        const firstH1 = editorEl ? editorEl.firstElementChild : null;
        if (firstH1 && firstH1.tagName === 'H1') {
            const rawTitle = firstH1.textContent || '';
            const cleanPreview = typeof sanitizeNoteTitleToFileName === 'function'
                ? sanitizeNoteTitleToFileName(rawTitle)
                : rawTitle.trim();
            if (typeof updateLiveNoteTitleUI === 'function') {
                updateLiveNoteTitleUI(cleanPreview || noteKey);
            }
            if (cleanPreview && cleanPreview !== noteKey && typeof scheduleFirstHeaderSync === 'function') {
                scheduleFirstHeaderSync(450);
            }
        }

        if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
        if (typeof refreshOutlineIfOpen === 'function') refreshOutlineIfOpen();
        if (typeof updateBacklinksUI === 'function') updateBacklinksUI();

        // Keep search highlights consistent if find bar is visible without stealing editor caret
        const findBar = document.getElementById('editor-find-bar');
        if (findBar && findBar.style.display !== 'none') {
            if (typeof clearDocFindHighlights === 'function') clearDocFindHighlights();
            const findInput = document.getElementById('doc-find-input');
            const counter = document.getElementById('doc-find-counter');
            const query = findInput ? findInput.value.trim() : '';
            if (query && typeof findMatchesInEditor === 'function') {
                docFindMatches = findMatchesInEditor(query);
                docFindMatchesCount = docFindMatches.length;
                docFindCurrentIndex = docFindMatchesCount > 0 ? Math.min(docFindCurrentIndex || 1, docFindMatchesCount) : 0;
                if (counter) counter.textContent = docFindMatchesCount > 0 ? `${docFindCurrentIndex}/${docFindMatchesCount}` : '0/0';
                if (typeof updateDocFindHighlights === 'function') updateDocFindHighlights();
            }
        }

        // Sync dirty flag & autosave
        if (noteState.lastSavedHtml !== null && restoredHtml === noteState.lastSavedHtml) {
            if (typeof clearAutoSaveTimer === 'function') clearAutoSaveTimer();
            hasUnsavedChanges = false;
            if (typeof unsavedDot !== 'undefined' && unsavedDot) unsavedDot.classList.remove('active');
        } else {
            if (typeof triggerAutoSave === 'function') {
                triggerAutoSave();
            } else {
                hasUnsavedChanges = true;
                if (typeof unsavedDot !== 'undefined' && unsavedDot) unsavedDot.classList.add('active');
            }
        }
    }

    function applyStep(direction) {
        const noteKey = getActiveNoteKey();
        const editorEl = getEditorEl();
        if (!noteKey || !editorEl || editorEl.getAttribute('contenteditable') === 'false') {
            return false;
        }
        if (isApplyingUndoRedo) return false;

        flushPendingTyping();

        const noteState = noteStates.get(noteKey);
        if (!noteState) return false;

        const sourceStack = direction === 'undo' ? noteState.undoStack : noteState.redoStack;
        const destStack = direction === 'undo' ? noteState.redoStack : noteState.undoStack;
        if (sourceStack.length === 0) {
            updateUndoRedoButtons();
            return false;
        }

        const entry = sourceStack.pop();
        const targetState = direction === 'undo' ? entry.before : entry.after;
        const oppositeState = direction === 'undo' ? entry.after : entry.before;
        const scrollArea = document.getElementById('editor-scroll-area');
        const prevScrollTop = scrollArea ? scrollArea.scrollTop : 0;
        const prevScrollLeft = scrollArea ? scrollArea.scrollLeft : 0;

        isApplyingUndoRedo = true;
        try {
            if (typeof clearDocFindHighlights === 'function') {
                clearDocFindHighlights();
            }

            const patchedInPlace = tryFastCodeMirrorPatch(entry, direction, oppositeState);
            if (!patchedInPlace) {
                editorEl.innerHTML = targetState.html;
                editorEl.setAttribute('contenteditable', 'true');
                if (typeof ensureNoteFirstHeader === 'function') {
                    ensureNoteFirstHeader(editorEl, noteKey, false);
                }
                hydrateRestoredContent(editorEl);
            }

            if (scrollArea) {
                scrollArea.scrollTop = prevScrollTop;
                scrollArea.scrollLeft = prevScrollLeft;
            }

            restoreEditorSelection(targetState.selection);

            const restoredHtml = getSafeCleanHTML();
            noteState.committedState = {
                html: restoredHtml,
                selection: captureEditorSelection() || targetState.selection
            };

            destStack.push(entry);
            syncAfterRestoreUI(noteState, restoredHtml);
        } finally {
            isApplyingUndoRedo = false;
        }

        updateUndoRedoButtons();
        return true;
    }

    function undo() {
        return applyStep('undo');
    }

    function redo() {
        return applyStep('redo');
    }

    function canUndo() {
        const noteKey = getActiveNoteKey();
        if (!noteKey) return false;
        if (pendingBurst) return true;
        const state = noteStates.get(noteKey);
        return Boolean(state && state.undoStack.length > 0);
    }

    function canRedo() {
        const noteKey = getActiveNoteKey();
        if (!noteKey) return false;
        const state = noteStates.get(noteKey);
        return Boolean(state && state.redoStack.length > 0);
    }

    function updateUndoRedoButtons() {
        const undoBtn = document.getElementById('toolbar-undo-btn');
        const redoBtn = document.getElementById('toolbar-redo-btn');
        if (undoBtn) {
            undoBtn.disabled = !canUndo();
        }
        if (redoBtn) {
            redoBtn.disabled = !canRedo();
        }
    }

    function onBeforeNoteSwitch() {
        flushPendingTyping();
        clearPendingBurstState();
        txDepth = 0;
        txBeforeState = null;
    }

    function onNoteOpened(noteKey) {
        onBeforeNoteSwitch();
        suspendDepth = 1;
        if (noteKey) ensureNoteState(noteKey);
        updateUndoRedoButtons();
    }

    function onNoteHydrated(noteKey, { forceReload = false } = {}) {
        if (!noteKey) {
            suspendDepth = 0;
            updateUndoRedoButtons();
            return;
        }
        if (getActiveNoteKey() !== noteKey) {
            return;
        }
        suspendDepth = 0;

        const state = ensureNoteState(noteKey);
        const cleanHtml = getSafeCleanHTML();
        const currentState = {
            html: cleanHtml,
            selection: captureEditorSelection()
        };

        if (pendingExternalRestore && pendingExternalRestore.noteKey === noteKey) {
            const preState = pendingExternalRestore.before;
            pendingExternalRestore = null;
            if (preState && preState.html !== cleanHtml) {
                pushEntry(noteKey, { before: preState, after: currentState });
            } else {
                state.committedState = currentState;
            }
            state.lastSavedHtml = cleanHtml;
            updateUndoRedoButtons();
            return;
        }

        pendingExternalRestore = null;

        if (!forceReload && state.committedState && state.committedState.html === cleanHtml) {
            state.lastSavedHtml = cleanHtml;
            updateUndoRedoButtons();
            return;
        }

        state.undoStack.length = 0;
        state.redoStack.length = 0;
        state.committedState = currentState;
        state.lastSavedHtml = cleanHtml;
        updateUndoRedoButtons();
    }

    function prepareExternalRestore(noteKey) {
        if (!noteKey) return;
        if (getActiveNoteKey() === noteKey) {
            flushPendingTyping();
            const existing = noteStates.get(noteKey);
            const before = (existing && existing.committedState)
                ? { html: existing.committedState.html, selection: captureEditorSelection() || existing.committedState.selection }
                : captureState();
            pendingExternalRestore = { noteKey, before };
        }
    }

    function onExternalContentReplaced(noteKey, beforeState) {
        if (!noteKey) return;
        clearPendingBurstState();
        const state = ensureNoteState(noteKey);
        const afterState = captureState();
        if (beforeState && beforeState.html !== afterState.html) {
            pushEntry(noteKey, { before: beforeState, after: afterState });
        } else {
            state.committedState = afterState;
        }
        state.lastSavedHtml = afterState.html;
        updateUndoRedoButtons();
    }

    function onWelcomeDashboard() {
        onBeforeNoteSwitch();
        pendingExternalRestore = null;
        suspendDepth = 0;
        updateUndoRedoButtons();
    }

    function onNoteSaved(noteKey, savedHtml) {
        if (!noteKey) return;
        const state = ensureNoteState(noteKey);
        state.lastSavedHtml = savedHtml;
        if (state.committedState && savedHtml != null && state.committedState.html !== savedHtml && !pendingBurst) {
            state.committedState.html = savedHtml;
        }
        updateUndoRedoButtons();
    }

    function syncSilentState() {
        const noteKey = getActiveNoteKey();
        if (!noteKey || isApplyingUndoRedo || suspendDepth > 0) return;
        const state = ensureNoteState(noteKey);
        const cleanHtml = getSafeCleanHTML();
        if (state.committedState) {
            state.committedState.html = cleanHtml;
        } else {
            state.committedState = { html: cleanHtml, selection: captureEditorSelection() };
        }
    }

    function renameNoteKey(oldName, newName) {
        if (!oldName || !newName || oldName === newName) return;
        const existing = noteStates.get(oldName);
        if (existing) {
            noteStates.delete(oldName);
            noteStates.set(newName, existing);
        }
        if (pendingBurst && pendingBurst.noteKey === oldName) {
            pendingBurst.noteKey = newName;
        }
        if (txBeforeState && txBeforeState.noteKey === oldName) {
            txBeforeState.noteKey = newName;
        }
        if (pendingExternalRestore && pendingExternalRestore.noteKey === oldName) {
            pendingExternalRestore.noteKey = newName;
        }
    }

    function deleteNoteKey(noteName) {
        if (!noteName) return;
        noteStates.delete(noteName);
        if (pendingBurst && pendingBurst.noteKey === noteName) {
            clearPendingBurstState();
        }
    }

    function startDomBurstIfNeeded(kind, noteKey) {
        if (!pendingBurst) {
            pendingBurst = {
                noteKey,
                kind,
                before: getBaselineBeforeState(noteKey),
                timer: null,
                cmWrapper: null,
                cmBeforeSnap: null,
                commitImmediately: false
            };
        }
    }

    function handleDomBeforeInput(e) {
        const editorEl = getEditorEl();
        if (!editorEl || isApplyingUndoRedo || suspendDepth > 0 || txDepth > 0) return;
        if (e.target && e.target.closest && e.target.closest('.CodeMirror')) return;

        const inputType = e.inputType || '';
        if (inputType === 'historyUndo') {
            e.preventDefault();
            undo();
            return;
        }
        if (inputType === 'historyRedo') {
            e.preventDefault();
            redo();
            return;
        }

        if (e.target && e.target.matches && e.target.matches('input, textarea, select')) return;

        const noteKey = getActiveNoteKey();
        if (!noteKey) return;

        const isParagraphOrBreak = inputType === 'insertParagraph' || inputType === 'insertLineBreak';
        const isDiscreteInput = isParagraphOrBreak ||
            inputType === 'insertFromPaste' ||
            inputType === 'insertFromDrop' ||
            inputType === 'deleteByCut' ||
            inputType.startsWith('format');

        if (isDiscreteInput) {
            flushPendingTyping();
            startDomBurstIfNeeded('dom-discrete', noteKey);
            pendingBurst.commitImmediately = true;
            return;
        }

        const kind = inputType.startsWith('delete') ? 'dom-delete' : 'dom-insert';
        if (pendingBurst && (pendingBurst.noteKey !== noteKey || pendingBurst.kind !== kind)) {
            flushPendingTyping();
        }
        startDomBurstIfNeeded(kind, noteKey);
    }

    function handleDomInput(e) {
        const editorEl = getEditorEl();
        if (!editorEl || isApplyingUndoRedo || suspendDepth > 0 || txDepth > 0) return;
        if (e.target && e.target.closest && e.target.closest('.CodeMirror')) return;
        if (e.target && e.target.matches && e.target.matches('input, textarea, select')) return;

        const noteKey = getActiveNoteKey();
        if (!noteKey) return;

        if (!pendingBurst) {
            startDomBurstIfNeeded('dom-insert', noteKey);
        }

        updateUndoRedoButtons();

        if (pendingBurst.commitImmediately) {
            flushPendingTyping();
        } else if (!isComposing) {
            scheduleBurstCommit();
        }
    }

    function handleCodeMirrorBeforeChange(cmInstance, wrapper, changeObj) {
        if (isApplyingUndoRedo || suspendDepth > 0 || txDepth > 0) return;
        const origin = changeObj && changeObj.origin ? changeObj.origin : '';
        if (origin === '+undo-restore' || origin === 'setValue') return;

        const noteKey = getActiveNoteKey();
        if (!noteKey) return;

        if (origin === 'paste' || origin === 'cut' || origin === 'drag') {
            flushPendingTyping();
            pendingCmDiscrete = {
                noteKey,
                before: getBaselineBeforeState(noteKey),
                cmWrapper: wrapper,
                cmBeforeSnap: readCmWrapperSnapshot(wrapper)
            };
            return;
        }

        const kind = (origin === '+delete' || origin === 'delete') ? 'cm-delete' : 'cm-insert';
        const isNewline = origin === '+input' && changeObj.text && changeObj.text.length === 2 &&
            changeObj.text[0] === '' && changeObj.text[1] === '';

        if (pendingBurst && (pendingBurst.noteKey !== noteKey || pendingBurst.kind !== kind || pendingBurst.cmWrapper !== wrapper || isNewline)) {
            flushPendingTyping();
        }

        if (!pendingBurst) {
            pendingBurst = {
                noteKey,
                kind,
                before: getBaselineBeforeState(noteKey),
                timer: null,
                cmWrapper: wrapper,
                cmBeforeSnap: readCmWrapperSnapshot(wrapper),
                commitImmediately: isNewline
            };
        }
    }

    function handleCodeMirrorChange(cmInstance, wrapper, changeObj) {
        if (isApplyingUndoRedo || suspendDepth > 0 || txDepth > 0) return;
        const origin = changeObj && changeObj.origin ? changeObj.origin : '';
        if (origin === '+undo-restore' || origin === 'setValue') return;

        const noteKey = getActiveNoteKey();
        if (!noteKey) return;

        if (pendingCmDiscrete && pendingCmDiscrete.noteKey === noteKey) {
            const discrete = pendingCmDiscrete;
            pendingCmDiscrete = null;
            const afterState = captureState();
            const afterWrap = readCmWrapperSnapshot(wrapper);
            pushEntry(noteKey, {
                before: discrete.before,
                after: afterState,
                cmMeta: buildCmMeta(discrete.cmBeforeSnap, afterWrap)
            });
            return;
        }

        if (!pendingBurst || pendingBurst.noteKey !== noteKey) {
            pendingBurst = {
                noteKey,
                kind: 'cm-insert',
                before: getBaselineBeforeState(noteKey),
                timer: null,
                cmWrapper: wrapper,
                cmBeforeSnap: readCmWrapperSnapshot(wrapper),
                commitImmediately: false
            };
        }

        updateUndoRedoButtons();

        if (pendingBurst.commitImmediately) {
            flushPendingTyping();
        } else {
            scheduleBurstCommit();
        }
    }

    function onCodeMirrorCreated(cm, wrapper) {
        if (!cm || !wrapper || wrapper.dataset.undoHooked === 'true') return;
        wrapper.dataset.undoHooked = 'true';

        cm.on('beforeChange', (inst, changeObj) => {
            handleCodeMirrorBeforeChange(inst, wrapper, changeObj);
        });
        cm.on('mousedown', () => {
            if (!isApplyingUndoRedo) flushPendingTyping();
        });
        cm.on('keydown', (inst, e) => {
            if (isApplyingUndoRedo) return;
            if (/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(e.key)) {
                flushPendingTyping();
            }
        });
        cm.on('blur', () => {
            if (!isApplyingUndoRedo) flushPendingTyping();
        });
    }

    function getCodeMirrorExtraKeys() {
        return {
            'Ctrl-Z': function () { undo(); },
            'Cmd-Z': function () { undo(); },
            'Ctrl-Y': function () { redo(); },
            'Cmd-Y': function () { redo(); },
            'Shift-Ctrl-Z': function () { redo(); },
            'Shift-Cmd-Z': function () { redo(); }
        };
    }

    function init() {
        if (listenersAttached) return;
        const editorEl = getEditorEl();
        if (!editorEl) return;
        listenersAttached = true;

        editorEl.addEventListener('beforeinput', handleDomBeforeInput);
        editorEl.addEventListener('input', handleDomInput);

        editorEl.addEventListener('compositionstart', (e) => {
            if (e.target && e.target.closest && e.target.closest('.CodeMirror')) return;
            const noteKey = getActiveNoteKey();
            if (!noteKey || isApplyingUndoRedo || suspendDepth > 0 || txDepth > 0) return;
            if (pendingBurst && pendingBurst.kind !== 'dom-insert') {
                flushPendingTyping();
            }
            startDomBurstIfNeeded('dom-insert', noteKey);
            isComposing = true;
        });

        editorEl.addEventListener('compositionend', (e) => {
            if (e.target && e.target.closest && e.target.closest('.CodeMirror')) return;
            isComposing = false;
            if (pendingBurst) {
                scheduleBurstCommit();
            }
        });

        editorEl.addEventListener('pointerdown', (e) => {
            if (isApplyingUndoRedo) return;
            if (e.target && e.target.closest && e.target.closest('.CodeMirror')) return;
            flushPendingTyping();
        }, true);

        editorEl.addEventListener('keydown', (e) => {
            if (isApplyingUndoRedo) return;
            if (e.target && e.target.closest && e.target.closest('.CodeMirror')) return;
            if (/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(e.key)) {
                flushPendingTyping();
            }
        });

        editorEl.addEventListener('focusout', (e) => {
            if (isApplyingUndoRedo) return;
            const next = e.relatedTarget;
            if (next && (next.id === 'toolbar-undo-btn' || next.id === 'toolbar-redo-btn')) {
                return;
            }
            if (!next || !editorEl.contains(next)) {
                flushPendingTyping();
            }
        });

        // Update selection on committed state while idle (never during an uncommitted burst)
        document.addEventListener('selectionchange', () => {
            if (isApplyingUndoRedo || suspendDepth > 0 || txDepth > 0 || pendingBurst) return;
            const noteKey = getActiveNoteKey();
            if (!noteKey) return;
            const state = noteStates.get(noteKey);
            if (state && state.committedState) {
                const sel = captureEditorSelection();
                if (sel) {
                    state.committedState.selection = sel;
                }
            }
        });

        updateUndoRedoButtons();
    }

    global.NoshUndo = {
        init,
        undo,
        redo,
        canUndo,
        canRedo,
        isApplying: () => isApplyingUndoRedo,
        beginTransaction,
        runWithUndo,
        flushPendingTyping,
        peekCommittedState,
        commitFromBaseline,
        captureState,
        onBeforeNoteSwitch,
        onNoteOpened,
        onNoteHydrated,
        prepareExternalRestore,
        onExternalContentReplaced,
        onWelcomeDashboard,
        onNoteSaved,
        syncSilentState,
        renameNoteKey,
        deleteNoteKey,
        onCodeMirrorCreated,
        handleCodeMirrorChange,
        getCodeMirrorExtraKeys,
        updateUndoRedoButtons,
        getDebugState: () => {
            const noteKey = getActiveNoteKey();
            const state = noteKey ? noteStates.get(noteKey) : null;
            return {
                activeNote: noteKey,
                undoCount: state ? state.undoStack.length : 0,
                redoCount: state ? state.redoStack.length : 0,
                hasPendingBurst: Boolean(pendingBurst),
                committedHtml: state && state.committedState ? state.committedState.html : null,
                lastSavedHtml: state ? state.lastSavedHtml : null
            };
        }
    };

    init();
})(window);
