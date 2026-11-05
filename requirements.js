// Core renderer state.
//
// This window runs with contextIsolation and no Node integration. CodeMirror is loaded with
// <script> tags in index.html, and ipcRenderer / fs / fsPromises / path / shell come from
// renderer-bridge.js (built on the preload bridge), which loads before this file.

const port = 2222;
let savesDir = '';
let activeNoteName = null;
let hasUnsavedChanges = false;

// Helper to find a sidebar note element by name safely
function findNoteElement(name) {
    if (!name) return null;
    const safe = typeof path !== 'undefined' && path.basename ? path.basename(name, '.nsh') : name.replace(/\.nsh$/i, '');
    const all = document.querySelectorAll('.save');
    for (const el of all) {
        if (el.getAttribute('data-file') === safe || el.getAttribute('file-name') === safe) {
            return el;
        }
    }
    return null;
}

// Global DOM elements
const content = document.getElementById('content');
const textTitle = document.querySelector('.text-title');
const activeDocTitle = document.getElementById('active-doc-title');
const unsavedDot = document.querySelector('.unsaved-dot');

// Modern Welcome Dashboard Template (Fallback)
const welcomeDashboard = `
    <div class="welcome-dashboard">
        <div class="welcome-hero">
            <div class="hero-logo-wrap">
                <img src="icon.png" class="hero-icon" alt="Nosh">
            </div>
            <h1 class="hero-title">Welcome to Nosh</h1>
            <p class="hero-subtitle">A high-craft, distraction-free note & code workstation built for programmers and thinkers.</p>
        </div>

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

// Initialize default code theme if not set
if (!localStorage.getItem('code-theme')) {
    localStorage.setItem('code-theme', 'dracula');
}
