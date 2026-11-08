// Save & Notes File Management

async function invokeSavesDir() {
    const customPath = localStorage.getItem('saves-path');
    if (customPath && customPath !== 'null' && fs.existsSync(customPath)) {
        savesDir = customPath;
    } else {
        // The main process decides the default notes folder (the page has no access to the environment)
        savesDir = await ipcRenderer.invoke('get-save-path');
        localStorage.setItem('saves-path', savesDir);
    }

    if (!fs.existsSync(savesDir)) {
        try {
            fs.mkdirSync(savesDir, { recursive: true });
        } catch (e) {}
    }

    const savePathInput = document.getElementById('setting-save-path');
    if (savePathInput) savePathInput.value = savesDir;
    return savesDir;
}

let initialAppReadySent = false;
function notifyAppReady() {
    if (!initialAppReadySent && typeof ipcRenderer !== 'undefined' && ipcRenderer.send) {
        initialAppReadySent = true;
        ipcRenderer.send('app-ready');
    }
}

// Read database and populate sidebar notes
async function readDatabase(fileToSelect, forceSelect = false) {
    const isInitialLoad = !initialAppReadySent;
    if (isInitialLoad && typeof showSidebarSkeleton === 'function') {
        showSidebarSkeleton();
    }

    const minDelayPromise = isInitialLoad ? new Promise(r => setTimeout(r, 220)) : Promise.resolve();
    await invokeSavesDir();

    try {
        const [files] = await Promise.all([
            fsPromises.readdir(savesDir),
            minDelayPromise
        ]);
        const nshFiles = files.filter(f => path.extname(f).toLowerCase() === '.nsh');

        const savesContainer = document.getElementById('saves-container');
        if (savesContainer) savesContainer.innerHTML = '';

        if (typeof hideSidebarSkeleton === 'function') {
            hideSidebarSkeleton();
        }

        const notesCountBadge = document.getElementById('notes-count');
        if (notesCountBadge) notesCountBadge.textContent = nshFiles.length;

        // Fetch file stats for last modified date
        const fileStats = await Promise.all(nshFiles.map(async (file) => {
            const fileName = path.basename(file, '.nsh');
            const filePath = path.join(savesDir, file);
            try {
                const stat = await fsPromises.stat(filePath);
                return { fileName, mtimeMs: stat.mtimeMs };
            } catch (e) {
                return { fileName, mtimeMs: 0 };
            }
        }));

        if (typeof renderSidebarWithFolders === 'function') {
            await renderSidebarWithFolders(fileStats);
        } else {
            fileStats.forEach((item, idx) => {
                createNoteSidebarElement(item.fileName, item.mtimeMs, idx);
            });
            sortSaves();
        }
        if (typeof updateVaultTags === 'function') {
            updateVaultTags();
        }

        // If fileToSelect is specified, open it
        if (fileToSelect && nshFiles.includes(`${fileToSelect}.nsh`)) {
            await openDesiredFile(fileToSelect, false, forceSelect);
        } else if (activeNoteName && nshFiles.includes(`${activeNoteName}.nsh`)) {
            // Keep active note selected
            const activeEl = document.querySelector(`.save[data-file="${activeNoteName}"]`);
            if (activeEl) activeEl.classList.add('active');
        } else {
            // Open welcome dashboard
            await showWelcomeDashboard();
        }

        notifyAppReady();

        // Check Google Drive sync states if drive token is available
        const hasDriveAuth = (localStorage.getItem('google_drive_access_token') && localStorage.getItem('google_drive_access_token') !== 'null') ||
                             (localStorage.getItem('google_drive_refresh_token') && localStorage.getItem('google_drive_refresh_token') !== 'null');
        if (hasDriveAuth) {
            if (typeof getNoshFilesFromDrive === 'function') {
                getNoshFilesFromDrive();
            }
        }
    } catch (err) {
        console.error('Error reading notes database:', err);
        showToast('Error reading notes directory', 'error');
        await showWelcomeDashboard();
        notifyAppReady();
    }
}

// Pinned Notes Management
function getPinnedNotes() {
    try {
        const raw = localStorage.getItem('nosh-pinned-notes');
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function isNotePinned(fileName) {
    const pinned = getPinnedNotes();
    return pinned.includes(fileName);
}

function togglePinNote(fileName) {
    if (!fileName) return;
    let pinned = getPinnedNotes();
    const isPinned = pinned.includes(fileName);
    if (isPinned) {
        pinned = pinned.filter(n => n !== fileName);
        showToast(`Unpinned "${fileName}"`, 'info');
    } else {
        pinned.unshift(fileName);
        showToast(`Pinned "${fileName}" to top`, 'success');
    }
    localStorage.setItem('nosh-pinned-notes', JSON.stringify(pinned));

    const saveEl = document.querySelector(`.save[data-file="${fileName}"]`);
    if (saveEl) {
        if (!isPinned) {
            saveEl.classList.add('pinned');
            const pinBtn = saveEl.querySelector('.save-pin-quick iconify-icon');
            if (pinBtn) pinBtn.setAttribute('icon', 'solar:pin-bold');
            const pinBtnEl = saveEl.querySelector('.save-pin-quick');
            if (pinBtnEl) pinBtnEl.title = 'Unpin note';
        } else {
            saveEl.classList.remove('pinned');
            const pinBtn = saveEl.querySelector('.save-pin-quick iconify-icon');
            if (pinBtn) pinBtn.setAttribute('icon', 'solar:pin-linear');
            const pinBtnEl = saveEl.querySelector('.save-pin-quick');
            if (pinBtnEl) pinBtnEl.title = 'Pin note';
        }
    }
    sortSaves();
    if (typeof window.scheduleAuthTokenVaultPush === 'function') {
        window.scheduleAuthTokenVaultPush();
    }
}

function createNoteSidebarElement(fileName, mtimeMs = 0, index = 0, parentContainer = null) {
    const targetContainer = parentContainer || document.getElementById('saves-container');
    if (!targetContainer) return;
    const isPinned = isNotePinned(fileName);

    const saveItem = document.createElement('div');
    saveItem.className = `save${isPinned ? ' pinned' : ''} note-item-appear`;
    if (typeof index === 'number' && index >= 0) {
        saveItem.style.animationDelay = `${Math.min(index * 0.025, 0.35)}s`;
    }
    saveItem.setAttribute('data-file', fileName);
    saveItem.setAttribute('file-name', fileName);
    saveItem.setAttribute('data-note-name', fileName);
    if (mtimeMs) {
        saveItem.setAttribute('data-mtime', mtimeMs);
    }

    // Drag-and-drop support: drag note into folders or root
    saveItem.setAttribute('draggable', 'true');
    saveItem.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        const currentFileName = saveItem.getAttribute('data-file') || fileName;
        window._draggedNoteName = currentFileName;
        if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', currentFileName);
            e.dataTransfer.setData('text/nosh-note', currentFileName);
            e.dataTransfer.effectAllowed = 'copyMove';
        }
        saveItem.classList.add('is-dragging');
        document.body.classList.add('is-dragging-note');
    });

    saveItem.addEventListener('dragend', () => {
        window._draggedNoteName = null;
        saveItem.classList.remove('is-dragging');
        document.body.classList.remove('is-dragging-note');
        document.querySelectorAll('.drag-over, .drag-over-folder').forEach(el => {
            el.classList.remove('drag-over', 'drag-over-folder');
        });
    });

    saveItem.innerHTML = `
        <div class="save-info">
            <iconify-icon class="save-icon" icon="solar:document-text-linear"></iconify-icon>
            <span class="save-title">${escapeHtml(fileName)}</span>
        </div>
        <div class="save-actions">
            <button class="save-pin-quick" title="${isPinned ? 'Unpin note' : 'Pin note'}" onclick="event.stopPropagation(); togglePinNote(this.closest('.save')?.getAttribute('data-file') || '${escapeHtml(fileName)}')">
                <iconify-icon icon="${isPinned ? 'solar:pin-bold' : 'solar:pin-linear'}"></iconify-icon>
            </button>
            <iconify-icon class="save-cloud-icon" icon="logos:google-drive" title="Synced with Google Drive"></iconify-icon>
        </div>
    `;

    saveItem.addEventListener('click', () => {
        const currentFileName = saveItem.getAttribute('data-file') || fileName;
        openDesiredFile(currentFileName);
    });

    targetContainer.appendChild(saveItem);
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Dashboard Cache & Helpers
let vaultDashboardCache = null;
let vaultDashboardCacheTime = 0;

function invalidateVaultDashboardCache() {
    vaultDashboardCache = null;
    vaultDashboardCacheTime = 0;
}

function formatRelativeTime(date) {
    if (!date) return '';
    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHour / 24);

    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${pad(then.getHours())}:${pad(then.getMinutes())}`;

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;

    const isToday = now.toDateString() === then.toDateString();
    if (isToday) return `Today at ${timeStr}`;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (yesterday.toDateString() === then.toDateString()) return `Yesterday at ${timeStr}`;

    if (diffDays < 7) return `${diffDays}d ago`;

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${then.getDate()} ${months[then.getMonth()]}`;
}

function triggerDashboardSearch() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('collapsed')) {
        if (typeof toggleSidebar === 'function') toggleSidebar();
    }
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.focus();
        searchInput.select();
    }
}

const DASH_LANG_META = {
    'Python': { color: '#3572A5', icon: 'logos:python' },
    'JavaScript': { color: '#f1e05a', icon: 'logos:javascript' },
    'TypeScript': { color: '#3178c6', icon: 'logos:typescript-icon' },
    'Rust': { color: '#dea584', icon: 'logos:rust' },
    'Go': { color: '#00ADD8', icon: 'logos:go' },
    'C++': { color: '#f34b7d', icon: 'logos:c-plusplus' },
    'C': { color: '#555555', icon: 'logos:c' },
    'C#': { color: '#178600', icon: 'logos:c-sharp' },
    'Java': { color: '#b07219', icon: 'logos:java' },
    'Kotlin': { color: '#A97BFF', icon: 'logos:kotlin-icon' },
    'Dart': { color: '#00B4AB', icon: 'logos:dart' },
    'Swift': { color: '#F05138', icon: 'logos:swift' },
    'HTML': { color: '#e34c26', icon: 'logos:html-5' },
    'CSS': { color: '#563d7c', icon: 'logos:css-3' },
    'SQL': { color: '#e38c00', icon: 'vscode-icons:file-type-sql' },
    'Shell': { color: '#89e051', icon: 'logos:bash-icon' },
    'PHP': { color: '#4F5D95', icon: 'logos:php' },
    'Ruby': { color: '#701516', icon: 'logos:ruby' },
    'JSON': { color: '#cbcb41', icon: 'vscode-icons:file-type-json' },
    'YAML': { color: '#cb171e', icon: 'vscode-icons:file-type-yaml' },
    'Markdown': { color: '#083fa1', icon: 'logos:markdown' },
    'Vue': { color: '#41b883', icon: 'logos:vue' },
    'React': { color: '#61dafb', icon: 'logos:react' },
    'Lua': { color: '#000080', icon: 'logos:lua' },
    'R': { color: '#198CE7', icon: 'logos:r-lang' },
    'Other': { color: '#8b949e', icon: 'solar:code-square-bold-duotone' }
};

function normalizeDashboardLang(raw) {
    if (!raw) return 'Other';
    const lower = raw.trim().toLowerCase();
    if (lower === 'python' || lower === 'py' || lower === 'text/x-python') return 'Python';
    if (lower === 'javascript' || lower === 'js') return 'JavaScript';
    if (lower === 'typescript' || lower === 'ts') return 'TypeScript';
    if (lower === 'rust' || lower === 'rs') return 'Rust';
    if (lower === 'go' || lower === 'golang') return 'Go';
    if (lower.includes('c++') || lower === 'cpp' || lower === 'text/x-c++src') return 'C++';
    if (lower === 'c' || lower === 'text/x-csrc') return 'C';
    if (lower === 'c#' || lower === 'csharp' || lower === 'cs' || lower === 'text/x-csharp') return 'C#';
    if (lower === 'java' || lower === 'text/x-java') return 'Java';
    if (lower === 'kotlin' || lower === 'kt' || lower === 'text/x-kotlin') return 'Kotlin';
    if (lower === 'dart') return 'Dart';
    if (lower === 'swift') return 'Swift';
    if (lower === 'html' || lower === 'htmlmixed') return 'HTML';
    if (lower === 'css' || lower === 'scss' || lower === 'sass' || lower === 'less') return 'CSS';
    if (lower === 'sql') return 'SQL';
    if (lower === 'shell' || lower === 'bash' || lower === 'sh' || lower === 'zsh') return 'Shell';
    if (lower === 'php') return 'PHP';
    if (lower === 'ruby' || lower === 'rb') return 'Ruby';
    if (lower === 'json') return 'JSON';
    if (lower === 'yaml' || lower === 'yml') return 'YAML';
    if (lower === 'markdown' || lower === 'md') return 'Markdown';
    if (lower === 'vue') return 'Vue';
    if (lower === 'react' || lower === 'jsx' || lower === 'tsx') return 'React';
    if (lower === 'lua') return 'Lua';
    if (lower === 'r') return 'R';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

async function getVaultDashboardData() {
    const now = Date.now();
    if (vaultDashboardCache && (now - vaultDashboardCacheTime < 3000)) {
        return vaultDashboardCache;
    }

    await invokeSavesDir();
    const files = await fsPromises.readdir(savesDir);
    const nshFiles = files.filter(f => path.extname(f).toLowerCase() === '.nsh');

    const langCounts = {};
    let totalCodeBlocks = 0;

    await Promise.all(nshFiles.map(async (file) => {
        const filePath = path.join(savesDir, file);
        try {
            const noteContent = await fsPromises.readFile(filePath, 'utf8');
            const taRegex = /<textarea[^>]*class=["'][^"']*code[^"']*["'][^>]*>/gi;
            let match;
            while ((match = taRegex.exec(noteContent)) !== null) {
                totalCodeBlocks++;
                const tag = match[0];
                const langMatch = tag.match(/language=["']([^"']+)["']/i);
                const dataMatch = tag.match(/data-label=["']([^"']+)["']/i);
                const raw = (langMatch && langMatch[1]) || (dataMatch && dataMatch[1]) || 'other';
                const norm = normalizeDashboardLang(raw);
                langCounts[norm] = (langCounts[norm] || 0) + 1;
            }
        } catch (e) {
            console.error('Error reading note for dashboard:', file, e);
        }
    }));

    const languages = Object.entries(langCounts)
        .map(([name, count]) => {
            const meta = DASH_LANG_META[name] || DASH_LANG_META.Other;
            return {
                name,
                count,
                percentage: totalCodeBlocks > 0 ? parseFloat(((count / totalCodeBlocks) * 100).toFixed(1)) : 0,
                color: meta.color,
                icon: meta.icon
            };
        })
        .sort((a, b) => b.count - a.count);

    const hasDriveAuth = !!((localStorage.getItem('google_drive_access_token') && localStorage.getItem('google_drive_access_token') !== 'null') ||
                          (localStorage.getItem('google_drive_refresh_token') && localStorage.getItem('google_drive_refresh_token') !== 'null'));

    const data = {
        totalNotes: nshFiles.length,
        totalCodeBlocks,
        languages,
        primaryLanguage: languages[0] || null,
        hasDriveAuth
    };

    vaultDashboardCache = data;
    vaultDashboardCacheTime = Date.now();
    return data;
}

function renderWelcomeDashboardUI(data) {
    const { totalNotes, totalCodeBlocks, languages, hasDriveAuth } = data;

    const languagesSection = languages.length > 0 ? `
        <div class="github-lang-card">
            <div class="github-lang-header">
                <span class="github-lang-title">Languages</span>
                <span class="github-lang-meta">${totalCodeBlocks} code blocks (${languages.length} languages)</span>
            </div>
            <div class="github-lang-progress-bar">
                ${languages.map(l => `
                    <span class="github-lang-progress-item" 
                          data-lang="${escapeHtml(l.name)}"
                          data-color="${l.color}"
                          data-count="${l.count}"
                          data-percent="${l.percentage}"
                          style="width: ${l.percentage}%; --item-color: ${l.color}; background-color: ${l.color};" 
                          title="${escapeHtml(l.name)}: ${l.percentage}% (${l.count} blocks) • Click to filter"></span>
                `).join('')}
            </div>
            <ul class="github-lang-list">
                ${languages.map(l => `
                    <li class="github-lang-item" 
                        data-lang="${escapeHtml(l.name)}"
                        data-color="${l.color}"
                        data-count="${l.count}"
                        data-percent="${l.percentage}"
                        style="--item-color: ${l.color};"
                        title="Filter notes with ${escapeHtml(l.name)} (${l.count} code blocks)">
                        <span class="github-lang-dot" style="background-color: ${l.color};"></span>
                        <iconify-icon class="github-lang-icon" icon="${l.icon || 'solar:code-square-bold-duotone'}"></iconify-icon>
                        <span class="github-lang-name">${escapeHtml(l.name)}</span>
                        <span class="github-lang-percent">${l.percentage}%</span>
                    </li>
                `).join('')}
            </ul>
        </div>
    ` : '';

    content.innerHTML = `
        <div class="welcome-dashboard">
            <div class="welcome-hero">
                <div class="hero-logo-wrap">
                    <img src="icon.png" class="hero-icon" alt="Nosh">
                </div>
                <h1 class="hero-title">Welcome to Nosh</h1>
                <p class="hero-subtitle">A high-craft, distraction-free note & code workstation built for programmers and thinkers.</p>
            </div>

            <div class="dash-stats-row">
                <div class="dash-stat-pill" title="Total saved notes (sorted by last modified in sidebar)">
                    <div class="stat-icon-wrap notes">
                        <iconify-icon icon="solar:documents-minimalistic-bold-duotone"></iconify-icon>
                    </div>
                    <div class="stat-info">
                        <span class="stat-number">${totalNotes}</span>
                        <span class="stat-label">Notes in Vault</span>
                    </div>
                </div>
                <div class="dash-stat-pill" title="Total embedded code snippets">
                    <div class="stat-icon-wrap code">
                        <iconify-icon icon="solar:code-square-bold-duotone"></iconify-icon>
                    </div>
                    <div class="stat-info">
                        <span class="stat-number">${totalCodeBlocks}</span>
                        <span class="stat-label">Code Blocks</span>
                    </div>
                </div>
                <div class="dash-stat-pill" title="Cloud backup status">
                    <div class="stat-icon-wrap drive ${hasDriveAuth ? 'connected' : 'offline'}">
                        <iconify-icon icon="${hasDriveAuth ? 'solar:cloud-check-bold-duotone' : 'solar:cloud-cross-bold-duotone'}"></iconify-icon>
                    </div>
                    <div class="stat-info">
                        <span class="stat-number" style="font-size: 14px;">${hasDriveAuth ? 'Synced' : 'Local Only'}</span>
                        <span class="stat-label">Google Drive</span>
                    </div>
                </div>
            </div>

            ${languagesSection}

            <div class="quick-action-cards">
                <div class="quick-card" onclick="createNewFile()">
                    <div class="card-icon-wrap primary">
                        <iconify-icon class="card-icon" icon="solar:document-add-linear"></iconify-icon>
                    </div>
                    <div class="card-title">New Note</div>
                    <div class="card-desc">Create a new empty note with rich formatting & code blocks.</div>
                    <span class="card-badge">Ctrl + N</span>
                </div>

                <div class="quick-card" onclick="openFileFromSystem()">
                    <div class="card-icon-wrap">
                        <iconify-icon class="card-icon" icon="solar:folder-open-linear"></iconify-icon>
                    </div>
                    <div class="card-title">Open Note</div>
                    <div class="card-desc">Open an existing .nsh note file from your computer.</div>
                    <span class="card-badge">Ctrl + O</span>
                </div>

                <div class="quick-card" onclick="openSettingsModal()">
                    <div class="card-icon-wrap">
                        <iconify-icon class="card-icon" icon="solar:tuning-2-linear"></iconify-icon>
                    </div>
                    <div class="card-title">Preferences</div>
                    <div class="card-desc">Customize typography, code themes, Drive & YouTube player.</div>
                    <span class="card-badge">Ctrl + ,</span>
                </div>
            </div>

            <div class="shortcuts-panel">
                <h4>Productivity Shortcuts</h4>
                <div class="shortcuts-grid">
                    <div class="shortcut-row"><span>New Note</span><span class="kbd">Ctrl + N</span></div>
                    <div class="shortcut-row"><span>Save Note</span><span class="kbd">Ctrl + S</span></div>
                    <div class="shortcut-row"><span>Search Notes</span><span class="kbd">Ctrl + F</span></div>
                    <div class="shortcut-row"><span>Command Palette</span><span class="kbd">Ctrl + K</span></div>
                    <div class="shortcut-row"><span>Toggle Sidebar</span><span class="kbd">Ctrl + \\</span></div>
                    <div class="shortcut-row"><span>Exit Code Block</span><span class="kbd">Shift + Enter</span></div>
                </div>
            </div>
        </div>
    `;

    // Initialize micro-interactions & animations
    initWelcomeDashboardInteractions(data);
}

// Micro-interactions and animated cross-linking for Dashboard
function initWelcomeDashboardInteractions(data) {
    const { totalCodeBlocks, languages } = data;
    const langCard = document.querySelector('.github-lang-card');
    const metaEl = document.querySelector('.github-lang-meta');
    const defaultMetaText = `${totalCodeBlocks} code blocks (${languages ? languages.length : 0} languages)`;

    // 1. Interactive Spotlight Glow Tracking on Cards (Raycast/Linear style)
    const cards = document.querySelectorAll('.github-lang-card, .dash-stat-pill, .quick-card, .shortcuts-panel');
    cards.forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
            card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        });
        card.addEventListener('mouseleave', () => {
            card.style.removeProperty('--mouse-x');
            card.style.removeProperty('--mouse-y');
        });
    });

    if (!langCard) return;

    // 2. Cross-hover linking & Click-to-filter for Languages
    const progressSegments = langCard.querySelectorAll('.github-lang-progress-item');
    const legendItems = langCard.querySelectorAll('.github-lang-item');

    function highlightLanguage(langName, langColor, langCount, langPercent) {
        langCard.classList.add('has-lang-hover');

        progressSegments.forEach(seg => {
            const match = seg.dataset.lang === langName;
            seg.classList.toggle('is-hovered', match);
        });

        legendItems.forEach(item => {
            const match = item.dataset.lang === langName;
            item.classList.toggle('is-hovered', match);
        });

        if (metaEl) {
            metaEl.innerHTML = `<span style="color: ${langColor}; font-weight: 700;">● ${escapeHtml(langName)}</span> <span style="color: var(--text-primary); font-weight: 600;">${langCount} blocks</span> <span style="color: var(--text-muted);">(${langPercent}%)</span> <span style="opacity: 0.65; font-size: 10px;">• Click to filter</span>`;
        }
    }

    function resetLanguageHighlight() {
        langCard.classList.remove('has-lang-hover');
        progressSegments.forEach(seg => seg.classList.remove('is-hovered'));
        legendItems.forEach(item => item.classList.remove('is-hovered'));
        if (metaEl) {
            metaEl.textContent = defaultMetaText;
        }
    }

    function filterByLang(langName) {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = langName;
            const clearBtn = document.getElementById('search-clear-btn');
            if (clearBtn) clearBtn.classList.add('visible');
            if (typeof applyCombinedSidebarFilter === 'function') {
                applyCombinedSidebarFilter();
            }
            searchInput.focus();
            if (typeof showSaveStatus === 'function') {
                showSaveStatus(`Filtered notes with ${langName}`, false);
            }
        }
    }

    progressSegments.forEach(seg => {
        const { lang, color, count, percent } = seg.dataset;
        seg.addEventListener('mouseenter', () => highlightLanguage(lang, color, count, percent));
        seg.addEventListener('mouseleave', resetLanguageHighlight);
        seg.addEventListener('click', () => filterByLang(lang));
    });

    legendItems.forEach(item => {
        const { lang, color, count, percent } = item.dataset;
        item.addEventListener('mouseenter', () => highlightLanguage(lang, color, count, percent));
        item.addEventListener('mouseleave', resetLanguageHighlight);
        item.addEventListener('click', () => filterByLang(lang));
    });
}

// Show Welcome / Home Dashboard
async function showWelcomeDashboard() {
    activeNoteName = null;
    hasUnsavedChanges = false;
    if (unsavedDot) unsavedDot.classList.remove('active');

    document.querySelectorAll('.save').forEach(el => el.classList.remove('active'));

    textTitle.textContent = 'Home';
    activeDocTitle.textContent = 'Welcome';

    content.setAttribute('contenteditable', 'false');

    const driveSyncBtn = document.getElementById('drive-sync-btn');
    if (driveSyncBtn) driveSyncBtn.style.display = 'none';

    const deleteBtn = document.getElementById('delete-note-btn');
    if (deleteBtn) deleteBtn.style.display = 'none';

    const shareBtn = document.getElementById('share-file');
    if (shareBtn) shareBtn.style.display = 'none';

    const historyBtn = document.getElementById('history-btn');
    if (historyBtn) historyBtn.style.display = 'none';

    if (typeof updatePublishButtonState === 'function') {
        updatePublishButtonState();
    }

    // Display smooth dashboard skeleton while vault stats are computed
    const now = Date.now();
    if (!vaultDashboardCache || (now - vaultDashboardCacheTime >= 3000)) {
        if (typeof showDashboardSkeleton === 'function') {
            showDashboardSkeleton();
        }
    }

    try {
        const data = await getVaultDashboardData();
        renderWelcomeDashboardUI(data);
    } catch (err) {
        console.error('Error displaying welcome dashboard:', err);
        content.innerHTML = welcomeDashboard;
    }
}

// Open Note File
async function openDesiredFile(noteName, bypassUnsavedCheck = false, forceReload = false) {
    if (!noteName) return;

    const safeName = path.basename(noteName);

    // The note is already open in the editor: keep its current state (draft included),
    // don't reload and don't prompt - reopening the active note is a no-op
    if (!forceReload && activeNoteName === safeName) {
        const activeItem = typeof findNoteElement === 'function' ? findNoteElement(safeName) : null;
        if (activeItem) activeItem.classList.add('active');
        return;
    }

    // Switching to a different note while this one has unsaved changes: ask first
    if (!bypassUnsavedCheck && hasUnsavedChanges && activeNoteName) {
        promptUnsavedChanges(() => {
            openDesiredFile(noteName, true);
        });
        return;
    }

    const filePath = path.join(savesDir, `${safeName}.nsh`);

    try {
        if (!fs.existsSync(filePath)) {
            showToast(`Note "${noteName}" not found on disk`, 'error');
            await readDatabase();
            return;
        }

        // Show realistic document skeleton while note is loaded and parsed
        if (typeof showDocumentSkeleton === 'function') {
            showDocumentSkeleton(safeName);
        }

        const data = await fsPromises.readFile(filePath, 'utf8');

        activeNoteName = safeName;
        hasUnsavedChanges = false;
        if (unsavedDot) unsavedDot.classList.remove('active');

        content.innerHTML = data;
        content.setAttribute('contenteditable', 'true');
        if (typeof ensureNoteFirstHeader === 'function') {
            ensureNoteFirstHeader(content, safeName, true);
        }

        textTitle.textContent = safeName;
        activeDocTitle.textContent = safeName;

        document.querySelectorAll('.save').forEach(el => el.classList.remove('active'));
        const activeItem = typeof findNoteElement === 'function' ? findNoteElement(safeName) : document.querySelector(`.save[data-file="${safeName}"]`);
        if (activeItem) activeItem.classList.add('active');

        // Show editor action buttons
        const driveSyncBtn = document.getElementById('drive-sync-btn');
        if (driveSyncBtn) driveSyncBtn.style.display = 'inline-flex';

        const deleteBtn = document.getElementById('delete-note-btn');
        if (deleteBtn) deleteBtn.style.display = 'inline-flex';

        const shareBtn = document.getElementById('share-file');
        if (shareBtn) shareBtn.style.display = 'inline-flex';

        const historyBtn = document.getElementById('history-btn');
        if (historyBtn) historyBtn.style.display = 'inline-flex';

        // Check Drive Sync UI for this note
        updateDriveSyncButtonState(activeItem?.classList.contains('drive-save'));

        // Check Published status for this note
        if (typeof updatePublishButtonState === 'function') {
            updatePublishButtonState();
        }

        // Process code blocks, checklists, media and internal links inside the note
        setTimeout(() => {
            processCodeBlock();
            if (typeof processChecklists === 'function') {
                processChecklists();
            }
            if (typeof processLoadedMedia === 'function') {
                processLoadedMedia();
            }
            if (typeof processInternalLinks === 'function') {
                processInternalLinks();
            }
            if (typeof processMathFormulas === 'function') {
                processMathFormulas();
            }
            if (typeof updateStatusBarStats === 'function') {
                updateStatusBarStats();
            }
            if (typeof updateBacklinksUI === 'function') {
                updateBacklinksUI();
            }
            if (typeof populateDocumentOutline === 'function') {
                populateDocumentOutline();
            }
        }, 30);
    } catch (err) {
        console.error('Error opening file:', err);
        showToast('Error opening note file', 'error');
    }
}

// Create New Note
async function createNewFile() {
    await invokeSavesDir();

    try {
        const files = await fsPromises.readdir(savesDir);
        const untitledFiles = files.filter(f => f.startsWith('Untitled') && path.extname(f).toLowerCase() === '.nsh');

        let maxNum = 0;
        untitledFiles.forEach(file => {
            const match = file.match(/Untitled\s*(\d+)\.nsh/i);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        });

        const newFileName = `Untitled ${maxNum + 1}`;
        const newFilePath = path.join(savesDir, `${newFileName}.nsh`);
        const initialContent = `<h1>${newFileName}</h1><p>Start writing your note or insert code blocks...</p>`;

        await fsPromises.writeFile(newFilePath, initialContent, 'utf8');
        invalidateVaultDashboardCache();

        await readDatabase(newFileName);
        showToast(`Created ${newFileName}`, 'success');
        if (typeof window.scheduleAuthTokenVaultPush === 'function') {
            window.scheduleAuthTokenVaultPush();
        }

        // Focus content and select text after title
        setTimeout(() => {
            if (content) {
                content.focus();
            }
        }, 100);
    } catch (err) {
        console.error('Error creating new note:', err);
        showToast('Failed to create new note', 'error');
    }
}

// Delete Note (Moves to .trash by default, permanent delete if specified)
async function deleteSave(noteName, permanent = false) {
    if (!noteName) return;

    const safeName = path.basename(noteName);
    const filePath = path.join(savesDir, `${safeName}.nsh`);

    try {
        if (permanent) {
            if (fs.existsSync(filePath)) {
                await fsPromises.unlink(filePath);
            }
            if (typeof deleteNoteHistory === 'function') {
                await deleteNoteHistory(safeName);
            }
            showToast(`Permanently deleted "${safeName}"`, 'info');
        } else {
            const trashDir = path.join(savesDir, '.trash');
            if (!fs.existsSync(trashDir)) {
                await fsPromises.mkdir(trashDir, { recursive: true });
            }
            const trashPath = path.join(trashDir, `${safeName}.nsh`);
            if (fs.existsSync(filePath)) {
                await fsPromises.rename(filePath, trashPath);
            }
            showToast(`Moved "${safeName}" to Trash`, 'info');
        }

        if (typeof removeNoteFromSearchCache === 'function') {
            removeNoteFromSearchCache(safeName);
        }

        // Remove from pinned if was pinned
        let pinned = getPinnedNotes();
        if (pinned.includes(safeName)) {
            pinned = pinned.filter(n => n !== safeName);
            localStorage.setItem('nosh-pinned-notes', JSON.stringify(pinned));
        }

        // Remove from folders if categorized
        if (typeof removeNoteFromFolders === 'function') {
            await removeNoteFromFolders(safeName);
        }

        // If synced to Drive, remove from Drive as well
        if (typeof deleteFileFromDriveByName === 'function') {
            deleteFileFromDriveByName(safeName);
        }

        if (activeNoteName === safeName) {
            activeNoteName = null;
            hasUnsavedChanges = false;
            if (typeof updatePublishButtonState === 'function') {
                updatePublishButtonState();
            }
        }

        invalidateVaultDashboardCache();
        await readDatabase();
        if (typeof window.scheduleAuthTokenVaultPush === 'function') {
            window.scheduleAuthTokenVaultPush();
        }
    } catch (err) {
        console.error('Error deleting file:', err);
        showToast('Error deleting note file', 'error');
    }
}

// Restore note from Trash
async function restoreFromTrash(noteName) {
    if (!noteName) return;
    const safeName = path.basename(noteName);
    const trashPath = path.join(savesDir, '.trash', `${safeName}.nsh`);
    const restorePath = path.join(savesDir, `${safeName}.nsh`);

    try {
        if (fs.existsSync(trashPath)) {
            await fsPromises.rename(trashPath, restorePath);
            showToast(`Restored "${safeName}"`, 'success');
            invalidateVaultDashboardCache();
            await readDatabase(safeName, true);
            return true;
        }
    } catch (err) {
        console.error('Error restoring note from trash:', err);
        showToast('Failed to restore note', 'error');
    }
    return false;
}

// Get list of notes currently in Trash
async function getTrashNotes() {
    const trashDir = path.join(savesDir, '.trash');
    if (!fs.existsSync(trashDir)) return [];
    try {
        const files = await fsPromises.readdir(trashDir);
        return files.filter(f => f.endsWith('.nsh')).map(f => path.basename(f, '.nsh'));
    } catch (e) {
        return [];
    }
}

// Empty Trash permanently
async function emptyTrash() {
    const trashDir = path.join(savesDir, '.trash');
    if (!fs.existsSync(trashDir)) return 0;
    try {
        const files = await fsPromises.readdir(trashDir);
        let count = 0;
        for (const file of files) {
            await fsPromises.unlink(path.join(trashDir, file));
            if (typeof deleteNoteHistory === 'function' && file.endsWith('.nsh')) {
                await deleteNoteHistory(path.basename(file, '.nsh'));
            }
            count++;
        }
        showToast(`Emptied trash (${count} note${count === 1 ? '' : 's'} removed)`, 'info');
        return count;
    } catch (e) {
        console.error('Error emptying trash:', e);
        showToast('Failed to empty trash', 'error');
        return 0;
    }
}

// Bidirectional Note Linking (Wiki-links [[Note Title]])
async function jumpToInternalNote(e, targetNote) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (!targetNote) return;

    const safeTarget = path.basename(targetNote.trim());
    if (!savesDir) await invokeSavesDir();
    const targetPath = path.join(savesDir, `${safeTarget}.nsh`);

    if (fs.existsSync(targetPath)) {
        await openDesiredFile(safeTarget);
    } else {
        // Auto-create target note if it does not exist yet (Obsidian style)
        try {
            await fsPromises.writeFile(targetPath, `<h1>${escapeHtml(safeTarget)}</h1><p>Created from linked reference.</p>`, 'utf8');
            showToast(`Created linked note "${safeTarget}"`, 'success');
            await readDatabase(safeTarget);
        } catch (err) {
            console.error('Failed to auto-create linked note:', err);
            showToast('Failed to open linked note', 'error');
        }
    }
}

function processInternalLinks(container = null) {
    const root = container || content;
    if (!root) return;

    // 1. Attach click listener to existing .note-internal-link spans
    root.querySelectorAll('.note-internal-link').forEach(link => {
        const note = link.getAttribute('data-note');
        if (note) {
            link.onclick = (e) => jumpToInternalNote(e, note);
        }
    });

    // 2. Scan text nodes outside code blocks for [[Note Title]] and convert to interactive links
    const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                if (node.parentElement && (node.parentElement.closest('.code-block-wrapper') || node.parentElement.closest('.note-internal-link'))) {
                    return NodeFilter.FILTER_REJECT;
                }
                return /\[\[([^\[\]]+)\]\]/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        }
    );

    const nodesToReplace = [];
    while (walker.nextNode()) {
        nodesToReplace.push(walker.currentNode);
    }

    nodesToReplace.forEach(textNode => {
        const text = textNode.nodeValue;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        const regex = /\[\[([^\[\]]+)\]\]/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            }

            const noteName = match[1].trim();
            const span = document.createElement('span');
            span.className = 'note-internal-link';
            span.setAttribute('data-note', noteName);
            span.setAttribute('contenteditable', 'false');
            span.setAttribute('title', `Jump to note: ${noteName}`);
            span.innerHTML = `<iconify-icon icon="solar:link-minimalistic-2-linear"></iconify-icon> ${escapeHtml(noteName)}`;
            span.onclick = (e) => jumpToInternalNote(e, noteName);
            fragment.appendChild(span);

            lastIndex = regex.lastIndex;
        }

        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }

        if (textNode.parentNode) {
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    });
}

// ==========================================================================
// Mathematical Formula Rendering Engine (KaTeX: \[...\], $$...$$, \(...\))
// ==========================================================================
function createMathFormulaElement(rawLatex, displayMode = true) {
    const cleanLatex = (rawLatex || '').trim();
    const el = document.createElement(displayMode ? 'div' : 'span');
    el.className = displayMode ? 'math-formula-block' : 'math-formula-inline';
    el.setAttribute('data-latex', cleanLatex);
    el.setAttribute('data-display-mode', displayMode ? 'true' : 'false');
    el.setAttribute('contenteditable', 'false');
    el.setAttribute('title', 'Double-click to edit LaTeX formula');

    if (typeof window !== 'undefined' && window.katex) {
        try {
            el.innerHTML = window.katex.renderToString(cleanLatex, {
                displayMode: displayMode,
                throwOnError: false,
                strict: false
            });
        } catch (e) {
            el.textContent = displayMode ? `\\[${cleanLatex}\\]` : `\\(${cleanLatex}\\)`;
        }
    } else {
        el.textContent = displayMode ? `\\[${cleanLatex}\\]` : `\\(${cleanLatex}\\)`;
    }

    attachMathFormulaInteractions(el);
    return el;
}

function attachMathFormulaInteractions(el) {
    if (!el) return;
    el.ondblclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const latex = el.getAttribute('data-latex') || '';
        const isDisplay = el.getAttribute('data-display-mode') !== 'false';
        const editNode = document.createElement(isDisplay ? 'p' : 'span');
        editNode.textContent = isDisplay ? `\\[ ${latex} \\]` : `\\( ${latex} \\)`;
        el.replaceWith(editNode);

        // Place caret inside the raw LaTeX text for quick editing; re-render on blur
        const sel = window.getSelection();
        if (sel) {
            const range = document.createRange();
            range.selectNodeContents(editNode);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    };
}

function isLikelyBracketLatex(innerLatex, isFullBlock = false) {
    if (!innerLatex) return false;
    const s = innerLatex.trim();
    if (!s) return false;
    // Reject Claude embedded content placeholders or plain text sentences
    if (/^embedded\s+content\s*:/i.test(s)) return false;
    if (isFullBlock) {
        // Standalone \[ ... \] block: valid if it has math commands, operators, or symbols
        return /\\[a-zA-Z]+|[=+<>^_{}]|\d/.test(s);
    }
    // Inline \[ ... \] inside prose: only treat as display math if it contains actual LaTeX commands or equations,
    // NOT simple numeric intervals like \[−1, 1\] or \[0, 1\] that come from Markdown bracket escaping.
    return /\\[a-zA-Z]+/.test(s) || (/[=^_{}]/.test(s) && !/^[-+−–\d.,\s°C%a-zA-ZğüşöçıİĞÜŞÖÇ]+$/.test(s));
}

function processMathFormulas(container = null) {
    const root = container || content;
    if (!root) return;

    // 1. Re-render and attach interactions to existing [data-latex] elements
    root.querySelectorAll('.math-formula-block[data-latex], .math-formula-inline[data-latex]').forEach(el => {
        const latex = el.getAttribute('data-latex') || '';
        const isDisplay = el.getAttribute('data-display-mode') !== 'false' && el.classList.contains('math-formula-block');
        if (typeof window !== 'undefined' && window.katex && latex) {
            try {
                el.innerHTML = window.katex.renderToString(latex, {
                    displayMode: isDisplay,
                    throwOnError: false,
                    strict: false
                });
            } catch (_) {}
        }
        attachMathFormulaInteractions(el);
    });

    // 2. Multi-element block formulas spanning across consecutive child blocks (e.g. <p>\[</p><p>...</p><p>\]</p>)
    const children = Array.from(root.children);
    let i = 0;
    while (i < children.length) {
        const child = children[i];
        if (!child || !child.parentNode || child.classList.contains('code-block-wrapper') || child.classList.contains('media-container') || child.classList.contains('math-formula-block')) {
            i++;
            continue;
        }

        const txt = (child.innerText || child.textContent || '').trim();
        const startsBracket = txt.startsWith('\\[') && !txt.includes('\\]');
        const startsDollar = txt.startsWith('$$') && txt.indexOf('$$', 2) === -1;

        if (startsBracket || startsDollar) {
            const closeToken = startsBracket ? '\\]' : '$$';
            let endIdx = -1;
            const collectedLines = [txt];

            for (let j = i + 1; j < children.length; j++) {
                const nextChild = children[j];
                if (!nextChild || nextChild.classList.contains('code-block-wrapper') || nextChild.classList.contains('media-container')) {
                    break;
                }
                const nextTxt = (nextChild.innerText || nextChild.textContent || '').trim();
                collectedLines.push(nextTxt);
                if (nextTxt.includes(closeToken)) {
                    endIdx = j;
                    break;
                }
            }

            if (endIdx !== -1) {
                const combined = collectedLines.join('\n').trim();
                const openLen = 2;
                const closePos = combined.lastIndexOf(closeToken);
                const innerLatex = combined.slice(openLen, closePos).trim();
                if (innerLatex && (!startsBracket || isLikelyBracketLatex(innerLatex, true))) {
                    const mathEl = createMathFormulaElement(innerLatex, true);
                    child.replaceWith(mathEl);
                    for (let k = i + 1; k <= endIdx; k++) {
                        if (children[k] && children[k].parentNode) {
                            children[k].remove();
                        }
                    }
                    i = endIdx + 1;
                    continue;
                }
            }
        }
        i++;
    }

    // 3. Single-block formulas (including blocks with <br> line breaks inside a single <p> or <div>)
    const blockCandidates = Array.from(root.querySelectorAll('p, div, li, blockquote'));
    blockCandidates.forEach(block => {
        if (!block.parentNode) return;
        if (block.closest('.code-block-wrapper, .media-container, .math-formula-block, .math-formula-inline, .checklist-item, .claude-embedded-diagram')) return;
        if (block.querySelector('.code-block-wrapper, .media-container, .math-formula-block, .claude-embedded-diagram, img, video, p, div, table')) return;

        const rawText = block.innerText || block.textContent || '';
        if (!/(\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\))/.test(rawText)) return;

        const trimmed = rawText.trim();
        // Pure display formula block
        if ((trimmed.startsWith('\\[') && trimmed.endsWith('\\]') && trimmed.indexOf('\\]') === trimmed.length - 2) ||
            (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.indexOf('$$', 2) === trimmed.length - 2)) {
            const innerLatex = trimmed.slice(2, -2).trim();
            const isBracket = trimmed.startsWith('\\[');
            if (innerLatex && (!isBracket || isLikelyBracketLatex(innerLatex, true))) {
                const mathEl = createMathFormulaElement(innerLatex, true);
                block.replaceWith(mathEl);
                return;
            }
        }

        // Mixed text and formulas inside the block
        const tokenRegex = /(\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\))/g;
        const fragment = document.createDocumentFragment();
        let lastIdx = 0;
        let match;
        let replacedAny = false;
        while ((match = tokenRegex.exec(rawText)) !== null) {
            const token = match[0];
            const isBracket = token.startsWith('\\[');
            const isDisplay = isBracket || token.startsWith('$$');
            const innerLatex = token.slice(2, -2).trim();
            if (isBracket && !isLikelyBracketLatex(innerLatex, false)) {
                continue;
            }
            if (match.index > lastIdx) {
                fragment.appendChild(document.createTextNode(rawText.slice(lastIdx, match.index)));
            }
            fragment.appendChild(createMathFormulaElement(innerLatex, isDisplay));
            lastIdx = tokenRegex.lastIndex;
            replacedAny = true;
        }
        if (!replacedAny) return;
        if (lastIdx < rawText.length) {
            fragment.appendChild(document.createTextNode(rawText.slice(lastIdx)));
        }
        block.innerHTML = '';
        block.appendChild(fragment);
    });

    // 4. Direct text nodes under root containing \[...\], $$...$$, or \(...\)
    const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                if (node.parentElement && node.parentElement.closest('.code-block-wrapper, .media-container, .math-formula-block, .math-formula-inline, .claude-embedded-diagram')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return /(\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\))/.test(node.nodeValue)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
        }
    );

    const textNodesToProcess = [];
    while (walker.nextNode()) {
        textNodesToProcess.push(walker.currentNode);
    }

    textNodesToProcess.forEach(textNode => {
        const text = textNode.nodeValue;
        const tokenRegex = /(\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\))/g;
        const fragment = document.createDocumentFragment();
        let lastIdx = 0;
        let match;
        let replacedAny = false;

        while ((match = tokenRegex.exec(text)) !== null) {
            const token = match[0];
            const isBracket = token.startsWith('\\[');
            const isDisplay = isBracket || token.startsWith('$$');
            const innerLatex = token.slice(2, -2).trim();
            if (isBracket && !isLikelyBracketLatex(innerLatex, false)) {
                continue;
            }
            if (match.index > lastIdx) {
                fragment.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
            }
            fragment.appendChild(createMathFormulaElement(innerLatex, isDisplay));
            lastIdx = tokenRegex.lastIndex;
            replacedAny = true;
        }

        if (!replacedAny) return;

        if (lastIdx < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
        }

        if (textNode.parentNode) {
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    });
}

if (typeof content !== 'undefined' && content) {
    content.addEventListener('paste', (e) => {
        if (e.defaultPrevented) return;
        setTimeout(() => {
            if (typeof processMathFormulas === 'function') {
                processMathFormulas();
            }
        }, 40);
    });
}

// Rename Note (Unicode & Turkish character safe, path traversal protected)
async function renameSave(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return false;

    const sanitizedNewName = newName.trim().replace(/[\/\\:*?"<>|]/g, '');

    if (sanitizedNewName.length < 1 || sanitizedNewName.length > 80) {
        showToast('Invalid name! Must be 1-80 characters and not contain \\ / : * ? " < > |', 'error');
        return false;
    }

    const oldFilePath = path.join(savesDir, `${path.basename(oldName)}.nsh`);
    const newFilePath = path.join(savesDir, `${sanitizedNewName}.nsh`);

    if (fs.existsSync(newFilePath)) {
        showToast(`A note named "${sanitizedNewName}" already exists!`, 'warning');
        return false;
    }

    try {
        await fsPromises.rename(oldFilePath, newFilePath);

        if (typeof renameNoteHistory === 'function') {
            await renameNoteHistory(path.basename(oldName), sanitizedNewName);
        }

        if (typeof removeNoteFromSearchCache === 'function') {
            removeNoteFromSearchCache(oldName);
        }

        // Update pinned notes if renamed
        let pinned = getPinnedNotes();
        if (pinned.includes(oldName)) {
            pinned = pinned.map(n => n === oldName ? sanitizedNewName : n);
            localStorage.setItem('nosh-pinned-notes', JSON.stringify(pinned));
        }

        // Update folder membership if renamed
        if (typeof updateNoteNameInFolders === 'function') {
            await updateNoteNameInFolders(oldName, sanitizedNewName);
        }

        // Update published notes list if renamed
        try {
            let publishedList = JSON.parse(localStorage.getItem('publishedFiles')) || [];
            let changed = false;
            publishedList.forEach(item => {
                if (item && item.name && (item.name === oldName || item.name === `${oldName}.nsh`)) {
                    item.name = sanitizedNewName;
                    changed = true;
                }
            });
            if (changed) {
                localStorage.setItem('publishedFiles', JSON.stringify(publishedList));
            }
        } catch (e) {
            console.warn('Could not update published notes list on rename:', e);
        }

        // Rename in Drive if synced
        if (typeof renameFileDrive === 'function') {
            renameFileDrive(oldName, sanitizedNewName);
        }

        // Synchronize the note's first <h1> header on disk with the new file name
        try {
            if (fs.existsSync(newFilePath)) {
                const diskHtml = await fsPromises.readFile(newFilePath, 'utf8');
                const probe = document.createElement('div');
                probe.innerHTML = diskHtml;
                if (probe.firstElementChild && probe.firstElementChild.tagName === 'H1') {
                    probe.firstElementChild.textContent = sanitizedNewName;
                } else {
                    const h1 = document.createElement('h1');
                    h1.textContent = sanitizedNewName;
                    probe.insertBefore(h1, probe.firstChild);
                }
                await fsPromises.writeFile(newFilePath, probe.innerHTML, 'utf8');
            }
        } catch (syncErr) {
            console.warn('Could not sync first header on disk during rename:', syncErr);
        }

        if (activeNoteName === oldName) {
            activeNoteName = sanitizedNewName;
            textTitle.textContent = sanitizedNewName;
            activeDocTitle.textContent = sanitizedNewName;
            if (content) {
                if (content.firstElementChild && content.firstElementChild.tagName === 'H1') {
                    content.firstElementChild.textContent = sanitizedNewName;
                    content.firstElementChild.setAttribute('data-placeholder', sanitizedNewName);
                } else if (typeof ensureNoteFirstHeader === 'function') {
                    ensureNoteFirstHeader(content, sanitizedNewName, true);
                }
            }
        }

        if (typeof updatePublishButtonState === 'function') {
            updatePublishButtonState();
        }

        invalidateVaultDashboardCache();
        showToast(`Renamed to "${sanitizedNewName}"`, 'success');
        await readDatabase(activeNoteName);
        if (typeof window.scheduleAuthTokenVaultPush === 'function') {
            window.scheduleAuthTokenVaultPush();
        }
        return true;
    } catch (err) {
        console.error('Error renaming file:', err);
        showToast('Error renaming note file', 'error');
        return false;
    }
}

// In-place rename triggered when the user edits the note's first <h1> header directly in the editor
async function renameActiveNoteFromHeader(oldName, rawNewName, { allowUniqueSuffix = false } = {}) {
    if (!oldName || !rawNewName) return oldName;
    const baseSanitized = String(rawNewName)
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[\/\\:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);

    if (!baseSanitized || baseSanitized === oldName) {
        return oldName;
    }

    let targetName = baseSanitized;
    const oldBase = path.basename(oldName);
    const oldFilePath = path.join(savesDir, `${oldBase}.nsh`);
    let newFilePath = path.join(savesDir, `${targetName}.nsh`);

    // Case-insensitive same-file check on Windows/macOS vs actual collision with a different note
    const isSameFileCaseChange = oldBase.toLowerCase() === targetName.toLowerCase();
    if (!isSameFileCaseChange && fs.existsSync(newFilePath)) {
        if (!allowUniqueSuffix) {
            return oldName;
        }
        let counter = 2;
        while (fs.existsSync(path.join(savesDir, `${baseSanitized} (${counter}).nsh`))) {
            counter++;
        }
        targetName = `${baseSanitized} (${counter})`.slice(0, 80);
        newFilePath = path.join(savesDir, `${targetName}.nsh`);
    }

    try {
        if (fs.existsSync(oldFilePath)) {
            await fsPromises.rename(oldFilePath, newFilePath);
        }

        if (typeof renameNoteHistory === 'function') {
            await renameNoteHistory(oldBase, targetName);
        }

        if (typeof removeNoteFromSearchCache === 'function') {
            removeNoteFromSearchCache(oldName);
        }

        let pinned = getPinnedNotes();
        if (pinned.includes(oldName)) {
            pinned = pinned.map(n => n === oldName ? targetName : n);
            localStorage.setItem('nosh-pinned-notes', JSON.stringify(pinned));
        }

        if (typeof updateNoteNameInFolders === 'function') {
            await updateNoteNameInFolders(oldName, targetName);
        }

        try {
            let publishedList = JSON.parse(localStorage.getItem('publishedFiles')) || [];
            let changed = false;
            publishedList.forEach(item => {
                if (item && item.name && (item.name === oldName || item.name === `${oldName}.nsh`)) {
                    item.name = targetName;
                    changed = true;
                }
            });
            if (changed) {
                localStorage.setItem('publishedFiles', JSON.stringify(publishedList));
            }
        } catch (_) {}

        if (typeof renameFileDrive === 'function') {
            renameFileDrive(oldName, targetName);
        }

        if (activeNoteName === oldName) {
            activeNoteName = targetName;
        }
        if (textTitle) textTitle.textContent = targetName;
        if (activeDocTitle) activeDocTitle.textContent = targetName;
        const activeNoteEl = document.getElementById('status-active-note');
        if (activeNoteEl) activeNoteEl.textContent = targetName;

        // Update sidebar item in-place without stealing focus from #content
        document.querySelectorAll('.save').forEach(saveEl => {
            if (saveEl.getAttribute('data-file') === oldName) {
                saveEl.setAttribute('data-file', targetName);
                saveEl.setAttribute('file-name', targetName);
                saveEl.setAttribute('data-note-name', targetName);
                const titleEl = saveEl.querySelector('.save-title');
                if (titleEl) titleEl.textContent = targetName;
            }
        });

        if (typeof updatePublishButtonState === 'function') {
            updatePublishButtonState();
        }
        invalidateVaultDashboardCache();
        if (typeof window.scheduleAuthTokenVaultPush === 'function') {
            window.scheduleAuthTokenVaultPush();
        }
        return targetName;
    } catch (err) {
        console.error('Error syncing header to note file name:', err);
        return oldName;
    }
}

// Duplicate Note
async function duplicateSave(noteName) {
    if (!noteName) return;
    const safeName = path.basename(noteName);
    const srcPath = path.join(savesDir, `${safeName}.nsh`);

    try {
        const data = await fsPromises.readFile(srcPath, 'utf8');
        const dupName = `${safeName} (Copy)`;
        const destPath = path.join(savesDir, `${dupName}.nsh`);

        await fsPromises.writeFile(destPath, data, 'utf8');
        if (typeof duplicateNoteInFolders === 'function') {
            await duplicateNoteInFolders(safeName, dupName);
        }
        invalidateVaultDashboardCache();
        showToast(`Duplicated note "${safeName}"`, 'success');
        await readDatabase(dupName);
    } catch (err) {
        console.error('Error duplicating file:', err);
        showToast('Failed to duplicate note', 'error');
    }
}

// Save Order persistence helper
const savesContainer = document.getElementById('saves-container');

function updateOrder() {
    if (!savesContainer) return;
    const saveEls = savesContainer.querySelectorAll('.save[data-file]');
    const newOrder = [...saveEls].map(el => el.getAttribute('data-file'));
    localStorage.setItem('save-order', JSON.stringify(newOrder));
}

function sortSaves() {
    if (!savesContainer) return;
    if (savesContainer.querySelector('.sidebar-section, .sidebar-folder')) {
        // Sections and folders are already sorted hierarchically during render
        return;
    }
    const pinnedNotes = getPinnedNotes();
    const elements = Array.from(savesContainer.children);

    elements.sort((a, b) => {
        const aFile = a.getAttribute('data-file');
        const bFile = b.getAttribute('data-file');
        const aPinned = pinnedNotes.includes(aFile);
        const bPinned = pinnedNotes.includes(bFile);

        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        if (aPinned && bPinned) {
            return pinnedNotes.indexOf(aFile) - pinnedNotes.indexOf(bFile);
        }

        const aMtime = parseFloat(a.getAttribute('data-mtime')) || 0;
        const bMtime = parseFloat(b.getAttribute('data-mtime')) || 0;
        if (bMtime !== aMtime) {
            return bMtime - aMtime; // Most recently modified at top
        }

        return aFile.localeCompare(bFile);
    });

    elements.forEach(el => savesContainer.appendChild(el));
}

// ==========================================================================
// Bidirectional Backlinks Engine
// ==========================================================================
async function getBacklinksForNote(targetNote) {
    if (!targetNote || !savesDir) return [];
    try {
        const files = await fsPromises.readdir(savesDir);
        const nshFiles = files.filter(f => f.endsWith('.nsh') && path.basename(f, '.nsh') !== targetNote);
        const backlinks = [];

        for (const file of nshFiles) {
            const noteName = path.basename(file, '.nsh');
            const targetPath = path.join(savesDir, file);
            try {
                if (!fs.existsSync(targetPath)) continue;
                const fileContent = await fsPromises.readFile(targetPath, 'utf8');
                const escaped = targetNote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`(\\[\\[${escaped}\\]\\]|data-note="${escaped}")`, 'i');
                if (pattern.test(fileContent)) {
                    backlinks.push(noteName);
                }
            } catch (err) {
                // Ignore transient read errors if file was concurrently deleted or moved
            }
        }
        return backlinks;
    } catch (e) {
        console.error('Error computing backlinks:', e);
        return [];
    }
}

async function updateBacklinksUI() {
    const backlinksCountEl = document.getElementById('backlinks-count');
    const backlinksBadge = document.getElementById('status-backlinks');
    if (!backlinksCountEl || !activeNoteName) {
        if (backlinksCountEl) backlinksCountEl.textContent = '0';
        return [];
    }

    const backlinks = await getBacklinksForNote(activeNoteName);
    backlinksCountEl.textContent = backlinks.length;

    if (backlinksBadge) {
        backlinksBadge.title = backlinks.length > 0 ? 
            `${backlinks.length} note(s) link here: ${backlinks.join(', ')}` : 
            'No notes link to this document yet';
    }

    return backlinks;
}

async function toggleBacklinksPopover(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const popover = document.getElementById('backlinks-popover');
    const list = document.getElementById('backlinks-list');
    if (!popover || !list) return;

    if (popover.style.display !== 'none') {
        popover.style.display = 'none';
        return;
    }

    list.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 8px;">Finding backlinks...</div>';
    popover.style.display = 'flex';

    const backlinks = await updateBacklinksUI();
    if (backlinks.length === 0) {
        list.innerHTML = `
            <div style="font-size: 12px; color: var(--text-muted); padding: 12px 6px; text-align: center;">
                No other notes link to "${escapeHtml(activeNoteName)}" yet.
            </div>
        `;
        return;
    }

    list.innerHTML = '';
    backlinks.forEach(name => {
        const item = document.createElement('div');
        item.className = 'backlinks-item';
        item.innerHTML = `
            <iconify-icon icon="solar:document-text-linear"></iconify-icon>
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(name)}</span>
            <iconify-icon icon="solar:alt-arrow-right-linear" style="font-size:12px; opacity:0.6;"></iconify-icon>
        `;
        item.onclick = async () => {
            popover.style.display = 'none';
            await openDesiredFile(name);
        };
        list.appendChild(item);
    });
}

function closeBacklinksPopover() {
    const popover = document.getElementById('backlinks-popover');
    if (popover) popover.style.display = 'none';
}

// Global click outside to dismiss backlinks popover
document.addEventListener('click', (e) => {
    const popover = document.getElementById('backlinks-popover');
    const badge = document.getElementById('status-backlinks');
    if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && (!badge || !badge.contains(e.target))) {
            popover.style.display = 'none';
        }
    }
});

// ==========================================================================
// Engineering Note Templates
// ==========================================================================
function openTemplateModal() {
    openModal('template-modal');
}

async function createNewFromTemplate(templateId) {
    closeAllModals();
    await invokeSavesDir();

    const templates = {
        rfc: {
            titlePrefix: 'RFC - System Design',
            content: `<h1>RFC: System Architecture</h1><p><strong>Author:</strong> Lead Architect | <strong>Status:</strong> Proposed</p><hr><h2>1. Context & Motivation</h2><p>Detail the motivation and architectural goals...</p><h2>2. Component Interfaces</h2><div class="code-block-wrapper" contenteditable="false"><div class="code-block-header"><div class="code-header-left"><div class="code-window-dots"><span class="code-dot red"></span><span class="code-dot yellow"></span><span class="code-dot green"></span></div><span class="code-lang-tag clickable" onclick="openBlockLangSwitcher(this)"><iconify-icon class="lang-icon" icon="logos:typescript-icon"></iconify-icon><span class="lang-name">TypeScript</span><iconify-icon class="lang-caret" icon="solar:alt-arrow-down-linear"></iconify-icon></span></div><div class="code-block-actions"><button class="code-action-btn wrap-btn" onclick="toggleCodeWrap(this)">Wrap</button><button class="code-action-btn copy-btn" onclick="copyCodeSnippet(this)">Copy</button><button class="code-action-btn delete" onclick="deleteCodeBlock(this)"><iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon></button></div></div><textarea class="code" language="javascript" data-label="TypeScript" style="display:block;">interface StorageDriver {\n    read(key: string): Promise<string>;\n    write(key: string, data: string): Promise<void>;\n}</textarea></div><h2>3. Action Checklist</h2><div class="checklist-item" contenteditable="false"><input type="checkbox" class="checklist-checkbox" onchange="toggleChecklistItem(this)"><span class="checklist-text" contenteditable="true">Implement storage driver interfaces</span></div><div class="checklist-item" contenteditable="false"><input type="checkbox" class="checklist-checkbox" onchange="toggleChecklistItem(this)"><span class="checklist-text" contenteditable="true">Automated regression tests</span></div><p><br></p>`
        },
        bug: {
            titlePrefix: 'Bug Investigation',
            content: `<h1>Bug Investigation: Issue Analysis</h1><p><strong>Severity:</strong> High | <strong>Affected Module:</strong> Core</p><hr><h2>🚨 Symptoms & Reproduction</h2><ul><li>Step 1: Reproduce defect</li><li>Step 2: Inspect runtime logs</li></ul><h2>🔍 Root Cause Analysis</h2><p>Analysis of root cause...</p><div class="code-block-wrapper" contenteditable="false"><div class="code-block-header"><div class="code-header-left"><div class="code-window-dots"><span class="code-dot red"></span><span class="code-dot yellow"></span><span class="code-dot green"></span></div><span class="code-lang-tag clickable" onclick="openBlockLangSwitcher(this)"><iconify-icon class="lang-icon" icon="logos:python"></iconify-icon><span class="lang-name">Python</span><iconify-icon class="lang-caret" icon="solar:alt-arrow-down-linear"></iconify-icon></span></div><div class="code-block-actions"><button class="code-action-btn wrap-btn" onclick="toggleCodeWrap(this)">Wrap</button><button class="code-action-btn copy-btn" onclick="copyCodeSnippet(this)">Copy</button><button class="code-action-btn delete" onclick="deleteCodeBlock(this)"><iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon></button></div></div><textarea class="code" language="python" data-label="Python" style="display:block;">def safe_handler(payload):\n    if not payload:\n        return None\n    return process(payload)</textarea></div><h2>🛡️ Resolution Checklist</h2><div class="checklist-item" contenteditable="false"><input type="checkbox" class="checklist-checkbox" onchange="toggleChecklistItem(this)"><span class="checklist-text" contenteditable="true">Apply hotfix patch</span></div><p><br></p>`
        },
        meeting: {
            titlePrefix: 'Meeting Notes',
            content: `<h1>Meeting Notes: Project Review</h1><p><strong>Date:</strong> ${new Date().toLocaleDateString()} | <strong>Attendees:</strong> Core Engineering Team</p><hr><h2>🎯 Objectives</h2><ul><li>Align on sprint deliverables</li><li>Unblock technical dependencies</li></ul><h2>💬 Discussion & Decisions</h2><p>Key consensus and decisions...</p><h2>✅ Action Items</h2><div class="checklist-item" contenteditable="false"><input type="checkbox" class="checklist-checkbox" onchange="toggleChecklistItem(this)"><span class="checklist-text" contenteditable="true">Finalize IPC schema</span></div><p><br></p>`
        },
        daily: {
            titlePrefix: 'Daily Dev Log',
            content: `<h1>Daily Dev Log: ${new Date().toISOString().slice(0, 10)}</h1><p><strong>Status:</strong> Active Sprint</p><hr><h2>🎯 Today's Focus</h2><div class="checklist-item" contenteditable="false"><input type="checkbox" class="checklist-checkbox" onchange="toggleChecklistItem(this)"><span class="checklist-text" contenteditable="true">Complete feature implementation</span></div><h2>📝 Notes & Discoveries</h2><p>Log notes and architecture discoveries...</p><h2>🚧 Blockers</h2><p>None.</p>`
        },
        algo: {
            titlePrefix: 'Algorithm Showcase',
            content: `<h1>Algorithm: Binary Search</h1><p><strong>Category:</strong> Algorithms & Data Structures</p><hr><h2>💡 Complexity & Analysis</h2><p><strong>Time:</strong> O(log n) | <strong>Space:</strong> O(1)</p><div class="code-block-wrapper" contenteditable="false"><div class="code-block-header"><div class="code-header-left"><div class="code-window-dots"><span class="code-dot red"></span><span class="code-dot yellow"></span><span class="code-dot green"></span></div><span class="code-lang-tag clickable" onclick="openBlockLangSwitcher(this)"><iconify-icon class="lang-icon" icon="logos:rust"></iconify-icon><span class="lang-name">Rust</span><iconify-icon class="lang-caret" icon="solar:alt-arrow-down-linear"></iconify-icon></span></div><div class="code-block-actions"><button class="code-action-btn wrap-btn" onclick="toggleCodeWrap(this)">Wrap</button><button class="code-action-btn copy-btn" onclick="copyCodeSnippet(this)">Copy</button><button class="code-action-btn delete" onclick="deleteCodeBlock(this)"><iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon></button></div></div><textarea class="code" language="rust" data-label="Rust" style="display:block;">pub fn binary_search(arr: &[i32], target: i32) -> Option<usize> {\n    let mut low = 0;\n    let mut high = arr.len();\n    while low < high {\n        let mid = low + (high - low) / 2;\n        if arr[mid] == target { return Some(mid); }\n        else if arr[mid] < target { low = mid + 1; }\n        else { high = mid; }\n    }\n    None\n}</textarea></div>`
        }
    };

    const tmpl = templates[templateId] || templates.meeting;
    const files = await fsPromises.readdir(savesDir);
    let noteName = tmpl.titlePrefix;
    let counter = 1;
    while (files.includes(`${noteName}.nsh`)) {
        noteName = `${tmpl.titlePrefix} (${counter++})`;
    }

    const filePath = path.join(savesDir, `${noteName}.nsh`);
    await fsPromises.writeFile(filePath, tmpl.content, 'utf8');
    invalidateVaultDashboardCache();
    showToast(`Created note from template: "${noteName}"`, 'success');
    await readDatabase(noteName);
}

if (typeof window !== 'undefined') {
    window.showWelcomeDashboard = showWelcomeDashboard;
    window.renderWelcomeDashboardUI = renderWelcomeDashboardUI;
    window.getVaultDashboardData = getVaultDashboardData;
}
if (typeof global !== 'undefined') {
    global.showWelcomeDashboard = showWelcomeDashboard;
}

// Initialize database on launch
readDatabase();
