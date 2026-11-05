// Code Block Management & CodeMirror Integration

const supportedLanguages = [
    { name: 'Python', mode: 'python', icon: 'logos:python', color: '#3572A5' },
    { name: 'JavaScript', mode: 'javascript', icon: 'logos:javascript', color: '#f1e05a' },
    { name: 'TypeScript', mode: 'javascript', icon: 'logos:typescript-icon', color: '#3178c6' },
    { name: 'Rust', mode: 'rust', icon: 'logos:rust', color: '#dea584' },
    { name: 'Go', mode: 'go', icon: 'logos:go', color: '#00ADD8' },
    { name: 'C++', mode: 'text/x-c++src', icon: 'logos:c-plusplus', color: '#f34b7d' },
    { name: 'C', mode: 'text/x-csrc', icon: 'logos:c', color: '#555555' },
    { name: 'C#', mode: 'text/x-csharp', icon: 'logos:c-sharp', color: '#178600' },
    { name: 'Java', mode: 'text/x-java', icon: 'logos:java', color: '#b07219' },
    { name: 'Kotlin', mode: 'text/x-kotlin', icon: 'logos:kotlin-icon', color: '#A97BFF' },
    { name: 'Dart', mode: 'dart', icon: 'logos:dart', color: '#00B4AB' },
    { name: 'Swift', mode: 'swift', icon: 'logos:swift', color: '#F05138' },
    { name: 'HTML', mode: 'htmlmixed', icon: 'logos:html-5', color: '#e34c26' },
    { name: 'CSS', mode: 'css', icon: 'logos:css-3', color: '#563d7c' },
    { name: 'SQL', mode: 'sql', icon: 'vscode-icons:file-type-sql', color: '#e38c00' },
    { name: 'Bash / Shell', mode: 'shell', icon: 'logos:bash-icon', color: '#89e051' },
    { name: 'JSON', mode: 'json', icon: 'vscode-icons:file-type-json', color: '#cbcb41' },
    { name: 'YAML', mode: 'yaml', icon: 'vscode-icons:file-type-yaml', color: '#cb171e' },
    { name: 'Markdown', mode: 'markdown', icon: 'logos:markdown', color: '#083fa1' },
    { name: 'PHP', mode: 'php', icon: 'logos:php', color: '#4F5D95' },
    { name: 'Ruby', mode: 'ruby', icon: 'logos:ruby', color: '#701516' },
    { name: 'Vue', mode: 'htmlmixed', icon: 'logos:vue', color: '#41b883' },
    { name: 'React', mode: 'javascript', icon: 'logos:react', color: '#61dafb' },
    { name: 'Lua', mode: 'lua', icon: 'logos:lua', color: '#000080' },
    { name: 'R', mode: 'r', icon: 'logos:r-lang', color: '#198CE7' }
];

const codeBlockThemes = [
    "dracula", "darcula", "material", "monokai", "nord",
    "solarized", "icecoder", "3024-day", "3024-night", "ayu-dark",
    "base16-dark", "bespin", "blackboard", "cobalt", "duotone-dark",
    "gruvbox-dark", "lucario", "midnight", "oceanic-next", "panda-syntax",
    "tomorrow-night-eighties", "twilight", "zenburn"
];

let savedCodeBlockRange = null;

// Open Language Modal
function openLanguageModal() {
    if (!activeNoteName) {
        showToast('Create or open a note first', 'warning');
        return;
    }

    // Save current selection range if inside #content
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && content && content.contains(sel.anchorNode)) {
        savedCodeBlockRange = sel.getRangeAt(0).cloneRange();
    } else {
        savedCodeBlockRange = null;
    }

    renderLanguagesGrid();
    const searchInput = document.getElementById('lang-search-input');
    if (searchInput) searchInput.value = '';
    filterLanguages();
    openModal('language-modal');
}

function renderLanguagesGrid() {
    const grid = document.getElementById('languages-grid');
    if (!grid || grid.children.length > 0) return;

    supportedLanguages.forEach(lang => {
        const btn = document.createElement('button');
        btn.className = 'lang-btn';
        btn.innerHTML = `
            <iconify-icon icon="${lang.icon}"></iconify-icon>
            <span>${lang.name}</span>
        `;
        btn.onclick = () => createCodeBlock(lang.mode, lang.name);
        grid.appendChild(btn);
    });
}

function filterLanguages() {
    const input = document.getElementById('lang-search-input');
    const term = input ? input.value.toLowerCase().trim() : '';
    const buttons = document.querySelectorAll('#languages-grid .lang-btn');

    buttons.forEach(btn => {
        const text = btn.textContent.toLowerCase();
        btn.style.display = text.includes(term) ? 'flex' : 'none';
    });
}

function getLanguageMeta(mode, label) {
    if (!mode && !label) return { name: 'Plain Text', mode: 'null', icon: 'solar:code-square-linear', color: '#8b949e' };
    const lowerMode = (mode || '').toLowerCase();
    const lowerLabel = (label || '').toLowerCase();

    // Direct match by mode or name
    const found = supportedLanguages.find(l => 
        (l.mode.toLowerCase() === lowerMode) || 
        (l.name.toLowerCase() === lowerLabel) ||
        (label && l.name.toLowerCase() === label.toLowerCase())
    );
    if (found) return found;

    // Substring or alias match
    const fuzzy = supportedLanguages.find(l => 
        (lowerMode && (lowerMode.includes(l.name.toLowerCase()) || l.mode.toLowerCase().includes(lowerMode))) ||
        (lowerLabel && (lowerLabel.includes(l.name.toLowerCase()) || l.name.toLowerCase().includes(lowerLabel)))
    );
    if (fuzzy) return fuzzy;

    return { name: label || mode, mode: mode, icon: 'solar:code-square-linear', color: '#8b949e' };
}

// Auto Detect Programming Language from Code Snippet
function detectCodeLanguage(code) {
    if (!code || typeof code !== 'string') {
        return getLanguageMeta('javascript', 'JavaScript');
    }
    const text = code.trim();
    if (!text) {
        return getLanguageMeta('javascript', 'JavaScript');
    }

    // 1. JSON (Valid object or array parse)
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
        try {
            JSON.parse(text);
            return getLanguageMeta('json', 'JSON');
        } catch (_) {}
    }

    // 2. HTML / XML
    if (/<!DOCTYPE\s+html/i.test(text) || /<html[\s>]/i.test(text) || (/<[a-z][\w-]*(\s+[\w-]+(=["'][^"']*["'])?)*\s*>/i.test(text) && /<\/[a-z][\w-]*>/i.test(text))) {
        return getLanguageMeta('htmlmixed', 'HTML');
    }

    // 3. CSS
    if (/(@media|@keyframes|@import|@font-face)\b/.test(text) || 
        /([.#][\w-]+\s*,\s*)*[.#][\w-]+\s*\{[^}]*[\w-]+:\s*[^}]+;?\s*\}/.test(text) || 
        (text.includes('{') && text.includes('}') && /:\s*(flex|grid|block|none|absolute|relative|pointer|#[0-9a-fA-F]{3,8}|rgba?\()/i.test(text))) {
        return getLanguageMeta('css', 'CSS');
    }

    // 4. SQL
    if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|JOIN|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING)\b/i.test(text) && 
        /\b(FROM|TABLE|INTO|SET|VALUES|DATABASE)\b/i.test(text)) {
        return getLanguageMeta('sql', 'SQL');
    }

    // 5. Python
    if (/^\s*(def\s+\w+\s*\(|class\s+\w+(\(.*\))?\s*:|import\s+\w+|from\s+\w+\s+import|if\s+__name__\s*==|elif\s+|print\(|for\s+\w+\s+in\s+range\()/m.test(text) || 
        /:\s*$\s*(pass|return\b)/m.test(text)) {
        return getLanguageMeta('python', 'Python');
    }

    // 6. Rust
    if (/\b(fn\s+\w+\s*\(|let\s+mut\s+|impl\s+|pub\s+struct\s+|pub\s+fn\s+|match\s+\w+\s*\{|println!|Result<|Option<|unwrap\(\)|#\[derive\()/m.test(text)) {
        return getLanguageMeta('rust', 'Rust');
    }

    // 7. Go
    if (/\b(package\s+\w+|func\s+\w+\s*\(|func\s*\([^)]+\)\s*\w+\s*\(|import\s*\([\s\S]*?\)|fmt\.Print(ln|f)?|go\s+func\(|chan\s+\w+|struct\s*\{|:=\s*)/m.test(text)) {
        return getLanguageMeta('go', 'Go');
    }

    // 8. C++
    if (/#include\s*<[a-z_]+>/i.test(text) && 
        (/\b(std::|cout|cin|endl|nullptr|vector<|string>|namespace\s+\w+)/.test(text) || /class\s+\w+\s*:\s*(public|private|protected)/.test(text))) {
        return getLanguageMeta('text/x-c++src', 'C++');
    }

    // 9. C
    if (/#include\s*<[a-z_]+\.h>/i.test(text) || (/\b(printf|scanf|malloc|free|sizeof)\s*\(/.test(text) && /int\s+main\s*\(/.test(text))) {
        return getLanguageMeta('text/x-csrc', 'C');
    }

    // 10. C#
    if (/\b(using\s+System|namespace\s+[\w\.]+|public\s+(class|interface|enum)\s+\w+|Console\.Write(Line)?|Task<[\w\s]+>|var\s+\w+\s*=\s*new\s+\w+\()/m.test(text)) {
        return getLanguageMeta('text/x-csharp', 'C#');
    }

    // 11. Java
    if (/\b(public\s+static\s+void\s+main|System\.out\.print(ln)?|public\s+class\s+\w+|package\s+[\w\.]+|import\s+java\.)/m.test(text)) {
        return getLanguageMeta('text/x-java', 'Java');
    }

    // 12. PHP
    if (/<\?php/i.test(text) || (/\$[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*/.test(text) && /\b(echo|print|var_dump|function)\b/.test(text))) {
        return getLanguageMeta('php', 'PHP');
    }

    // 13. TypeScript
    if (/\b(interface\s+\w+|type\s+\w+\s*=|enum\s+\w+|as\s+(const|[A-Z]\w+)|:\s*(string|number|boolean|any|unknown|never|void|Record<)[\s;,=\)])/m.test(text)) {
        return getLanguageMeta('javascript', 'TypeScript');
    }

    // 14. Shell / Bash
    if (/^#!\/bin\/(bash|sh|zsh)/m.test(text) || 
        /^\s*(npm\s+(i|run|start|build|test)|pnpm\s+|yarn\s+|git\s+(commit|push|pull|status|checkout|branch)|docker\s+(run|build|compose)|sudo\s+|chmod\s+\+x|export\s+[A-Z_]+=|echo\s+["'])/m.test(text)) {
        return getLanguageMeta('shell', 'Bash / Shell');
    }

    // 15. Markdown
    if (/^#{1,6}\s+[\w\s]+/m.test(text) || (/^[\*\-]\s+\[[ xX]\]\s+/m.test(text) && /\n/.test(text)) || /\[.+?\]\(https?:\/\/.+?\)/.test(text)) {
        return getLanguageMeta('markdown', 'Markdown');
    }

    // 16. YAML
    if (/^[a-zA-Z0-9_-]+:\s*([^\n]*)$/m.test(text) && /^\s{2,4}[a-zA-Z0-9_-]+:\s*/m.test(text)) {
        return getLanguageMeta('yaml', 'YAML');
    }

    // 17. JavaScript (Common JS syntax)
    if (/\b(const|let|var|function|return|console\.log|document\.|window\.|require\(|import\s+.*from|export\s+(default|const))\b/.test(text) || 
        /=>\s*\{?/.test(text) || /===|!==/.test(text)) {
        return getLanguageMeta('javascript', 'JavaScript');
    }

    return getLanguageMeta('javascript', 'JavaScript');
}

// Insert Code Block from Active Selection or Caret
function insertCodeBlockFromSelection() {
    if (!activeNoteName) {
        showToast('Create or open a note first', 'warning');
        return;
    }

    const sel = window.getSelection();
    let selectedText = '';
    let range = null;

    if (sel && sel.rangeCount > 0 && content && content.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0);
        selectedText = sel.toString();
    } else if (savedCodeBlockRange && content && content.contains(savedCodeBlockRange.startContainer)) {
        range = savedCodeBlockRange;
        selectedText = range.toString();
    }

    // Auto detect language
    const langMeta = detectCodeLanguage(selectedText);
    const mode = langMeta.mode;
    const label = langMeta.name;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    wrapper.setAttribute('contenteditable', 'false');

    const header = document.createElement('div');
    header.className = 'code-block-header';
    header.innerHTML = `
        <div class="code-header-left">
            <span class="block-drag-handle code-drag-handle" draggable="true" title="Drag to reorder">
                <iconify-icon icon="solar:menu-dots-bold"></iconify-icon>
            </span>
            <div class="code-window-dots">
                <span class="code-dot red"></span>
                <span class="code-dot yellow"></span>
                <span class="code-dot green"></span>
            </div>
            <span class="code-lang-tag clickable" onclick="openBlockLangSwitcher(this)" title="Change code language">
                <iconify-icon class="lang-icon" icon="${langMeta.icon}"></iconify-icon>
                <span class="lang-name">${label}</span>
                <iconify-icon class="lang-caret" icon="solar:alt-arrow-down-linear"></iconify-icon>
            </span>
        </div>
        <div class="code-block-actions">
            <button class="code-action-btn move-up-btn" onclick="moveBlockUp(this)" title="Move Up">
                <iconify-icon icon="solar:alt-arrow-up-linear"></iconify-icon>
            </button>
            <button class="code-action-btn move-down-btn" onclick="moveBlockDown(this)" title="Move Down">
                <iconify-icon icon="solar:alt-arrow-down-linear"></iconify-icon>
            </button>
            <button class="code-action-btn wrap-btn" onclick="toggleCodeWrap(this)" title="Toggle Line Wrapping">
                <iconify-icon icon="solar:text-italic-linear"></iconify-icon>
                Wrap
            </button>
            <button class="code-action-btn copy-btn" onclick="copyCodeSnippet(this)" title="Copy Code">
                <iconify-icon icon="solar:copy-linear"></iconify-icon>
                Copy
            </button>
            <button class="code-action-btn delete" onclick="deleteCodeBlock(this)" title="Delete Block">
                <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
            </button>
        </div>
    `;

    const textarea = document.createElement('textarea');
    textarea.className = 'code';
    textarea.setAttribute('language', mode);
    textarea.setAttribute('data-label', label);
    textarea.value = selectedText;
    textarea.textContent = selectedText;

    wrapper.appendChild(header);
    wrapper.appendChild(textarea);

    if (range && content.contains(range.startContainer)) {
        let topNode = range.startContainer;
        while (topNode && topNode.parentElement !== content) {
            topNode = topNode.parentElement;
        }

        if (!range.collapsed) {
            range.deleteContents();
        }

        if (topNode && topNode.parentElement === content) {
            const isEmptyText = !topNode.textContent || topNode.textContent.trim() === '';
            const isJustBr = topNode.children.length === 1 && topNode.firstElementChild && topNode.firstElementChild.tagName === 'BR';
            if ((isEmptyText || isJustBr) && !topNode.classList.contains('code-block-wrapper') && !topNode.classList.contains('media-container')) {
                topNode.replaceWith(wrapper);
            } else if (topNode.nextSibling) {
                content.insertBefore(wrapper, topNode.nextSibling);
            } else {
                content.appendChild(wrapper);
            }
        } else {
            content.appendChild(wrapper);
        }
    } else {
        content.appendChild(wrapper);
    }

    if (!wrapper.nextSibling) {
        const nextLine = document.createElement('p');
        nextLine.innerHTML = '<br>';
        content.appendChild(nextLine);
    }

    savedCodeBlockRange = null;

    processCodeBlock();

    hasUnsavedChanges = true;
    if (unsavedDot) unsavedDot.classList.add('active');
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
    if (typeof updateStatusBarStats === 'function') updateStatusBarStats();

    setTimeout(() => {
        const cmEl = wrapper.querySelector('.CodeMirror');
        if (cmEl && cmEl.CodeMirror) {
            cmEl.CodeMirror.focus();
            if (selectedText) {
                cmEl.CodeMirror.setCursor(cmEl.CodeMirror.lineCount(), 0);
            }
        }
    }, 60);

    if (selectedText.trim()) {
        showToast(`Code block created (${label})`, 'success');
    }
}

// Create Code Block (with optional initial code content)
// Build a detached code block element (header + textarea) without inserting it.
// Shared by the editor's "insert code block" flow and Quick Capture.
function buildCodeBlockElement(mode, label = null, initialContent = '') {
    const langMeta = getLanguageMeta(mode, label);
    const displayLabel = label || langMeta.name || mode.replace('text/x-', '').replace('src', '');
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    wrapper.setAttribute('contenteditable', 'false');

    const header = document.createElement('div');
    header.className = 'code-block-header';
    header.innerHTML = `
        <div class="code-header-left">
            <span class="block-drag-handle code-drag-handle" draggable="true" title="Drag to reorder">
                <iconify-icon icon="solar:menu-dots-bold"></iconify-icon>
            </span>
            <div class="code-window-dots">
                <span class="code-dot red"></span>
                <span class="code-dot yellow"></span>
                <span class="code-dot green"></span>
            </div>
            <span class="code-lang-tag clickable" onclick="openBlockLangSwitcher(this)" title="Change code language">
                <iconify-icon class="lang-icon" icon="${langMeta.icon}"></iconify-icon>
                <span class="lang-name">${displayLabel}</span>
                <iconify-icon class="lang-caret" icon="solar:alt-arrow-down-linear"></iconify-icon>
            </span>
        </div>
        <div class="code-block-actions">
            <button class="code-action-btn move-up-btn" onclick="moveBlockUp(this)" title="Move Up">
                <iconify-icon icon="solar:alt-arrow-up-linear"></iconify-icon>
            </button>
            <button class="code-action-btn move-down-btn" onclick="moveBlockDown(this)" title="Move Down">
                <iconify-icon icon="solar:alt-arrow-down-linear"></iconify-icon>
            </button>
            <button class="code-action-btn wrap-btn" onclick="toggleCodeWrap(this)" title="Toggle Line Wrapping">
                <iconify-icon icon="solar:text-italic-linear"></iconify-icon>
                Wrap
            </button>
            <button class="code-action-btn copy-btn" onclick="copyCodeSnippet(this)" title="Copy Code">
                <iconify-icon icon="solar:copy-linear"></iconify-icon>
                Copy
            </button>
            <button class="code-action-btn delete" onclick="deleteCodeBlock(this)" title="Delete Block">
                <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
            </button>
        </div>
    `;

    const textarea = document.createElement('textarea');
    textarea.className = 'code';
    textarea.setAttribute('language', mode);
    textarea.setAttribute('data-label', displayLabel);
    textarea.value = initialContent || '';
    textarea.textContent = initialContent || '';

    wrapper.appendChild(header);
    wrapper.appendChild(textarea);
    return wrapper;
}

function createCodeBlock(mode, label = null, initialContent = '') {
    closeAllModals();

    const wrapper = buildCodeBlockElement(mode, label, initialContent);

    // Insert at caret if user was editing inside #content
    if (savedCodeBlockRange && content && content.contains(savedCodeBlockRange.startContainer)) {
        let node = savedCodeBlockRange.startContainer;
        while (node && node.parentElement !== content) {
            node = node.parentElement;
        }
        if (node && node.parentElement === content) {
            if (node.nextSibling) {
                content.insertBefore(wrapper, node.nextSibling);
            } else {
                content.appendChild(wrapper);
                const nextLine = document.createElement('p');
                nextLine.innerHTML = '<br>';
                content.appendChild(nextLine);
            }
        } else {
            savedCodeBlockRange.collapse(false);
            savedCodeBlockRange.insertNode(wrapper);
            if (!wrapper.nextSibling) {
                const nextLine = document.createElement('p');
                nextLine.innerHTML = '<br>';
                content.appendChild(nextLine);
            }
        }
    } else {
        content.appendChild(wrapper);
        const nextLine = document.createElement('p');
        nextLine.innerHTML = '<br>';
        content.appendChild(nextLine);
    }
    savedCodeBlockRange = null;

    processCodeBlock();

    hasUnsavedChanges = true;
    if (unsavedDot) unsavedDot.classList.add('active');

    // Focus the new CodeMirror block
    setTimeout(() => {
        const cmEl = wrapper.querySelector('.CodeMirror');
        if (cmEl && cmEl.CodeMirror) {
            cmEl.CodeMirror.focus();
        }
    }, 60);
}

// Copy Code Snippet
function copyCodeSnippet(btn) {
    const wrapper = btn.closest('.code-block-wrapper');
    if (!wrapper) return;

    let textToCopy = '';
    const cm = wrapper.querySelector('.CodeMirror');
    if (cm && cm.CodeMirror) {
        textToCopy = cm.CodeMirror.getValue();
    } else {
        const ta = wrapper.querySelector('textarea.code');
        if (ta) textToCopy = ta.value || ta.textContent;
    }

    navigator.clipboard.writeText(textToCopy).then(() => {
        const origHTML = btn.innerHTML;
        btn.innerHTML = `<iconify-icon icon="solar:check-circle-bold" style="color:var(--success)"></iconify-icon> Copied!`;
        setTimeout(() => {
            btn.innerHTML = origHTML;
        }, 1800);
        showToast('Code copied to clipboard', 'success');
    }).catch(err => {
        console.error('Failed to copy code:', err);
    });
}

// Toggle Code Block Line Wrapping
function toggleCodeWrap(btn) {
    const wrapper = btn.closest('.code-block-wrapper');
    if (!wrapper) return;
    const cmEl = wrapper.querySelector('.CodeMirror');
    if (cmEl && cmEl.CodeMirror) {
        const currentWrap = cmEl.CodeMirror.getOption('lineWrapping');
        cmEl.CodeMirror.setOption('lineWrapping', !currentWrap);
        btn.classList.toggle('active', !currentWrap);
        showToast(!currentWrap ? 'Line wrapping enabled' : 'Line wrapping disabled', 'info');
    }
}

// Delete Code Block
function deleteCodeBlock(btn) {
    const wrapper = btn.closest('.code-block-wrapper');
    if (wrapper) {
        wrapper.remove();
        hasUnsavedChanges = true;
        if (unsavedDot) unsavedDot.classList.add('active');
        showToast('Code block removed', 'info');
    }
}

// Dynamic Theme Loader for all 65 CodeMirror themes
function ensureThemeLoaded(themeName) {
    if (!themeName) return;
    const existing = document.querySelector(`link[data-code-theme="${themeName}"]`);
    if (!existing) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `src/code-theme/${themeName}.css`;
        link.setAttribute('data-code-theme', themeName);
        document.head.appendChild(link);
    }
}

// Convert legacy Nosh code blocks (.code-block-layer) to modern .code-block-wrapper
function upgradeLegacyCodeBlocks() {
    if (!content) return;

    // 1. Convert any legacy .code-block-layer containers into .code-block-wrapper
    const legacyLayers = content.querySelectorAll('.code-block-layer');
    legacyLayers.forEach(layer => {
        const parent = layer.parentElement;
        const textarea = parent ? parent.querySelector('textarea.code') : null;
        if (!textarea) return;

        const langP = layer.querySelector('p');
        const langStr = (langP ? langP.textContent.trim() : '') || textarea.getAttribute('language') || 'javascript';
        const langMeta = getLanguageMeta(langStr);
        const displayLabel = langMeta.name || langStr;

        let codeText = textarea.value || '';
        if (!codeText) {
            const deadCM = parent.querySelector('.CodeMirror');
            if (deadCM) {
                const lines = deadCM.querySelectorAll('.CodeMirror-line');
                if (lines && lines.length > 0) {
                    codeText = Array.from(lines).map(l => l.textContent).join('\n');
                }
            }
        }
        if (!codeText) codeText = textarea.textContent || '';

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        wrapper.setAttribute('contenteditable', 'false');

        const header = document.createElement('div');
        header.className = 'code-block-header';
        header.innerHTML = `
            <div class="code-header-left">
                <span class="block-drag-handle code-drag-handle" draggable="true" title="Drag to reorder">
                    <iconify-icon icon="solar:menu-dots-bold"></iconify-icon>
                </span>
                <div class="code-window-dots">
                    <span class="code-dot red"></span>
                    <span class="code-dot yellow"></span>
                    <span class="code-dot green"></span>
                </div>
                <span class="code-lang-tag clickable" onclick="openBlockLangSwitcher(this)" title="Change code language">
                    <iconify-icon class="lang-icon" icon="${langMeta.icon}"></iconify-icon>
                    <span class="lang-name">${displayLabel}</span>
                    <iconify-icon class="lang-caret" icon="solar:alt-arrow-down-linear"></iconify-icon>
                </span>
            </div>
            <div class="code-block-actions">
                <button class="code-action-btn move-up-btn" onclick="moveBlockUp(this)" title="Move Up">
                    <iconify-icon icon="solar:alt-arrow-up-linear"></iconify-icon>
                </button>
                <button class="code-action-btn move-down-btn" onclick="moveBlockDown(this)" title="Move Down">
                    <iconify-icon icon="solar:alt-arrow-down-linear"></iconify-icon>
                </button>
                <button class="code-action-btn wrap-btn" onclick="toggleCodeWrap(this)" title="Toggle Line Wrapping">
                    <iconify-icon icon="solar:text-italic-linear"></iconify-icon>
                    Wrap
                </button>
                <button class="code-action-btn copy-btn" onclick="copyCodeSnippet(this)" title="Copy Code">
                    <iconify-icon icon="solar:copy-linear"></iconify-icon>
                    Copy
                </button>
                <button class="code-action-btn delete" onclick="deleteCodeBlock(this)" title="Delete Block">
                    <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
                </button>
            </div>
        `;

        const newTa = document.createElement('textarea');
        newTa.className = 'code';
        newTa.setAttribute('language', langMeta.mode);
        newTa.setAttribute('data-label', displayLabel);
        newTa.value = codeText;
        newTa.textContent = codeText;

        wrapper.appendChild(header);
        wrapper.appendChild(newTa);

        if (parent === content) {
            layer.remove();
            textarea.replaceWith(wrapper);
        } else {
            parent.replaceWith(wrapper);
        }
    });

    // 2. Also convert any orphaned textarea.code outside .code-block-wrapper
    const orphanedTextareas = content.querySelectorAll('textarea.code');
    orphanedTextareas.forEach(textarea => {
        if (textarea.closest('.code-block-wrapper')) return;
        const parent = textarea.parentElement;
        const lang = textarea.getAttribute('language') || 'javascript';
        const langMeta = getLanguageMeta(lang);
        const displayLabel = textarea.getAttribute('data-label') || langMeta.name || lang;

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        wrapper.setAttribute('contenteditable', 'false');

        const header = document.createElement('div');
        header.className = 'code-block-header';
        header.innerHTML = `
            <div class="code-header-left">
                <span class="block-drag-handle code-drag-handle" draggable="true" title="Drag to reorder">
                    <iconify-icon icon="solar:menu-dots-bold"></iconify-icon>
                </span>
                <div class="code-window-dots">
                    <span class="code-dot red"></span>
                    <span class="code-dot yellow"></span>
                    <span class="code-dot green"></span>
                </div>
                <span class="code-lang-tag clickable" onclick="openBlockLangSwitcher(this)" title="Change code language">
                    <iconify-icon class="lang-icon" icon="${langMeta.icon}"></iconify-icon>
                    <span class="lang-name">${displayLabel}</span>
                    <iconify-icon class="lang-caret" icon="solar:alt-arrow-down-linear"></iconify-icon>
                </span>
            </div>
            <div class="code-block-actions">
                <button class="code-action-btn move-up-btn" onclick="moveBlockUp(this)" title="Move Up">
                    <iconify-icon icon="solar:alt-arrow-up-linear"></iconify-icon>
                </button>
                <button class="code-action-btn move-down-btn" onclick="moveBlockDown(this)" title="Move Down">
                    <iconify-icon icon="solar:alt-arrow-down-linear"></iconify-icon>
                </button>
                <button class="code-action-btn wrap-btn" onclick="toggleCodeWrap(this)" title="Toggle Line Wrapping">
                    <iconify-icon icon="solar:text-italic-linear"></iconify-icon>
                    Wrap
                </button>
                <button class="code-action-btn copy-btn" onclick="copyCodeSnippet(this)" title="Copy Code">
                    <iconify-icon icon="solar:copy-linear"></iconify-icon>
                    Copy
                </button>
                <button class="code-action-btn delete" onclick="deleteCodeBlock(this)" title="Delete Block">
                    <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
                </button>
            </div>
        `;

        const codeVal = textarea.value || textarea.textContent || '';
        const newTa = document.createElement('textarea');
        newTa.className = 'code';
        newTa.setAttribute('language', langMeta.mode);
        newTa.setAttribute('data-label', displayLabel);
        newTa.value = codeVal;
        newTa.textContent = codeVal;

        wrapper.appendChild(header);
        wrapper.appendChild(newTa);

        if (parent && parent !== content && parent.children.length <= 2) {
            parent.replaceWith(wrapper);
        } else {
            textarea.replaceWith(wrapper);
        }
    });
}

// Ensure code block header contains all modern controls (drag handle, move buttons)
function ensureCodeBlockControls(wrapper) {
    if (!wrapper) return;
    const header = wrapper.querySelector('.code-block-header');
    if (!header) return;

    const left = header.querySelector('.code-header-left');
    if (left && !left.querySelector('.block-drag-handle')) {
        const handle = document.createElement('span');
        handle.className = 'block-drag-handle code-drag-handle';
        handle.setAttribute('draggable', 'true');
        handle.setAttribute('title', 'Drag to reorder');
        handle.innerHTML = `<iconify-icon icon="solar:menu-dots-bold"></iconify-icon>`;
        left.insertBefore(handle, left.firstChild);
    }

    const actions = header.querySelector('.code-block-actions');
    if (actions && !actions.querySelector('.move-up-btn')) {
        const upBtn = document.createElement('button');
        upBtn.className = 'code-action-btn move-up-btn';
        upBtn.setAttribute('title', 'Move Up');
        upBtn.setAttribute('onclick', 'moveBlockUp(this)');
        upBtn.innerHTML = `<iconify-icon icon="solar:alt-arrow-up-linear"></iconify-icon>`;

        const downBtn = document.createElement('button');
        downBtn.className = 'code-action-btn move-down-btn';
        downBtn.setAttribute('title', 'Move Down');
        downBtn.setAttribute('onclick', 'moveBlockDown(this)');
        downBtn.innerHTML = `<iconify-icon icon="solar:alt-arrow-down-linear"></iconify-icon>`;

        actions.insertBefore(downBtn, actions.firstChild);
        actions.insertBefore(upBtn, actions.firstChild);
    }
}

// Initialize CodeMirror on textareas
function processCodeBlock() {
    if (!content) return;
    upgradeLegacyCodeBlocks();

    const activeTheme = localStorage.getItem('code-theme') || 'dracula';
    ensureThemeLoaded(activeTheme);

    const wrappers = document.querySelectorAll('.code-block-wrapper');

    wrappers.forEach(wrapper => {
        // Skip settings preview which handles its own initialization
        if (wrapper.id === 'settings-theme-preview') return;

        ensureCodeBlockControls(wrapper);

        const textarea = wrapper.querySelector('textarea.code');
        if (!textarea) return;

        const existingCM = wrapper.querySelector('.CodeMirror');
        if (existingCM && existingCM.CodeMirror) {
            // Already has live CodeMirror attached - update theme if changed
            if (existingCM.CodeMirror.getOption('theme') !== activeTheme) {
                existingCM.CodeMirror.setOption('theme', activeTheme);
            }
            return;
        }

        // Attach language switcher to header tag if not already attached
        const tag = wrapper.querySelector('.code-lang-tag');
        if (tag && !tag.hasAttribute('onclick')) {
            tag.classList.add('clickable');
            tag.setAttribute('onclick', 'openBlockLangSwitcher(this)');
            tag.setAttribute('title', 'Change code language');
            if (!tag.querySelector('.lang-caret')) {
                const caret = document.createElement('iconify-icon');
                caret.className = 'lang-caret';
                caret.setAttribute('icon', 'solar:alt-arrow-down-linear');
                tag.appendChild(caret);
            }
        }

        // Clean any dead static CodeMirror DOM nodes from innerHTML restore
        wrapper.querySelectorAll('.CodeMirror').forEach(el => el.remove());

        const mode = textarea.getAttribute('language') || 'javascript';
        textarea.style.display = 'block';

        const cm = CodeMirror.fromTextArea(textarea, {
            lineNumbers: true,
            mode: mode,
            theme: activeTheme,
            autoCloseBrackets: true,
            indentUnit: 4,
            smartIndent: true,
            indentWithTabs: true,
            matchBrackets: true,
            fixedGutter: true,
            keyMap: 'sublime',
            extraKeys: {
                'Shift-Enter': function(editorInstance) {
                    const editorContainer = wrapper.closest('#content') || document.getElementById('content');
                    if (!editorContainer) return;
                    let emptyLine = wrapper.nextElementSibling;
                    if (!emptyLine || emptyLine.tagName !== 'P' || emptyLine.innerHTML.trim() !== '<br>') {
                        emptyLine = document.createElement('p');
                        emptyLine.innerHTML = '<br>';
                        if (wrapper.nextSibling) {
                            editorContainer.insertBefore(emptyLine, wrapper.nextSibling);
                        } else {
                            editorContainer.appendChild(emptyLine);
                        }
                    }
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.setStart(emptyLine, 0);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    emptyLine.focus();
                }
            }
        });

        cm.setSize('100%', 'auto');

        cm.on('change', () => {
            const currentVal = cm.getValue();
            textarea.value = currentVal;
            textarea.textContent = currentVal;

            // Real-time automatic language detection (until user manually picks a language)
            if (wrapper.getAttribute('data-manual-lang') !== 'true') {
                clearTimeout(wrapper._autoDetectTimer);
                wrapper._autoDetectTimer = setTimeout(() => {
                    const code = cm.getValue().trim();
                    if (code.length >= 4) {
                        const detected = detectCodeLanguage(code);
                        const curMode = textarea.getAttribute('language');
                        const curLabel = textarea.getAttribute('data-label');
                        if (detected.mode !== curMode || detected.name !== curLabel) {
                            textarea.setAttribute('language', detected.mode);
                            textarea.setAttribute('data-label', detected.name);
                            cm.setOption('mode', detected.mode);
                            const tag = wrapper.querySelector('.code-lang-tag');
                            if (tag) {
                                tag.innerHTML = `
                                    <iconify-icon class="lang-icon" icon="${detected.icon}"></iconify-icon>
                                    <span class="lang-name">${detected.name}</span>
                                    <iconify-icon class="lang-caret" icon="solar:alt-arrow-down-linear"></iconify-icon>
                                `;
                            }
                        }
                    }
                }, 300);
            }

            if (typeof triggerAutoSave === 'function') {
                triggerAutoSave();
            } else {
                hasUnsavedChanges = true;
                if (unsavedDot) unsavedDot.classList.add('active');
            }
        });
    });
}

// Code Themes in Settings
function renderSettingsThemes() {
    const grid = document.getElementById('themes-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const currentTheme = localStorage.getItem('code-theme') || 'dracula';

    codeBlockThemes.forEach(theme => {
        const btn = document.createElement('button');
        btn.className = `theme-option-btn ${theme === currentTheme ? 'selected' : ''}`;
        btn.textContent = theme;
        btn.onclick = () => {
            localStorage.setItem('code-theme', theme);
            ensureThemeLoaded(theme);
            document.querySelectorAll('.theme-option-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            processCodeBlock();
            updateSettingsThemePreview();
        };
        grid.appendChild(btn);
    });

    ensureThemeLoaded(currentTheme);
    updateSettingsThemePreview();
}

function filterSettingsThemes(filter) {
    const q = (filter || '').toLowerCase();
    document.querySelectorAll('#themes-grid .theme-option-btn').forEach(btn => {
        const txt = btn.textContent.toLowerCase();
        btn.style.display = txt.includes(q) ? 'flex' : 'none';
    });
}

function updateSettingsThemePreview() {
    const previewContainer = document.getElementById('settings-theme-preview');
    if (!previewContainer) return;
    previewContainer.innerHTML = '';

    const theme = localStorage.getItem('code-theme') || 'dracula';
    ensureThemeLoaded(theme);
    const header = document.createElement('div');
    header.className = 'code-block-header';
    header.innerHTML = `
        <div class="code-header-left">
            <div class="code-window-dots">
                <span class="code-dot red"></span>
                <span class="code-dot yellow"></span>
                <span class="code-dot green"></span>
            </div>
            <span class="code-lang-tag">
                <iconify-icon class="lang-icon" icon="logos:python"></iconify-icon>
                <span class="lang-name">Python</span>
            </span>
        </div>
        <div class="code-block-actions">
            <span class="theme-pill-badge">${theme}</span>
        </div>
    `;

    const ta = document.createElement('textarea');
    ta.value = `# Fast Fibonacci Generator with Memoization\ndef fibonacci(n: int, memo: dict = {}) -> int:\n    if n in memo:\n        return memo[n]\n    if n <= 1:\n        return n\n    memo[n] = fibonacci(n - 1, memo) + fibonacci(n - 2, memo)\n    return memo[n]\n\n# Calculate first 10 numbers\nprint([fibonacci(i) for i in range(10)])`;

    previewContainer.appendChild(header);
    previewContainer.appendChild(ta);

    const cm = CodeMirror.fromTextArea(ta, {
        lineNumbers: true,
        mode: 'python',
        theme: theme,
        readOnly: true,
        tabSize: 4
    });
    cm.setSize('100%', '100%');
    setTimeout(() => cm.refresh(), 50);
}

// In-Block Live Language Switcher
let currentSwitchingWrapper = null;

function openBlockLangSwitcher(tagEl) {
    const wrapper = tagEl.closest('.code-block-wrapper');
    if (!wrapper) return;
    currentSwitchingWrapper = wrapper;

    let dropdown = document.getElementById('block-lang-dropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'block-lang-dropdown';
        dropdown.className = 'block-lang-dropdown';
        dropdown.innerHTML = `
            <div class="block-lang-search-wrap">
                <iconify-icon icon="solar:magnifer-linear"></iconify-icon>
                <input type="text" id="block-lang-search" placeholder="Switch language...">
            </div>
            <div class="block-lang-list" id="block-lang-list"></div>
        `;
        document.body.appendChild(dropdown);

        const searchInput = dropdown.querySelector('#block-lang-search');
        searchInput.addEventListener('input', (e) => {
            renderBlockLangItems(e.target.value.toLowerCase().trim());
        });
        searchInput.addEventListener('click', (e) => e.stopPropagation());
        dropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    renderBlockLangItems('');
    const searchInput = dropdown.querySelector('#block-lang-search');
    if (searchInput) searchInput.value = '';

    const rect = tagEl.getBoundingClientRect();
    dropdown.style.display = 'block';
    dropdown.style.top = `${rect.bottom + 6}px`;
    dropdown.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;

    setTimeout(() => {
        if (searchInput) searchInput.focus();
    }, 50);
}

function renderBlockLangItems(filter = '') {
    const list = document.getElementById('block-lang-list');
    if (!list) return;
    list.innerHTML = '';

    const lower = (filter || '').toLowerCase().trim();
    if (!lower || 'auto detect'.includes(lower)) {
        const autoItem = document.createElement('div');
        autoItem.className = 'block-lang-item auto-detect-item';
        autoItem.innerHTML = `
            <iconify-icon icon="solar:magic-stick-3-linear"></iconify-icon>
            <span>Auto Detect (Real-time)</span>
        `;
        autoItem.onclick = () => autoDetectCurrentBlockLanguage();
        list.appendChild(autoItem);
    }

    const filtered = supportedLanguages.filter(l => l.name.toLowerCase().includes(lower));
    filtered.forEach(lang => {
        const item = document.createElement('div');
        item.className = 'block-lang-item';
        item.innerHTML = `
            <iconify-icon icon="${lang.icon}"></iconify-icon>
            <span>${lang.name}</span>
        `;
        item.onclick = () => switchBlockLanguage(lang.mode, lang.name, lang.icon, true);
        list.appendChild(item);
    });
}

function autoDetectCurrentBlockLanguage() {
    if (!currentSwitchingWrapper) return;
    const wrapper = currentSwitchingWrapper;
    wrapper.removeAttribute('data-manual-lang');

    let codeText = '';
    const cmEl = wrapper.querySelector('.CodeMirror');
    if (cmEl && cmEl.CodeMirror) {
        codeText = cmEl.CodeMirror.getValue();
    } else {
        const ta = wrapper.querySelector('textarea.code');
        if (ta) codeText = ta.value || ta.textContent;
    }

    const detected = detectCodeLanguage(codeText);
    switchBlockLanguage(detected.mode, detected.name, detected.icon, false);
    showToast(`Auto-detected: ${detected.name}`, 'info');
}

function switchBlockLanguage(mode, label, icon, isManualChoice = true) {
    if (!currentSwitchingWrapper) return;
    const wrapper = currentSwitchingWrapper;
    const textarea = wrapper.querySelector('textarea.code');
    const tag = wrapper.querySelector('.code-lang-tag');
    const cmEl = wrapper.querySelector('.CodeMirror');

    if (isManualChoice) {
        wrapper.setAttribute('data-manual-lang', 'true');
    }

    if (textarea) {
        textarea.setAttribute('language', mode);
        textarea.setAttribute('data-label', label);
    }

    if (tag) {
        tag.innerHTML = `
            <iconify-icon class="lang-icon" icon="${icon}"></iconify-icon>
            <span class="lang-name">${label}</span>
            <iconify-icon class="lang-caret" icon="solar:alt-arrow-down-linear"></iconify-icon>
        `;
    }

    if (cmEl && cmEl.CodeMirror) {
        cmEl.CodeMirror.setOption('mode', mode);
    }

    closeBlockLangSwitcher();
    hasUnsavedChanges = true;
    if (unsavedDot) unsavedDot.classList.add('active');
    if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
    showToast(`Language switched to ${label}`, 'success');
}

function closeBlockLangSwitcher() {
    const dropdown = document.getElementById('block-lang-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    currentSwitchingWrapper = null;
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#block-lang-dropdown') && !e.target.closest('.code-lang-tag')) {
        closeBlockLangSwitcher();
    }
});

// Initialize active theme on startup
try {
    ensureThemeLoaded(localStorage.getItem('code-theme') || 'dracula');
} catch (e) {
    console.warn('Initial code theme load:', e);
}

// Smart Selection & Copy Interceptor: Seamlessly Include Code Blocks in Copying
document.addEventListener('copy', (e) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const contentEl = document.getElementById('content');
    if (!contentEl) return;

    // Check if selection is within or intersects #content
    if (!contentEl.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== contentEl && !range.intersectsNode(contentEl)) {
        return;
    }

    // If focused strictly inside an active CodeMirror editor, allow internal CodeMirror copy
    const activeEl = document.activeElement;
    if (activeEl && activeEl.closest('.CodeMirror')) {
        return;
    }

    const allBlocks = Array.from(contentEl.querySelectorAll('.code-block-wrapper'));
    if (allBlocks.length === 0) return;

    const intersected = allBlocks.filter(b => range.intersectsNode(b));
    if (intersected.length === 0) return;

    // Check if selection start and end are strictly inside the same single code block
    const getBlockWrapper = (node) => {
        if (!node) return null;
        return node.nodeType === Node.ELEMENT_NODE ? node.closest('.code-block-wrapper') : node.parentElement?.closest('.code-block-wrapper');
    };
    const startWrapper = getBlockWrapper(range.startContainer);
    const endWrapper = getBlockWrapper(range.endContainer);
    if (startWrapper && endWrapper && startWrapper === endWrapper) {
        return;
    }

    // Deterministically tag code block wrappers before cloning
    allBlocks.forEach((b, idx) => b.setAttribute('data-copy-idx', idx.toString()));
    const frag = range.cloneContents();
    allBlocks.forEach(b => b.removeAttribute('data-copy-idx'));

    const tempDiv = document.createElement('div');
    tempDiv.appendChild(frag);

    const clonedWrappers = tempDiv.querySelectorAll('.code-block-wrapper');
    clonedWrappers.forEach((cloned) => {
        const idxStr = cloned.getAttribute('data-copy-idx');
        const orig = idxStr !== null ? allBlocks[parseInt(idxStr, 10)] : null;
        let codeText = '';
        let langLabel = 'code';

        if (orig) {
            const cm = orig.querySelector('.CodeMirror');
            if (cm && cm.CodeMirror) {
                codeText = cm.CodeMirror.getValue();
            } else {
                const ta = orig.querySelector('textarea.code');
                if (ta) codeText = ta.value || ta.textContent || '';
            }
            const tag = orig.querySelector('.lang-name') || orig.querySelector('textarea.code');
            if (tag) {
                langLabel = tag.textContent.trim().toLowerCase() || tag.getAttribute('language') || 'code';
            }
        } else {
            const ta = cloned.querySelector('textarea.code');
            if (ta) codeText = ta.value || ta.textContent || '';
        }

        const pre = document.createElement('pre');
        const codeEl = document.createElement('code');
        codeEl.className = `language-${langLabel}`;
        codeEl.textContent = codeText;
        pre.appendChild(codeEl);

        cloned.replaceWith(pre);
    });

    function getPlainText(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }
        if (node.nodeName === 'PRE') {
            const codeEl = node.querySelector('code');
            const lang = codeEl ? (codeEl.className.replace('language-', '') || '') : '';
            const code = codeEl ? codeEl.textContent : node.textContent;
            return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        }
        if (node.nodeName === 'BR') {
            return '\n';
        }
        let text = '';
        node.childNodes.forEach(child => {
            text += getPlainText(child);
        });
        const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE'];
        if (blockTags.includes(node.nodeName)) {
            text = text + '\n';
        }
        return text;
    }

    const plainText = getPlainText(tempDiv).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const richHtml = tempDiv.innerHTML;

    e.clipboardData.setData('text/plain', plainText);
    e.clipboardData.setData('text/html', richHtml);
    e.preventDefault();
});

// ==========================================================================
// Block Reordering & Drag-and-Drop Management (Code Blocks, Images, Videos)
// ==========================================================================

let draggedBlock = null;

function getReorderableParent(el) {
    if (!el || !content) return null;
    let curr = el;
    while (curr && curr !== content) {
        if (curr.parentElement === content) {
            return curr;
        }
        curr = curr.parentElement;
    }
    return null;
}

function highlightMovedBlock(block) {
    if (!block) return;
    block.classList.remove('block-moved-pulse');
    void block.offsetWidth;
    block.classList.add('block-moved-pulse');
    setTimeout(() => {
        block.classList.remove('block-moved-pulse');
    }, 1200);
}

function moveBlockUp(btnOrEl) {
    const block = getReorderableParent(btnOrEl);
    if (!block || !content) return;

    let prev = block.previousElementSibling;
    if (!prev) {
        showToast('Already at the top', 'info');
        return;
    }

    content.insertBefore(block, prev);

    const cmEl = block.querySelector('.CodeMirror');
    if (cmEl && cmEl.CodeMirror) {
        cmEl.CodeMirror.refresh();
    }

    highlightMovedBlock(block);
    hasUnsavedChanges = true;
    if (unsavedDot) unsavedDot.classList.add('active');
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
    if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
}

function moveBlockDown(btnOrEl) {
    const block = getReorderableParent(btnOrEl);
    if (!block || !content) return;

    let next = block.nextElementSibling;
    if (!next) {
        showToast('Already at the bottom', 'info');
        return;
    }

    content.insertBefore(block, next.nextElementSibling);

    const cmEl = block.querySelector('.CodeMirror');
    if (cmEl && cmEl.CodeMirror) {
        cmEl.CodeMirror.refresh();
    }

    highlightMovedBlock(block);
    hasUnsavedChanges = true;
    if (unsavedDot) unsavedDot.classList.add('active');
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
    if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
}

function getDropTargetFromPoint(clientY) {
    if (!content) return null;
    const children = Array.from(content.children).filter(el => 
        el !== draggedBlock && 
        el.nodeType === Node.ELEMENT_NODE &&
        !el.classList.contains('media-toolbar')
    );
    if (children.length === 0) return null;

    for (const child of children) {
        const rect = child.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            return { element: child, isUpper: (clientY - rect.top) < (rect.height / 2) };
        }
    }

    if (clientY < children[0].getBoundingClientRect().top) {
        return { element: children[0], isUpper: true };
    }
    const last = children[children.length - 1];
    return { element: last, isUpper: false };
}

function initBlockDragAndDrop() {
    if (!content) return;

    document.addEventListener('dragstart', (e) => {
        const handle = e.target.closest('.block-drag-handle');
        if (!handle) return;

        const block = getReorderableParent(handle);
        if (!block) return;

        draggedBlock = block;
        block.classList.add('is-dragging');

        // Prevent contenteditable from hijacking drop events
        if (content) {
            content.setAttribute('contenteditable', 'false');
        }

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'nosh-reorder-block');
        }
    });

    const cleanupDragState = () => {
        if (draggedBlock) {
            draggedBlock.classList.remove('is-dragging');
            draggedBlock = null;
        }
        if (content) {
            content.setAttribute('contenteditable', 'true');
            content.querySelectorAll('.block-drop-top, .block-drop-bottom').forEach(el => {
                el.classList.remove('block-drop-top', 'block-drop-bottom');
            });
        }
    };

    document.addEventListener('dragend', cleanupDragState);

    const handleDragOver = (e) => {
        if (!draggedBlock) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

        const targetInfo = getDropTargetFromPoint(e.clientY);
        content.querySelectorAll('.block-drop-top, .block-drop-bottom').forEach(el => {
            if (!targetInfo || el !== targetInfo.element) {
                el.classList.remove('block-drop-top', 'block-drop-bottom');
            }
        });

        if (targetInfo && targetInfo.element) {
            if (targetInfo.isUpper) {
                targetInfo.element.classList.add('block-drop-top');
                targetInfo.element.classList.remove('block-drop-bottom');
            } else {
                targetInfo.element.classList.add('block-drop-bottom');
                targetInfo.element.classList.remove('block-drop-top');
            }
        }
    };

    content.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragover', (e) => {
        if (draggedBlock && e.target.closest('#editor-scroll-area')) {
            handleDragOver(e);
        }
    });

    content.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !content.contains(e.relatedTarget)) {
            content.querySelectorAll('.block-drop-top, .block-drop-bottom').forEach(el => {
                el.classList.remove('block-drop-top', 'block-drop-bottom');
            });
        }
    });

    const handleDrop = (e) => {
        if (!draggedBlock) return;
        e.preventDefault();
        e.stopPropagation();

        const targetInfo = getDropTargetFromPoint(e.clientY);
        if (targetInfo && targetInfo.element && targetInfo.element !== draggedBlock) {
            if (targetInfo.isUpper) {
                content.insertBefore(draggedBlock, targetInfo.element);
            } else {
                content.insertBefore(draggedBlock, targetInfo.element.nextElementSibling);
            }

            const cmEl = draggedBlock.querySelector('.CodeMirror');
            if (cmEl && cmEl.CodeMirror) {
                cmEl.CodeMirror.refresh();
            }

            highlightMovedBlock(draggedBlock);
            hasUnsavedChanges = true;
            if (unsavedDot) unsavedDot.classList.add('active');
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
        }

        cleanupDragState();
    };

    content.addEventListener('drop', handleDrop);
    document.addEventListener('drop', (e) => {
        if (draggedBlock && e.target.closest('#editor-scroll-area')) {
            handleDrop(e);
        }
    });
}

// Initialize block drag-and-drop on startup
if (typeof document !== 'undefined') {
    initBlockDragAndDrop();
}
