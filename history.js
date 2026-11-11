// Note Version History
// Every time a note is saved, the version that is about to be overwritten can be kept as a
// snapshot in <notes folder>/.history/<note name>/<version time>.nsh, so an earlier state
// can be previewed and restored. Snapshots are plain .nsh files: the note format and Drive
// sync are untouched, and the folder is ignored by the vault scanners.

const NOTE_HISTORY_DIR = '.history';
const HISTORY_MIN_INTERVAL_MS = 5 * 60 * 1000; // at most one automatic snapshot per note every 5 minutes
const HISTORY_MAX_SNAPSHOTS = 50;
const HISTORY_ID_PATTERN = /^\d{10,16}$/;

function getNoteHistoryDir(noteName) {
    return path.join(savesDir, NOTE_HISTORY_DIR, path.basename(String(noteName)));
}

async function getHistoryIds(noteName) {
    try {
        const files = await fsPromises.readdir(getNoteHistoryDir(noteName));
        return files
            .filter(f => f.endsWith('.nsh') && HISTORY_ID_PATTERN.test(path.basename(f, '.nsh')))
            .map(f => path.basename(f, '.nsh'))
            .sort((a, b) => Number(b) - Number(a)); // newest version first
    } catch (err) {
        return [];
    }
}

// List the saved versions of a note, newest first
async function listNoteHistory(noteName) {
    const dir = getNoteHistoryDir(noteName);
    const ids = await getHistoryIds(noteName);
    const entries = await Promise.all(ids.map(async (id) => {
        try {
            const stat = await fsPromises.stat(path.join(dir, `${id}.nsh`));
            return { id, timestamp: Number(id), size: stat.size };
        } catch (err) {
            return null;
        }
    }));
    return entries.filter(Boolean);
}

async function pruneNoteHistory(noteName) {
    const ids = await getHistoryIds(noteName);
    const dir = getNoteHistoryDir(noteName);
    for (const id of ids.slice(HISTORY_MAX_SNAPSHOTS)) {
        await fsPromises.unlink(path.join(dir, `${id}.nsh`)).catch(() => {});
    }
}

// Save a snapshot of `html` taken as it was at `timestamp`.
// Never throws: a history problem must not get in the way of saving the note.
// Returns the snapshot id, or null when nothing was written.
async function snapshotNote(noteName, html, { timestamp = Date.now(), force = false } = {}) {
    try {
        if (!noteName || typeof html !== 'string' || !html.trim()) return null;

        const dir = getNoteHistoryDir(noteName);
        const ids = await getHistoryIds(noteName);
        const id = String(Math.floor(timestamp));
        if (ids.includes(id)) return null; // this exact version is already kept

        if (ids.length > 0) {
            const latestPath = path.join(dir, `${ids[0]}.nsh`);
            if (!force) {
                // Throttle on when the last snapshot was taken, not on the version's own time,
                // so the state before a long break is never skipped
                const latestStat = await fsPromises.stat(latestPath);
                if (Date.now() - latestStat.mtimeMs < HISTORY_MIN_INTERVAL_MS) return null;
            }
            const latestHtml = await fsPromises.readFile(latestPath, 'utf8');
            if (latestHtml === html) return null;
        }

        await fsPromises.mkdir(dir, { recursive: true });
        await fsPromises.writeFile(path.join(dir, `${id}.nsh`), html, 'utf8');
        await pruneNoteHistory(noteName);
        return id;
    } catch (err) {
        console.warn('Could not save note history snapshot:', err);
        return null;
    }
}

// Called by saveFile() right before it overwrites the note on disk
async function captureHistoryBeforeSave(noteName, filePath, newHtml) {
    try {
        const stat = await fsPromises.stat(filePath);
        const previousHtml = await fsPromises.readFile(filePath, 'utf8');
        if (previousHtml === newHtml) return;
        await snapshotNote(noteName, previousHtml, { timestamp: stat.mtimeMs });
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn('History capture skipped:', err);
    }
}

async function readNoteSnapshot(noteName, id) {
    if (!HISTORY_ID_PATTERN.test(String(id))) throw new Error('Invalid version id');
    return fsPromises.readFile(path.join(getNoteHistoryDir(noteName), `${id}.nsh`), 'utf8');
}

async function renameNoteHistory(oldName, newName) {
    try {
        const from = getNoteHistoryDir(oldName);
        const to = getNoteHistoryDir(newName);
        if (!fs.existsSync(from) || fs.existsSync(to)) return;
        await fsPromises.rename(from, to);
    } catch (err) {
        console.warn('Could not move note history on rename:', err);
    }
}

async function deleteNoteHistory(noteName) {
    try {
        await fsPromises.rm(getNoteHistoryDir(noteName), { recursive: true, force: true });
    } catch (err) {
        console.warn('Could not delete note history:', err);
    }
}

// ---------- Snapshot rendering & GitHub-style diff ----------

// Sanitize saved note HTML into an inert document: scripts, live editors, toolbars
// and scriptable attributes are stripped, and nothing saved is ever executed.
function sanitizeSnapshotDoc(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('script, style, link, meta, iframe[srcdoc], .CodeMirror, .media-toolbar, .media-resize-handle, .table-col-resizer').forEach(el => el.remove());

    doc.querySelectorAll('*').forEach(el => {
        for (const attr of [...el.attributes || []]) {
            const name = (attr.name || '').toLowerCase();
            if (name.startsWith('on') || name === 'draggable' || name === 'contenteditable') el.removeAttribute(attr.name);
        }
    });

    doc.querySelectorAll('input.checklist-checkbox').forEach(cb => {
        cb.setAttribute('disabled', '');
        cb.setAttribute('tabindex', '-1');
    });
    doc.querySelectorAll('a').forEach(a => a.removeAttribute('href')); // nothing clickable in the preview

    doc.querySelectorAll('img, video').forEach(el => {
        const rel = el.getAttribute('data-asset-rel') ||
            (((el.getAttribute('src') || '').startsWith('assets/')) ? el.getAttribute('src') : null);
        if (rel) {
            try {
                const localUrl = toLocalMediaUrl(path.join(savesDir, rel));
                if (localUrl) el.setAttribute('src', localUrl);
                /* toLocalMediaUrl döndürmediyse orijinal src zaten el'de kalır */
            } catch (err) { /* savesDir/toLocalMediaUrl hazır değil: orijinal src korunur */ }
        }
        el.removeAttribute('controls');
        el.removeAttribute('autoplay');
    });

    return doc;
}

// Render the selected version itself, rather than a transformed diff, so its
// layout matches the note while all saved content remains inert.
function buildHistoryRenderedPreview(container, html, currentHtml = null) {
    const doc = sanitizeSnapshotDoc(html);
    const snapshotLines = snapshotToLines(doc);
    const currentLines = currentHtml ? snapshotToLines(currentHtml) : [];
    const diffOps = buildLineDiff(currentLines, snapshotLines);

    doc.querySelectorAll('.code-block-wrapper').forEach(wrapper => {
        wrapper.setAttribute('contenteditable', 'false');
        wrapper.querySelectorAll('.block-drag-handle, .code-block-actions').forEach(el => el.remove());
        const tag = wrapper.querySelector('.code-lang-tag');
        if (tag) {
            tag.classList.remove('clickable');
            tag.removeAttribute('title');
        }
    });
    doc.querySelectorAll('textarea.code').forEach(ta => {
        const pre = doc.createElement('pre');
        pre.className = 'history-text-code';
        pre.textContent = ta.value || ta.textContent || '';
        ta.replaceWith(pre);
    });
    doc.querySelectorAll('.checklist-text').forEach(el => el.setAttribute('contenteditable', 'false'));

    const rendered = document.createElement('div');
    rendered.className = 'history-rendered';
    rendered.setAttribute('contenteditable', 'false');
    while (doc.body.firstChild) rendered.appendChild(doc.body.firstChild);

    container.innerHTML = '';
    container.appendChild(rendered);

    diffOps.forEach((op, index) => {
        if (op.type === 'add' && op.line.source?.isConnected) {
            op.line.source.classList.add('history-change-add');
        }
        if (op.type !== 'del') return;
        const removed = document.createElement('div');
        removed.className = 'history-change-remove';
        removed.innerHTML = op.line.html || escapeHtml(op.line.sig);
        const nextSnapshotOp = diffOps.slice(index + 1).find(candidate => candidate.type !== 'del' && candidate.line.source?.isConnected);
        if (nextSnapshotOp) nextSnapshotOp.line.source.before(removed);
        else rendered.appendChild(removed);
    });

    const added = rendered.querySelectorAll('.history-change-add').length;
    const removed = rendered.querySelectorAll('.history-change-remove').length;
    return { added, removed, ops: diffOps };
}

function countWords(text) {
    const trimmed = (text || '').trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Flatten a snapshot into numbered preview LINES with real content:
// one line per paragraph / heading / list item / checklist item / code line / media.
// Each line keeps `sig` (plain text, used for the LCS diff) plus the inert HTML
// (`html`) that renders it, so checkbox items, images and code show up for real.
function snapshotToLines(html) {
    const doc = html && html.nodeType === Node.DOCUMENT_NODE ? html : sanitizeSnapshotDoc(html);
    const lines = [];

    const pushInline = (el, opts = {}) => {
        const sig = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!sig) return; // skip blank visual rows (e.g. `<p><br></p>`)
        lines.push({
            sig,
            kind: opts.kind || el.tagName.toLowerCase(),
            html: (opts.html !== undefined ? opts.html : el.innerHTML).trim(),
            source: el
        });
    };

    const walk = children => {
        for (const el of Array.from(children)) {
            if (el.nodeType === Node.TEXT_NODE) {
                const sig = (el.nodeValue || '').replace(/\s+/g, ' ').trim();
                if (sig) lines.push({ sig, kind: 'text', html: escapeHtml(sig) });
                continue;
            }
            if (el.nodeType !== Node.ELEMENT_NODE) continue;

            // Code block: render as a full pre/code block (single diff row)
            if (el.classList.contains('code-block-wrapper')) {
                const ta = el.querySelector('textarea.code');
                const code = (ta ? (ta.value || ta.textContent || '') : '').trim();
                const lang = ta ? (ta.getAttribute('data-label') || ta.getAttribute('language') || '') : '';
                const sig = code.split('\n')[0] || '(code block)';
                const pre = document.createElement('pre');
                const codeEl = document.createElement('code');
                if (lang) codeEl.className = `language-${lang}`;
                codeEl.textContent = code;
                pre.appendChild(codeEl);
                lines.push({ sig, kind: 'codeblock', html: pre.outerHTML, source: el });
                continue;
            }
            // Lone textarea.code (not inside wrapper): render as code block
            if (el.matches && el.matches('textarea.code')) {
                const code = (el.value || el.textContent || '').trim();
                const lang = el.getAttribute('data-label') || el.getAttribute('language') || '';
                const sig = code.split('\n')[0] || '(code block)';
                const pre = document.createElement('pre');
                const codeEl = document.createElement('code');
                if (lang) codeEl.className = `language-${lang}`;
                codeEl.textContent = code;
                pre.appendChild(codeEl);
                lines.push({ sig, kind: 'codeblock', html: pre.outerHTML, source: el });
                continue;
            }

            // Checklist item: real checkbox (rendered downstream) + label markup
            if (el.matches && el.matches('.checklist-item, label.checklist-item')) {
                const cb = el.querySelector('input.checklist-checkbox');
                const on = !!(cb && cb.hasAttribute('checked'));
                const sig = `${on ? '[x]' : '[ ]'} ${(el.textContent || '').replace(/\s+/g, ' ').trim()}`;
                if (sig.trim() !== (on ? '[x]' : '[ ]')) {
                    const label = cb && cb.nextElementSibling ? cb.nextElementSibling : null;
                    lines.push({ sig, kind: 'check', html: (label ? label.innerHTML : el.querySelector('span.checklist-text') ? el.querySelector('span.checklist-text').innerHTML : el.innerHTML).trim(), source: el });
                }
                continue;
            }

            // Top-level checkbox without a wrapper (kept in place for the diff)
            if (el.matches && el.matches('input.checklist-checkbox')) {
                const on = el.hasAttribute('checked');
                lines.push({ sig: on ? '[x]' : '[ ]', kind: 'check', html: '', source: el });
                continue;
            }

            // Media: an inline thumbnail image (or a compact video box)
            if (el.matches && el.matches('img, video')) {
                if (el.getAttribute('src')) {
                    lines.push({ sig: `[${el.tagName.toLowerCase()}]`, kind: 'media', html: '' });
                    lines[lines.length - 1].el = el;
                    lines[lines.length - 1].source = el;
                }
                continue;
            }

            if (el.matches && el.matches('hr')) {
                lines.push({ sig: '-', kind: 'rule', html: '', source: el });
                continue;
            }

            // Standalone <pre> (from markdown export etc.): render as code block
            if (el.tagName === 'PRE') {
                const code = (el.textContent || '').trim();
                const sig = code.split('\n')[0] || '(code block)';
                const clone = el.cloneNode(true);
                clone.querySelectorAll('*').forEach(c => {
                    for (const attr of [...c.attributes || []]) {
                        const n = attr.name.toLowerCase();
                        if (n.startsWith('on') || n === 'contenteditable') c.removeAttribute(attr.name);
                    }
                });
                lines.push({ sig, kind: 'codeblock', html: clone.outerHTML, source: el });
                continue;
            }

            if (el.tagName === 'UL' || el.tagName === 'OL') {
                walk(el.children);
                continue;
            }
            if (el.tagName === 'LI') {
                pushInline(el);
                continue;
            }
            // Table: render as a real table (one diff row for the whole table)
            if (el.tagName === 'TABLE') {
                const clone = el.cloneNode(true);
                clone.querySelectorAll('*').forEach(c => {
                    for (const attr of [...c.attributes || []]) {
                        const n = attr.name.toLowerCase();
                        if (n.startsWith('on') || n === 'contenteditable') c.removeAttribute(attr.name);
                    }
                });
                const sig = (el.textContent || '').replace(/\s+/g, ' ').trim();
                lines.push({ sig, kind: 'table', html: clone.outerHTML, source: el });
                continue;
            }

            // Headings and paragraphs: real text with its inline formatting (bold, code, ...)
            if (/^H[1-6]$/.test(el.tagName)) {
                const sig = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (sig) lines.push({ sig, kind: 'heading', tag: el.tagName.toLowerCase(), html: el.innerHTML.trim(), source: el });
                continue;
            }
            if (el.tagName === 'P' || el.tagName === 'BLOCKQUOTE') {
                pushInline(el);
                continue;
            }

            // Unknown container (div, section, ...): walk into it
            if (el.children && el.children.length) {
                walk(el.children);
            } else {
                pushInline(el);
            }
        }
    };

    walk(doc.body.childNodes);
    return lines;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Diff matches lines by their plain-text signature; a restored version ADDS green
// lines to the note and REMOVES red ones (base = current note, candidate = snapshot).
function buildLineDiff(baseLines, snapshotLines) {
    const a = baseLines.map(l => l.sig);
    const b = snapshotLines.map(l => l.sig);

    // Guard rails: LCS matrix is O(n*m) - fall back to a coarse diff for huge notes
    if (a.length * b.length > 1_500_000) {
        const ops = [];
        baseLines.forEach(line => ops.push({ type: 'del', line }));
        snapshotLines.forEach(line => ops.push({ type: 'add', line }));
        return ops;
    }

    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { ops.push({ type: 'ctx', line: baseLines[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', line: baseLines[i] }); i++; }
        else { ops.push({ type: 'add', line: snapshotLines[j] }); j++; }
    }
    while (i < n) { ops.push({ type: 'del', line: baseLines[i] }); i++; }
    while (j < m) { ops.push({ type: 'add', line: snapshotLines[j] }); j++; }
    return ops;
}

// One row of the diff: kind decides how the real content is rendered
function fillDiffLineContent(row, line) {
    const slot = row.querySelector('.diff-text');
    if (!slot) return;
    switch (line.kind) {
        case 'code': {
            slot.classList.add('code');
            slot.textContent = line.sig;
            break;
        }
        case 'heading': {
            const h = document.createElement(line.tag || 'h3');
            h.innerHTML = line.html;
            slot.appendChild(h);
            break;
        }
        case 'check': {
            slot.classList.add('check');
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.className = 'checklist-checkbox';
            box.setAttribute('disabled', '');
            box.setAttribute('tabindex', '-1');
            if (line.sig.startsWith('[x]')) box.setAttribute('checked', '');
            slot.appendChild(box);
            const label = document.createElement('span');
            label.className = 'checklist-text';
            label.innerHTML = line.html;
            slot.appendChild(label);
            break;
        }
        case 'media': {
            slot.classList.add('media');
            if (line.el && line.el.getAttribute('src')) {
                const img = line.el.cloneNode(true);
                img.removeAttribute('controls');
                slot.appendChild(img);
            }
            break;
        }
        case 'table': {
            slot.classList.add('table');
            slot.style.display = 'block';
            slot.innerHTML = line.html;
            break;
        }
        case 'codeblock': {
            slot.classList.add('codeblock');
            slot.style.display = 'block';
            slot.innerHTML = line.html;
            break;
        }
        case 'p':
        case 'blockquote': {
            const block = document.createElement(line.kind);
            block.innerHTML = line.html;
            slot.appendChild(block);
            break;
        }
        case 'li': {
            const item = document.createElement('div');
            item.className = 'history-diff-list-item';
            item.innerHTML = line.html;
            slot.appendChild(item);
            break;
        }
        default: {
            // Text with inline formatting (bold, italic, code, links) from the note
            slot.innerHTML = line.html || escapeHtml(line.sig);
        }
    }
}

// GitHub-style unified diff: the whole file in one flow, changes highlighted in place.
// Green lines = added by the candidate snapshot, red lines = removed relative to the current note.
function renderHistoryDiff(container, baseLines, snapshotLines) {
    const ops = buildLineDiff(baseLines, snapshotLines);
    const added = ops.filter(o => o.type === 'add').length;
    const removed = ops.filter(o => o.type === 'del').length;

    const flow = document.createElement('div');
    flow.className = 'history-diff';
    flow.dataset.added = added;
    flow.dataset.removed = removed;

    ops.forEach(op => {
        const row = document.createElement('div');
        row.className = `diff-line ${op.type === 'add' ? 'add' : op.type === 'del' ? 'del' : 'ctx'}`;
        if (op.line && op.line.kind) row.dataset.kind = op.line.kind;

        const symbol = document.createElement('span');
        symbol.className = 'diff-symbol';
        symbol.textContent = op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' ';

        const text = document.createElement('div');
        text.className = 'diff-text';
        row.append(symbol, text);
        if (op.line) fillDiffLineContent(row, op.line);
        flow.appendChild(row);
    });
    container.appendChild(flow);
    return flow;
}

// Restore a snapshot as the current content of the note.
// The content being replaced is snapshotted first, so a restore can always be undone.
async function restoreNoteSnapshot(noteName, id) {
    const safeName = path.basename(noteName);
    const filePath = path.join(savesDir, `${safeName}.nsh`);

    const snapshotHtml = await readNoteSnapshot(safeName, id);

    let currentHtml = null;
    if (activeNoteName === safeName && hasUnsavedChanges && typeof getCleanContentHTML === 'function') {
        currentHtml = getCleanContentHTML(); // keep unsaved edits too
    } else if (fs.existsSync(filePath)) {
        currentHtml = await fsPromises.readFile(filePath, 'utf8');
    }
    if (currentHtml && currentHtml !== snapshotHtml) {
        await snapshotNote(safeName, currentHtml, { force: true });
    }

    await fsPromises.writeFile(filePath, snapshotHtml, 'utf8');
    hasUnsavedChanges = false;
    if (typeof unsavedDot !== 'undefined' && unsavedDot) unsavedDot.classList.remove('active');

    if (typeof invalidateVaultDashboardCache === 'function') invalidateVaultDashboardCache();
    await readDatabase(safeName, true);

    const item = typeof findNoteElement === 'function' ? findNoteElement(safeName) : null;
    if (item && item.classList.contains('drive-save') && typeof uploadFileToDrive === 'function') {
        uploadFileToDrive(filePath, snapshotHtml).catch(err => console.error('History restore Drive upload error:', err));
    }
}

// ---------- Version history panel ----------

let historyPanelNote = null;
let historyPanelSelectedId = null;
let historyPanelSnapshotHtml = null;
let historyPanelCurrentHtml = null;

function historyTimeLabel(timestamp) {
    return typeof formatRelativeTime === 'function'
        ? formatRelativeTime(timestamp)
        : new Date(timestamp).toLocaleString();
}

async function openNoteHistory() {
    if (!activeNoteName) {
        showToast('Open a note first', 'warning');
        return;
    }
    historyPanelNote = activeNoteName;
    historyPanelSelectedId = null;
    historyPanelSnapshotHtml = null;
    historyPanelCurrentHtml = null;

    const title = document.getElementById('history-note-name');
    if (title) title.textContent = historyPanelNote;

    await renderHistoryList();
    openModal('history-modal');
}

function renderHistoryPreview() {
    const preview = document.getElementById('history-preview');
    const stats = document.getElementById('history-preview-stats');
    if (!preview || historyPanelSnapshotHtml === null) return;

    const snapshotLines = snapshotToLines(historyPanelSnapshotHtml);
    const diff = buildHistoryRenderedPreview(preview, historyPanelSnapshotHtml, historyPanelCurrentHtml);
    if (stats) {
        const words = countWords(snapshotLines.map(l => l.sig).join('\n'));
        const wordText = `${words} words in this version`;
        if (historyPanelCurrentHtml !== null && diff) {
            const { added, removed } = diff;
            if (added === 0 && removed === 0) {
                stats.innerHTML = `<span class="history-stat-words">${wordText}</span> <span class="history-stat-sep">·</span> <span class="history-stat-same">identical to current note</span>`;
            } else {
                stats.innerHTML = `<span class="history-stat-words">${wordText}</span> <span class="history-stat-sep">·</span> <span class="history-stat-diff"><span class="history-stat-add">+${added} added</span>, <span class="history-stat-del">−${removed} removed</span></span>`;
            }
        } else {
            stats.textContent = wordText;
        }
    }
}

async function renderHistoryList() {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    const layout = document.getElementById('history-layout');
    if (!list) return;

    const entries = await listNoteHistory(historyPanelNote);
    list.textContent = '';

    if (empty) empty.style.display = entries.length ? 'none' : 'block';
    if (layout) layout.style.display = entries.length ? 'flex' : 'none';

    entries.forEach(entry => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'history-item';
        row.dataset.id = entry.id;

        const when = document.createElement('span');
        when.className = 'history-item-time';
        when.textContent = historyTimeLabel(entry.timestamp);

        const meta = document.createElement('span');
        meta.className = 'history-item-meta';
        const sizeLabel = entry.size < 1024 ? `${entry.size} B` : `${(entry.size / 1024).toFixed(1)} KB`;
        meta.textContent = `${new Date(entry.timestamp).toLocaleString()} · ${sizeLabel}`;

        row.append(when, meta);
        row.addEventListener('click', () => selectHistoryEntry(entry.id));
        list.appendChild(row);
    });

    if (entries.length) {
        await selectHistoryEntry(entries[0].id);
    } else {
        updateHistoryRestoreButton();
    }
}

function updateHistoryRestoreButton() {
    const btn = document.getElementById('history-restore-btn');
    if (btn) btn.disabled = !historyPanelSelectedId;
}

async function selectHistoryEntry(id) {
    historyPanelSelectedId = id;
    document.querySelectorAll('#history-list .history-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
    });
    updateHistoryRestoreButton();

    const preview = document.getElementById('history-preview');
    const stats = document.getElementById('history-preview-stats');
    if (!preview) return;

    try {
        const html = await readNoteSnapshot(historyPanelNote, id);
        if (historyPanelSelectedId !== id) return; // user clicked another version meanwhile

        // Render the selected snapshot as it was written.
        historyPanelSnapshotHtml = html;
        historyPanelCurrentHtml = null;
        if (activeNoteName === historyPanelNote && hasUnsavedChanges && typeof getCleanContentHTML === 'function') {
            try {
                historyPanelCurrentHtml = getCleanContentHTML();
            } catch (err) { /* fallback to file on disk */ }
        }
        if (!historyPanelCurrentHtml) {
            try {
                historyPanelCurrentHtml = await fsPromises.readFile(path.join(savesDir, `${path.basename(historyPanelNote)}.nsh`), 'utf8');
            } catch (err) { /* note may not exist on disk yet */ }
        }
        if (historyPanelSelectedId !== id) return;
        renderHistoryPreview();
    } catch (err) {
        preview.innerHTML = '';
        const em = document.createElement('em');
        em.textContent = 'Could not read this version.';
        preview.appendChild(em);
        if (stats) stats.textContent = '';
    }
}

async function restoreSelectedHistoryEntry() {
    if (!historyPanelNote || !historyPanelSelectedId) return;
    const label = historyTimeLabel(Number(historyPanelSelectedId));
    try {
        await restoreNoteSnapshot(historyPanelNote, historyPanelSelectedId);
        closeAllModals();
        showToast(`Restored version from ${label}. Your previous text is in history too.`, 'success');
    } catch (err) {
        console.error('Error restoring version:', err);
        showToast('Could not restore this version', 'error');
    }
}
