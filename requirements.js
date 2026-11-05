// CodeMirror Core & Addons
const CodeMirror = require('codemirror');
require('codemirror/lib/codemirror');
require('codemirror/addon/edit/closebrackets');
require('codemirror/addon/hint/show-hint');
require('codemirror/keymap/sublime.js');

// CodeMirror Modes
require('codemirror/mode/clike/clike');
require('codemirror/mode/javascript/javascript');
require('codemirror/addon/hint/javascript-hint');
require('codemirror/mode/htmlmixed/htmlmixed');
require('codemirror/mode/xml/xml');
require('codemirror/addon/hint/html-hint');
require('codemirror/mode/css/css');
require('codemirror/addon/hint/css-hint');
require('codemirror/mode/python/python');
require('codemirror/mode/php/php');
require('codemirror/mode/ruby/ruby');
require('codemirror/mode/go/go');
require('codemirror/mode/sql/sql');
require('codemirror/mode/shell/shell');
require('codemirror/mode/markdown/markdown');
require('codemirror/mode/yaml/yaml');
require('codemirror/mode/rust/rust');
require('codemirror/mode/swift/swift');

// Node.js & Electron modules
const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

const port = 2222;
let savesDir = '';
let activeNoteName = null;
let hasUnsavedChanges = false;

// Load local environment variables from .env if present (git-ignored)
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        }
    }
} catch (e) {
    console.error('Error loading .env in renderer process:', e);
}

const defaultDriveClientId = process.env.GOOGLE_DRIVE_CLIENT_ID || '';
const defaultDriveClientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || '';
if (typeof window !== 'undefined') {
    window.defaultDriveClientId = defaultDriveClientId;
    window.defaultDriveClientSecret = defaultDriveClientSecret;
}

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
