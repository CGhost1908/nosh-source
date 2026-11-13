// Sidebar Hover Note Preview (Rich Mini Preview Card)
// Shows an inert, cached preview popover beside the sidebar when hovering over
// a note item after an intent delay, without interfering with clicks or drag-drop.

(function () {
    const HOVER_OPEN_DELAY_MS = 380;
    const HOVER_SWITCH_DELAY_MS = 110;
    const HOVER_HIDE_GRACE_MS = 180;
    const PREVIEW_CACHE_LIMIT = 40;
    const PREVIEW_MAX_BLOCKS = 120;
    const PREVIEW_MAX_CODE_LINES = 60;

    const previewCache = new Map();

    let previewEl = null;
    let hoveredSaveEl = null;
    let activePreviewNote = null;
    let isHoveringPreview = false;
    let currentNoteTruncated = false;
    let openTimer = null;
    let hideTimer = null;
    let copyResetTimer = null;
    let previewRequestSeq = 0;

    function safeEscapeHtml(text) {
        if (typeof escapeHtml === 'function') return escapeHtml(text);
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function countNoteWords(text) {
        if (typeof countWords === 'function') return countWords(text);
        const trimmed = String(text || '').trim();
        return trimmed ? trimmed.split(/\s+/).length : 0;
    }

    function formatPreviewTime(mtimeMs) {
        if (!mtimeMs) return '';
        if (typeof formatRelativeTime === 'function') {
            return formatRelativeTime(mtimeMs);
        }
        try {
            return new Date(mtimeMs).toLocaleDateString();
        } catch (_) {
            return '';
        }
    }

    function isContextMenuOpen() {
        const ids = ['context-menu', 'folder-context-menu', 'sidebar-context-menu', 'editor-context-menu'];
        return ids.some(id => {
            const el = document.getElementById(id);
            return el && el.style.display && el.style.display !== 'none';
        });
    }

    function isHoverPreviewEnabled() {
        if (localStorage.getItem('hover-note-preview') === 'false') return false;
        if (typeof savesDir === 'undefined' || !savesDir) return false;
        const sb = document.querySelector('.left-side');
        if (sb && sb.classList.contains('collapsed')) return false;
        if (document.body.classList.contains('zen-mode')) return false;
        if (document.body.classList.contains('is-dragging-note')) return false;
        if (document.querySelector('.modal-container.active')) return false;
        if (isContextMenuOpen()) return false;
        return true;
    }

    function isActiveNoteElement(saveEl, noteName) {
        if (saveEl && saveEl.classList.contains('active')) return true;
        return typeof activeNoteName !== 'undefined' && activeNoteName !== null && activeNoteName === noteName;
    }

    function cancelTimers() {
        if (openTimer) {
            clearTimeout(openTimer);
            openTimer = null;
        }
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    }

    function updateScrollFadeState() {
        if (!previewEl) return;
        const stageEl = previewEl.querySelector('.note-hover-preview-stage');
        const bodyWrapEl = previewEl.querySelector('.note-hover-preview-body');
        const contentEl = previewEl.querySelector('.note-hover-preview-content');
        if (!stageEl || !bodyWrapEl || !contentEl || contentEl.hidden) {
            if (stageEl) stageEl.classList.remove('has-overflow');
            return;
        }
        const hasMoreBelow = (bodyWrapEl.scrollHeight - bodyWrapEl.scrollTop - bodyWrapEl.clientHeight) > 4;
        stageEl.classList.toggle('has-overflow', currentNoteTruncated || hasMoreBelow);
    }

    function syncPinActionUI(isPinned) {
        if (!previewEl) return;
        const iconEl = previewEl.querySelector('.note-hover-preview-icon');
        if (iconEl) {
            iconEl.setAttribute('icon', isPinned ? 'solar:pin-bold' : 'solar:document-text-linear');
            iconEl.classList.toggle('is-pinned', isPinned);
        }
        const pinBtn = previewEl.querySelector('[data-preview-action="pin"]');
        if (pinBtn) {
            pinBtn.classList.toggle('is-active', isPinned);
            pinBtn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
            pinBtn.title = isPinned ? 'Unpin note' : 'Pin note';
            const btnIcon = pinBtn.querySelector('iconify-icon');
            if (btnIcon) {
                btnIcon.setAttribute('icon', isPinned ? 'solar:pin-bold' : 'solar:pin-linear');
            }
        }
    }

    function resetCopyButtonUI() {
        if (copyResetTimer) {
            clearTimeout(copyResetTimer);
            copyResetTimer = null;
        }
        if (!previewEl) return;
        const copyBtn = previewEl.querySelector('[data-preview-action="copy"]');
        if (copyBtn) {
            copyBtn.classList.remove('is-copied');
            copyBtn.title = 'Copy as Markdown';
            const btnIcon = copyBtn.querySelector('iconify-icon');
            if (btnIcon) btnIcon.setAttribute('icon', 'solar:copy-linear');
        }
    }

    async function copyPreviewNoteAsMarkdown(noteName) {
        if (!savesDir || !noteName) return;
        const safeName = path.basename(noteName);
        const filePath = path.join(savesDir, `${safeName}.nsh`);
        try {
            const rawHtml = await fsPromises.readFile(filePath, 'utf8');
            let md = '';
            if (typeof htmlToMarkdown === 'function') {
                md = htmlToMarkdown(rawHtml);
            } else {
                const probe = sanitizeNoteHtml(rawHtml);
                md = extractSpacedText(probe.body);
            }
            if (typeof nativeClipboard !== 'undefined' && nativeClipboard && typeof nativeClipboard.writeText === 'function') {
                nativeClipboard.writeText(md);
            } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(md);
            }

            if (previewEl && activePreviewNote === noteName) {
                const copyBtn = previewEl.querySelector('[data-preview-action="copy"]');
                if (copyBtn) {
                    copyBtn.classList.add('is-copied');
                    copyBtn.title = 'Copied!';
                    const btnIcon = copyBtn.querySelector('iconify-icon');
                    if (btnIcon) btnIcon.setAttribute('icon', 'solar:check-circle-bold');
                    if (copyResetTimer) clearTimeout(copyResetTimer);
                    copyResetTimer = setTimeout(resetCopyButtonUI, 1300);
                }
            }
            if (typeof showToast === 'function') {
                showToast('Note copied as Markdown!', 'success');
            }
        } catch (err) {
            if (typeof showToast === 'function') {
                showToast('Failed to copy note', 'error');
            }
        }
    }

    function handlePreviewAction(action) {
        const targetNote = activePreviewNote;
        if (!targetNote) return;

        if (action === 'open') {
            hidePreviewImmediate();
            if (typeof openDesiredFile === 'function') {
                openDesiredFile(targetNote);
            }
            return;
        }

        if (action === 'pin') {
            if (typeof togglePinNote === 'function') {
                togglePinNote(targetNote);
                const pinnedNow = typeof isNotePinned === 'function' ? isNotePinned(targetNote) : false;
                syncPinActionUI(pinnedNow);
            }
            return;
        }

        if (action === 'copy') {
            copyPreviewNoteAsMarkdown(targetNote);
            return;
        }

        if (action === 'move') {
            hidePreviewImmediate();
            if (typeof openMoveToFolderModal === 'function') {
                openMoveToFolderModal(targetNote);
            }
            return;
        }

        if (action === 'delete') {
            hidePreviewImmediate();
            if (typeof openDeleteModal === 'function') {
                openDeleteModal(targetNote);
            }
        }
    }

    function ensurePreviewElement() {
        if (previewEl && previewEl.isConnected) return previewEl;

        previewEl = document.createElement('aside');
        previewEl.id = 'note-hover-preview';
        previewEl.className = 'note-hover-preview';
        previewEl.setAttribute('aria-hidden', 'true');
        previewEl.innerHTML = `
            <div class="note-hover-preview-header">
                <div class="note-hover-preview-title-row">
                    <iconify-icon class="note-hover-preview-icon" icon="solar:document-text-linear"></iconify-icon>
                    <span class="note-hover-preview-title"></span>
                </div>
                <div class="note-hover-preview-meta"></div>
            </div>
            <div class="note-hover-preview-stage">
                <div class="note-hover-preview-body">
                    <div class="note-hover-preview-content history-rendered"></div>
                    <div class="note-hover-preview-empty" hidden>
                        <iconify-icon icon="solar:pen-new-square-linear"></iconify-icon>
                        <span>Empty note — click to start writing</span>
                    </div>
                </div>
            </div>
            <div class="note-hover-preview-footer">
                <div class="note-hover-preview-actions">
                    <button type="button" class="preview-action-btn" data-preview-action="pin" title="Pin note" aria-pressed="false">
                        <iconify-icon icon="solar:pin-linear"></iconify-icon>
                    </button>
                    <button type="button" class="preview-action-btn" data-preview-action="copy" title="Copy as Markdown">
                        <iconify-icon icon="solar:copy-linear"></iconify-icon>
                    </button>
                    <button type="button" class="preview-action-btn" data-preview-action="move" title="Move to Folder...">
                        <iconify-icon icon="solar:folder-with-files-linear"></iconify-icon>
                    </button>
                    <button type="button" class="preview-action-btn danger" data-preview-action="delete" title="Delete note">
                        <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
                    </button>
                </div>
                <button type="button" class="preview-open-btn" data-preview-action="open" title="Open note in editor">
                    <span>Open</span>
                    <iconify-icon icon="solar:arrow-right-up-linear"></iconify-icon>
                </button>
            </div>
        `;

        previewEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-preview-action]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            handlePreviewAction(btn.getAttribute('data-preview-action'));
        });

        previewEl.addEventListener('mouseenter', () => {
            if (!previewEl.classList.contains('visible')) return;
            isHoveringPreview = true;
            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
            if (openTimer) {
                clearTimeout(openTimer);
                openTimer = null;
            }
        });

        previewEl.addEventListener('mouseleave', () => {
            isHoveringPreview = false;
            if (!hoveredSaveEl) {
                scheduleHidePreview();
            }
        });

        const bodyWrapEl = previewEl.querySelector('.note-hover-preview-body');
        if (bodyWrapEl) {
            bodyWrapEl.addEventListener('scroll', updateScrollFadeState, { passive: true });
        }

        document.body.appendChild(previewEl);
        return previewEl;
    }

    function hidePreviewImmediate() {
        cancelTimers();
        resetCopyButtonUI();
        previewRequestSeq++;
        hoveredSaveEl = null;
        activePreviewNote = null;
        isHoveringPreview = false;
        currentNoteTruncated = false;
        if (previewEl) {
            previewEl.classList.remove('visible');
            previewEl.setAttribute('aria-hidden', 'true');
        }
    }

    function scheduleHidePreview() {
        if (openTimer) {
            clearTimeout(openTimer);
            openTimer = null;
        }
        if (isHoveringPreview) return;
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideTimer = null;
            if (!isHoveringPreview && !hoveredSaveEl) {
                hidePreviewImmediate();
            }
        }, HOVER_HIDE_GRACE_MS);
    }

    function sanitizeNoteHtml(rawHtml) {
        if (typeof sanitizeSnapshotDoc === 'function') {
            return sanitizeSnapshotDoc(rawHtml);
        }
        const doc = new DOMParser().parseFromString(rawHtml || '', 'text/html');
        doc.querySelectorAll('script, style, link, meta, iframe[srcdoc], .CodeMirror, .media-toolbar, .media-resize-handle, .table-col-resizer').forEach(el => el.remove());
        return doc;
    }

    function isMeaningfulPreviewNode(node) {
        if (!node) return false;
        if (node.nodeType === Node.TEXT_NODE) {
            return (node.nodeValue || '').trim().length > 0;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.matches('hr, img, video, svg, table, pre, .code-block-wrapper, .checklist-item, .math-formula-block, .note-preview-media-pill, .claude-embedded-diagram')) {
            return true;
        }
        if (node.querySelector('img, video, svg, hr, table, pre, .code-block-wrapper, .checklist-item, .math-formula-block, .note-preview-media-pill, .claude-embedded-diagram')) {
            return true;
        }
        return (node.textContent || '').replace(/\u00a0/g, ' ').trim().length > 0;
    }

    function buildCodePreviewPre(doc, rawCode, rawLang) {
        const lines = String(rawCode || '').replace(/\r\n/g, '\n').split('\n');
        const wasTruncated = lines.length > PREVIEW_MAX_CODE_LINES;
        const clipped = wasTruncated
            ? lines.slice(0, PREVIEW_MAX_CODE_LINES).join('\n') + '\n…'
            : lines.join('\n');

        const pre = doc.createElement('pre');
        pre.className = 'history-text-code';
        const codeEl = doc.createElement('code');

        if (typeof highlightCodeForPdf === 'function') {
            codeEl.className = 'hljs';
            codeEl.innerHTML = highlightCodeForPdf(clipped, rawLang);
        } else {
            codeEl.textContent = clipped;
        }
        pre.appendChild(codeEl);
        return pre;
    }

    function extractSpacedText(root) {
        if (!root) return '';
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const parts = [];
        let node;
        while ((node = walker.nextNode())) {
            const val = (node.nodeValue || '').replace(/\u00a0/g, ' ').trim();
            if (val) parts.push(val);
        }
        return parts.join(' ');
    }

    function buildPreviewPayload(noteName, rawHtml, mtimeMs) {
        const doc = sanitizeNoteHtml(rawHtml);
        doc.querySelectorAll('.block-drag-handle, .media-drag-handle, .code-block-actions, .lang-caret, .block-lang-dropdown, .custom-color-popover, .delete-code-button').forEach(el => el.remove());

        // Compute stats from the full note before deduplicating/truncating blocks
        const codeBlockCount = doc.body.querySelectorAll('.code-block-wrapper').length +
            Array.from(doc.body.querySelectorAll('textarea.code, pre')).filter(el => !el.closest('.code-block-wrapper')).length;
        const checklistTotal = doc.body.querySelectorAll('.checklist-item').length;
        const checklistDone = doc.body.querySelectorAll('.checklist-item input.checklist-checkbox[checked], .checklist-item input.checklist-checkbox:checked').length;

        const statsProbe = doc.body.cloneNode(true);
        statsProbe.querySelectorAll('.code-block-header').forEach(el => el.remove());
        const wordCount = countNoteWords(extractSpacedText(statsProbe));

        const statParts = [];
        if (wordCount > 0) {
            statParts.push(`${wordCount} ${wordCount === 1 ? 'word' : 'words'}`);
        }
        if (codeBlockCount > 0) {
            statParts.push(`${codeBlockCount} code`);
        }
        if (checklistTotal > 0) {
            statParts.push(`${checklistDone}/${checklistTotal} tasks`);
        }

        // Remove redundant leading H1 when it simply repeats the note title
        const firstChildEl = doc.body.firstElementChild;
        if (firstChildEl && firstChildEl.tagName === 'H1') {
            const h1Text = (firstChildEl.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (h1Text === String(noteName || '').trim().toLowerCase()) {
                firstChildEl.remove();
            }
        }

        // Convert live editor blocks into compact, inert preview elements
        doc.body.querySelectorAll('.code-block-wrapper').forEach(wrapper => {
            wrapper.removeAttribute('contenteditable');
            const tag = wrapper.querySelector('.code-lang-tag');
            if (tag) {
                tag.classList.remove('clickable');
                tag.removeAttribute('title');
            }
            const ta = wrapper.querySelector('textarea.code');
            if (ta) {
                const rawLang = ta.getAttribute('data-label') || ta.getAttribute('language') || '';
                const pre = buildCodePreviewPre(doc, ta.value || ta.textContent || '', rawLang);
                ta.replaceWith(pre);
            }
        });

        doc.body.querySelectorAll('textarea.code').forEach(ta => {
            const rawLang = ta.getAttribute('data-label') || ta.getAttribute('language') || '';
            const pre = buildCodePreviewPre(doc, ta.value || ta.textContent || '', rawLang);
            ta.replaceWith(pre);
        });

        doc.body.querySelectorAll('video').forEach(videoEl => {
            const pill = doc.createElement('div');
            pill.className = 'note-preview-media-pill';
            pill.innerHTML = '<iconify-icon icon="solar:videocamera-linear"></iconify-icon><span>Embedded video</span>';
            const mediaWrap = videoEl.closest('.media-container');
            if (mediaWrap && !mediaWrap.querySelector('img')) {
                mediaWrap.replaceWith(pill);
            } else {
                videoEl.replaceWith(pill);
            }
        });

        doc.body.querySelectorAll('img').forEach(img => {
            img.setAttribute('loading', 'eager');
            img.setAttribute('decoding', 'async');
            img.removeAttribute('width');
            img.removeAttribute('height');
        });

        if (typeof window !== 'undefined' && window.katex) {
            doc.body.querySelectorAll('.math-formula-block[data-latex], .math-formula-inline[data-latex]').forEach(el => {
                if (el.querySelector('.katex')) return;
                const latex = el.getAttribute('data-latex') || '';
                if (!latex) return;
                try {
                    const isDisplay = el.getAttribute('data-display-mode') !== 'false' && el.classList.contains('math-formula-block');
                    el.innerHTML = window.katex.renderToString(latex, {
                        displayMode: isDisplay,
                        throwOnError: false,
                        strict: false
                    });
                } catch (_) {}
            });
        }

        const sliceContainer = doc.createElement('div');
        let keptCount = 0;
        let isTruncated = false;

        for (const node of Array.from(doc.body.childNodes)) {
            if (!isMeaningfulPreviewNode(node)) continue;
            if (keptCount >= PREVIEW_MAX_BLOCKS) {
                isTruncated = true;
                break;
            }
            if (node.nodeType === Node.TEXT_NODE) {
                const p = doc.createElement('p');
                p.textContent = node.nodeValue.trim();
                sliceContainer.appendChild(p);
            } else {
                sliceContainer.appendChild(node.cloneNode(true));
            }
            keptCount++;
        }

        const isEmpty = keptCount === 0;
        if (isEmpty && statParts.length === 0) {
            statParts.push('Empty note');
        }

        return {
            mtimeMs,
            statsText: statParts.join(' · '),
            bodyHtml: sliceContainer.innerHTML,
            isEmpty,
            isTruncated
        };
    }

    function setCachedPreview(noteName, payload) {
        if (previewCache.has(noteName)) {
            previewCache.delete(noteName);
        } else if (previewCache.size >= PREVIEW_CACHE_LIMIT) {
            const oldestKey = previewCache.keys().next().value;
            if (oldestKey !== undefined) previewCache.delete(oldestKey);
        }
        previewCache.set(noteName, payload);
    }

    async function getNotePreviewData(noteName, mtimeHint = 0) {
        if (!savesDir || !noteName) return null;
        const safeName = path.basename(noteName);
        const filePath = path.join(savesDir, `${safeName}.nsh`);

        try {
            const stat = await fsPromises.stat(filePath);
            const diskMtime = stat.mtimeMs || mtimeHint || 0;
            const cached = previewCache.get(safeName);
            if (cached && cached.mtimeMs === diskMtime) {
                // Refresh LRU order
                previewCache.delete(safeName);
                previewCache.set(safeName, cached);
                return cached;
            }

            const rawHtml = await fsPromises.readFile(filePath, 'utf8');
            const payload = buildPreviewPayload(safeName, rawHtml, diskMtime);
            setCachedPreview(safeName, payload);
            return payload;
        } catch (err) {
            return null;
        }
    }

    function positionPreviewCard(card, saveEl) {
        const itemRect = saveEl.getBoundingClientRect();
        const sidebarEl = document.querySelector('.left-side');
        const sidebarRect = sidebarEl ? sidebarEl.getBoundingClientRect() : null;

        const cardWidth = card.offsetWidth || 364;
        const cardHeight = card.offsetHeight || 220;
        const anchorRight = sidebarRect ? sidebarRect.right : itemRect.right;

        let left = anchorRight + 10;
        if (left + cardWidth > window.innerWidth - 12) {
            left = Math.max(12, window.innerWidth - cardWidth - 12);
        }

        const minTop = 52; // stay below window titlebar (44px)
        const maxBottom = window.innerHeight - 34; // stay above status bar
        let top = itemRect.top - 8;
        if (top + cardHeight > maxBottom) {
            top = maxBottom - cardHeight;
        }
        if (top < minTop) {
            top = Math.max(10, Math.min(minTop, window.innerHeight - cardHeight - 10));
        }

        card.style.left = `${Math.round(left)}px`;
        card.style.top = `${Math.round(top)}px`;
    }

    async function showPreviewForElement(saveEl, noteName) {
        if (!saveEl || !saveEl.isConnected || hoveredSaveEl !== saveEl) return;
        if (!isHoverPreviewEnabled() || isActiveNoteElement(saveEl, noteName)) {
            hidePreviewImmediate();
            return;
        }

        const reqSeq = ++previewRequestSeq;
        const mtimeHint = Number(saveEl.getAttribute('data-mtime')) || 0;
        const isPinned = saveEl.classList.contains('pinned');

        const data = await getNotePreviewData(noteName, mtimeHint);
        if (reqSeq !== previewRequestSeq || hoveredSaveEl !== saveEl || !saveEl.isConnected) {
            return;
        }
        if (!data || !isHoverPreviewEnabled() || isActiveNoteElement(saveEl, noteName)) {
            hidePreviewImmediate();
            return;
        }

        const card = ensurePreviewElement();
        resetCopyButtonUI();
        const titleEl = card.querySelector('.note-hover-preview-title');
        const metaEl = card.querySelector('.note-hover-preview-meta');
        const stageEl = card.querySelector('.note-hover-preview-stage');
        const bodyWrapEl = card.querySelector('.note-hover-preview-body');
        const contentEl = card.querySelector('.note-hover-preview-content');
        const emptyEl = card.querySelector('.note-hover-preview-empty');

        const pinnedState = typeof isNotePinned === 'function' ? isNotePinned(noteName) : isPinned;
        syncPinActionUI(pinnedState);
        if (titleEl) titleEl.textContent = noteName;

        if (metaEl) {
            const timeLabel = formatPreviewTime(data.mtimeMs || mtimeHint);
            const metaParts = [timeLabel, data.statsText].filter(Boolean);
            metaEl.textContent = metaParts.join(' · ');
        }

        currentNoteTruncated = Boolean(data.isTruncated);

        if (contentEl && emptyEl && bodyWrapEl && stageEl) {
            stageEl.classList.remove('has-overflow');
            bodyWrapEl.scrollTop = 0;
            if (data.isEmpty) {
                contentEl.innerHTML = '';
                contentEl.hidden = true;
                emptyEl.hidden = false;
            } else {
                emptyEl.hidden = true;
                contentEl.hidden = false;
                contentEl.innerHTML = data.bodyHtml;
            }
        }

        activePreviewNote = noteName;
        card.setAttribute('aria-hidden', 'false');
        // Measure after content update before revealing
        positionPreviewCard(card, saveEl);

        if (bodyWrapEl && !data.isEmpty) {
            updateScrollFadeState();

            contentEl.querySelectorAll('img').forEach(img => {
                if (!img.complete) {
                    img.addEventListener('load', () => {
                        if (reqSeq === previewRequestSeq && saveEl.isConnected && card.classList.contains('visible')) {
                            positionPreviewCard(card, saveEl);
                            updateScrollFadeState();
                        }
                    }, { once: true });
                }
            });
        }

        card.classList.add('visible');
    }

    function handleSaveHoverEnter(saveEl) {
        if (!saveEl || !isHoverPreviewEnabled()) {
            hidePreviewImmediate();
            return;
        }

        const noteName = saveEl.getAttribute('data-file');
        if (!noteName || isActiveNoteElement(saveEl, noteName)) {
            hoveredSaveEl = null;
            scheduleHidePreview();
            return;
        }

        hoveredSaveEl = saveEl;
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        if (openTimer) {
            clearTimeout(openTimer);
            openTimer = null;
        }

        const isVisible = Boolean(previewEl && previewEl.classList.contains('visible'));
        if (isVisible && activePreviewNote === noteName) {
            return;
        }

        const delay = isVisible ? HOVER_SWITCH_DELAY_MS : HOVER_OPEN_DELAY_MS;
        openTimer = setTimeout(() => {
            openTimer = null;
            showPreviewForElement(saveEl, noteName);
        }, delay);
    }

    function invalidatePreviewCache(noteName = null) {
        if (!noteName) {
            previewCache.clear();
            return;
        }
        previewCache.delete(path.basename(noteName));
    }

    function bindSidebarPreviewEvents() {
        const container = document.getElementById('saves-container');
        if (!container || container.dataset.hoverPreviewBound === 'true') return;
        container.dataset.hoverPreviewBound = 'true';

        container.addEventListener('mouseover', (e) => {
            if (e.target.closest('.save-pin-quick')) {
                hoveredSaveEl = null;
                scheduleHidePreview();
                return;
            }
            const saveEl = e.target.closest('.save');
            if (!saveEl || saveEl.classList.contains('hidden')) {
                if (hoveredSaveEl) {
                    hoveredSaveEl = null;
                    scheduleHidePreview();
                }
                return;
            }
            if (saveEl === hoveredSaveEl) return;
            handleSaveHoverEnter(saveEl);
        });

        container.addEventListener('mouseout', (e) => {
            if (!hoveredSaveEl) return;
            const related = e.relatedTarget;
            if (related && hoveredSaveEl.contains(related) && !related.closest('.save-pin-quick')) {
                return;
            }
            hoveredSaveEl = null;
            scheduleHidePreview();
        });

        container.addEventListener('mouseleave', () => {
            hoveredSaveEl = null;
            scheduleHidePreview();
        });

        container.addEventListener('scroll', hidePreviewImmediate, { passive: true });
        container.addEventListener('mousedown', hidePreviewImmediate);
        container.addEventListener('dragstart', hidePreviewImmediate);
        container.addEventListener('contextmenu', hidePreviewImmediate);

        window.addEventListener('blur', hidePreviewImmediate);
        window.addEventListener('resize', hidePreviewImmediate);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hidePreviewImmediate();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindSidebarPreviewEvents);
    } else {
        bindSidebarPreviewEvents();
    }

    window.NoshSidebarPreview = {
        hide: hidePreviewImmediate,
        invalidate: invalidatePreviewCache,
        isVisible: () => Boolean(previewEl && previewEl.classList.contains('visible')),
        getCurrentNote: () => activePreviewNote,
        bind: bindSidebarPreviewEvents
    };
})();
