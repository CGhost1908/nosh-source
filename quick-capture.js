// Quick Capture window logic (sandboxed; talks to the app only via window.quickCapture)
(() => {
    const input = document.getElementById('capture-input');
    const status = document.getElementById('status');
    const modeButtons = Array.from(document.querySelectorAll('.mode-switch button'));
    const MODE_KEY = 'nosh-quick-capture-mode';

    let mode = 'code';
    let saving = false;

    try {
        const saved = localStorage.getItem(MODE_KEY);
        if (saved === 'code' || saved === 'text') mode = saved;
    } catch (_) {}

    function setStatus(message, kind = '') {
        status.textContent = message;
        status.className = kind;
    }

    function applyMode(nextMode) {
        mode = nextMode;
        modeButtons.forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode)));
        input.classList.toggle('text-mode', mode === 'text');
        try { localStorage.setItem(MODE_KEY, mode); } catch (_) {}
    }

    function insertAtCursor(text) {
        const { selectionStart, selectionEnd, value } = input;
        input.value = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
        input.selectionStart = input.selectionEnd = selectionStart + text.length;
    }

    async function save() {
        if (saving) return;
        const text = input.value;
        if (!text.trim()) {
            setStatus('Nothing to save yet', 'error');
            return;
        }

        saving = true;
        setStatus('Saving...');
        try {
            const result = await window.quickCapture.submit({ text, kind: mode });
            if (result && result.success) {
                input.value = '';
                setStatus('');
            } else {
                // Keep the draft so nothing is lost
                setStatus((result && result.error) || 'Could not save the note', 'error');
            }
        } catch (err) {
            setStatus('Could not save the note', 'error');
        } finally {
            saving = false;
        }
    }

    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            applyMode(btn.dataset.mode);
            input.focus();
        });
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            window.quickCapture.hide();
        } else if (e.key === 'Tab' && !e.shiftKey && mode === 'code') {
            e.preventDefault();
            insertAtCursor('\t');
        }
    });

    window.quickCapture.onShown(() => {
        setStatus('');
        input.focus();
    });

    applyMode(mode);
    input.focus();
})();
