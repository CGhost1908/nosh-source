// Real-time Sidebar Notes Search & Full-Text Content Search + Tag Taxonomy (#tags)

const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const sidebarEmptyState = document.getElementById('sidebar-empty');
const sidebarTagsBar = document.getElementById('sidebar-tags-bar');

// In-memory cache of note text content for instant search
const noteContentCache = new Map();

// Active Tag Filter
let activeTagFilter = null;
let vaultTagsMap = new Map(); // tag -> Set of note names

async function loadNoteContentForSearch(fileName) {
    if (!savesDir || !fileName) return '';
    if (noteContentCache.has(fileName)) {
        return noteContentCache.get(fileName);
    }
    try {
        const filePath = path.join(savesDir, `${fileName}.nsh`);
        if (fs.existsSync(filePath)) {
            const html = await fsPromises.readFile(filePath, 'utf8');
            const temp = document.createElement('div');
            temp.innerHTML = html;

            // Strip action buttons & UI artifacts before extracting searchable text
            temp.querySelectorAll('.code-block-actions, .code-window-dots, script, style').forEach(el => el.remove());

            // Extract language tags & attributes so searching e.g. "python", "rust" finds code blocks
            let langTags = [];
            temp.querySelectorAll('.lang-name, textarea[language]').forEach(el => {
                const lang = el.textContent || el.getAttribute('language') || '';
                if (lang && !langTags.includes(lang)) langTags.push(lang);
            });

            let text = temp.innerText || temp.textContent || '';
            temp.querySelectorAll('textarea').forEach(ta => {
                text += ' ' + (ta.value || ta.textContent || '');
            });

            if (langTags.length > 0) {
                text += ' ' + langTags.join(' ');
            }

            text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
            noteContentCache.set(fileName, text);
            return text;
        }
    } catch (e) {
        console.error(`Failed to load note content for search: ${fileName}`, e);
    }
    return '';
}

function updateNoteSearchCache(fileName, newContentText) {
    if (fileName && typeof newContentText === 'string') {
        noteContentCache.set(fileName, newContentText);
    }
}

function removeNoteFromSearchCache(fileName) {
    if (fileName) {
        noteContentCache.delete(fileName);
    }
}

let searchDebounceTimer = null;

if (searchInput) {
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();

        if (searchClearBtn) {
            searchClearBtn.classList.toggle('visible', query.length > 0);
        }

        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            applyCombinedSidebarFilter();
        }, 60);
    });
}

// Prevent click on clear button from stealing focus
if (searchClearBtn) {
    searchClearBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });
    searchClearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        searchInput.value = '';
        searchClearBtn.classList.remove('visible');
        applyCombinedSidebarFilter();
        searchInput.focus();
    });
}

// Clicking anywhere on the search box focuses the input
const searchBox = document.querySelector('.search-box');
if (searchBox) {
    searchBox.addEventListener('click', (e) => {
        if (e.target !== searchClearBtn && searchInput) {
            searchInput.focus();
        }
    });
}

async function filterSidebarNotes(query) {
    return applyCombinedSidebarFilter();
}

async function applyCombinedSidebarFilter() {
    const isSearchFocused = (document.activeElement === searchInput);
    const selStart = searchInput ? searchInput.selectionStart : null;
    const selEnd = searchInput ? searchInput.selectionEnd : null;

    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const saves = document.querySelectorAll('#saves-container .save');
    let visibleCount = 0;

    function highlightMatchText(originalText, q) {
        if (!q || !originalText) return escapeHtml(originalText);
        const safeQuery = escapeHtml(q);
        const safeText = escapeHtml(originalText);
        const regex = new RegExp(`(${safeQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return safeText.replace(regex, '<mark class="title-mark">$1</mark>');
    }

    // Warm cache in parallel for uncached notes if query is present
    if (query) {
        const uncached = [];
        for (const save of saves) {
            const fn = save.getAttribute('data-file');
            if (fn && !noteContentCache.has(fn)) uncached.push(fn);
        }
        if (uncached.length > 0) {
            await Promise.all(uncached.map(fn => loadNoteContentForSearch(fn)));
        }
    }

    for (const save of saves) {
        const fileName = save.getAttribute('data-file') || '';
        const title = fileName.toLowerCase();
        const titleEl = save.querySelector('.save-title');

        // Check Tag Filter
        if (activeTagFilter) {
            const matchingNotes = vaultTagsMap.get(activeTagFilter);
            if (!matchingNotes || !matchingNotes.has(fileName)) {
                save.classList.add('hidden');
                continue;
            }
        }

        let snippet = save.querySelector('.save-snippet');
        if (snippet) snippet.remove();

        if (!query) {
            save.classList.remove('hidden');
            if (titleEl) titleEl.textContent = fileName;
            visibleCount++;
            continue;
        }

        const titleMatch = title.includes(query);
        if (titleMatch) {
            save.classList.remove('hidden');
            if (titleEl) titleEl.innerHTML = highlightMatchText(fileName, query);
            visibleCount++;
        } else {
            if (titleEl) titleEl.textContent = fileName;

            // Check note full text content
            const contentText = await loadNoteContentForSearch(fileName);
            const lowerContent = contentText.toLowerCase();
            const idx = lowerContent.indexOf(query);

            if (idx !== -1) {
                save.classList.remove('hidden');
                visibleCount++;

                // Extract a clean 50-char excerpt around the match
                const start = Math.max(0, idx - 18);
                const end = Math.min(contentText.length, idx + query.length + 32);
                let excerpt = contentText.substring(start, end).replace(/[\r\n\t]+/g, ' ').trim();
                if (start > 0) excerpt = '...' + excerpt;
                if (end < contentText.length) excerpt = excerpt + '...';

                snippet = document.createElement('div');
                snippet.className = 'save-snippet';
                snippet.innerHTML = highlightMatchText(excerpt, query);
                save.appendChild(snippet);
            } else {
                save.classList.add('hidden');
            }
        }
    }

    if (sidebarEmptyState) {
        sidebarEmptyState.style.display = (visibleCount === 0 && saves.length > 0) ? 'flex' : 'none';
    }

    // Update folder visibility & auto-expand matching folders during search
    const folders = document.querySelectorAll('.sidebar-folder');
    folders.forEach(folderEl => {
        const visibleNotes = folderEl.querySelectorAll('.sidebar-folder-items .save:not(.hidden)');
        if (query || activeTagFilter) {
            if (visibleNotes.length > 0) {
                folderEl.style.display = '';
                folderEl.classList.remove('collapsed');
            } else {
                folderEl.style.display = 'none';
            }
        } else {
            folderEl.style.display = '';
            const folderId = folderEl.getAttribute('data-folder-id');
            const folderData = typeof getVaultFolderById === 'function' ? getVaultFolderById(folderId) : null;
            if (folderData && folderData.collapsed) {
                folderEl.classList.add('collapsed');
            } else {
                folderEl.classList.remove('collapsed');
            }
        }
    });

    // Preserve focus & cursor on search input during live filtering
    if (isSearchFocused && searchInput && document.activeElement !== searchInput) {
        searchInput.focus();
        if (selStart !== null && selEnd !== null) {
            searchInput.setSelectionRange(selStart, selEnd);
        }
    }
}

// ==========================================================================
// Tag Taxonomy & Filtering (Disabled - Tag Bar Removed from Sidebar)
// ==========================================================================
async function updateVaultTags() {
    activeTagFilter = null;
}

function renderSidebarTags() {
    const bar = document.getElementById('sidebar-tags-bar');
    if (bar) bar.remove();
}

function filterByTag(tag) {
    activeTagFilter = null;
    applyCombinedSidebarFilter();
}

