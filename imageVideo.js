// Media Handling (Images & Videos) with Local Assets Directory Sovereignty

async function saveMediaAsset(file) {
    if (!savesDir) await invokeSavesDir();
    const assetsDir = path.join(savesDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
        await fsPromises.mkdir(assetsDir, { recursive: true });
    }

    const cleanBase = path.basename(file.name || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '_');
    const assetFileName = `asset_${Date.now()}_${cleanBase}`;
    const targetPath = path.join(assetsDir, assetFileName);

    // Electron no longer exposes File.path, so media always arrives as bytes
    const arrayBuffer = await file.arrayBuffer();
    await fsPromises.writeFile(targetPath, new Uint8Array(arrayBuffer));
    return `assets/${assetFileName}`;
}

let currentMediaType = 'image';
let currentMediaTab = 'upload';
let selectedMediaFile = null;

const MAX_IMAGE_SIZE_MB = 10;
const MAX_VIDEO_SIZE_MB = 50;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

function validateMediaFileSize(file, type = currentMediaType) {
    if (!file || typeof file.size !== 'number') return true;
    const isVideo = type === 'video' || (file.type && file.type.startsWith('video/'));
    const maxBytes = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
    const maxMb = isVideo ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB;

    if (file.size > maxBytes) {
        const fileSizeMb = (file.size / (1024 * 1024)).toFixed(1);
        if (typeof showToast === 'function') {
            showToast(`File too large (${fileSizeMb} MB). Max allowed size is ${maxMb} MB.`, 'warning');
        }
        return false;
    }
    return true;
}

function switchMediaTab(tab) {
    currentMediaTab = tab;
    const uploadBtn = document.getElementById('media-tab-upload');
    const urlBtn = document.getElementById('media-tab-url');
    const uploadPanel = document.getElementById('media-panel-upload');
    const urlPanel = document.getElementById('media-panel-url');

    if (uploadBtn && urlBtn && uploadPanel && urlPanel) {
        if (tab === 'upload') {
            uploadBtn.classList.add('active');
            urlBtn.classList.remove('active');
            uploadPanel.style.display = 'block';
            urlPanel.style.display = 'none';
        } else {
            urlBtn.classList.add('active');
            uploadBtn.classList.remove('active');
            urlPanel.style.display = 'block';
            uploadPanel.style.display = 'none';
        }
    }
    updateMediaPreview();
}

function handleMediaFileSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!validateMediaFileSize(file, currentMediaType)) {
        e.target.value = '';
        return;
    }
    selectedMediaFile = file;
    renderSelectedFilePill(file);
    updateMediaPreview();
}

function renderSelectedFilePill(file) {
    const wrap = document.getElementById('media-selected-file-wrap');
    const nameEl = document.getElementById('media-selected-file-name');
    const sizeEl = document.getElementById('media-selected-file-size');
    const dropzone = document.getElementById('media-dropzone');

    if (wrap && nameEl && sizeEl) {
        wrap.style.display = 'block';
        if (dropzone) dropzone.style.display = 'none';
        nameEl.textContent = file.name;
        const sizeKb = (file.size / 1024).toFixed(1);
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        sizeEl.textContent = file.size > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;
    }
}

function clearSelectedMediaFile(e) {
    if (e) e.stopPropagation();
    selectedMediaFile = null;
    const fileInput = document.getElementById('media-file-input');
    if (fileInput) fileInput.value = '';
    const wrap = document.getElementById('media-selected-file-wrap');
    const dropzone = document.getElementById('media-dropzone');
    if (wrap) wrap.style.display = 'none';
    if (dropzone) dropzone.style.display = 'block';
    updateMediaPreview();
}

function handleMediaUrlInput(url) {
    updateMediaPreview();
}

function pasteMediaUrlFromClipboard() {
    try {
        const text = nativeClipboard.readText();
        const urlInput = document.getElementById('media-url-input');
        if (urlInput && text) {
            urlInput.value = text.trim();
            handleMediaUrlInput(text.trim());
        }
    } catch {
        if (navigator.clipboard) {
            navigator.clipboard.readText().then(text => {
                const urlInput = document.getElementById('media-url-input');
                if (urlInput && text) {
                    urlInput.value = text.trim();
                    handleMediaUrlInput(text.trim());
                }
            });
        }
    }
}

function updateMediaPreview() {
    const previewBox = document.getElementById('media-preview-box');
    const previewContainer = document.getElementById('media-preview-container');
    const cropBtn = document.getElementById('media-preview-crop-btn');
    if (!previewBox || !previewContainer) return;

    previewContainer.innerHTML = '';
    if (cropBtn) {
        cropBtn.style.display = currentMediaType === 'image' ? 'inline-flex' : 'none';
    }

    if (currentMediaTab === 'upload' && selectedMediaFile) {
        previewBox.style.display = 'block';
        const previewSrc = selectedMediaFile.path
            ? toLocalMediaUrl(selectedMediaFile.path)
            : URL.createObjectURL(selectedMediaFile);
        if (currentMediaType === 'image') {
            const img = document.createElement('img');
            img.src = previewSrc;
            img.onerror = () => {
                const reader = new FileReader();
                reader.onload = (ev) => { img.src = ev.target.result; };
                reader.readAsDataURL(selectedMediaFile);
            };
            previewContainer.appendChild(img);
        } else {
            const video = document.createElement('video');
            video.src = previewSrc;
            video.controls = true;
            previewContainer.appendChild(video);
        }
    } else if (currentMediaTab === 'url') {
        const urlInput = document.getElementById('media-url-input');
        const url = urlInput ? urlInput.value.trim() : '';
        if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('file://'))) {
            previewBox.style.display = 'block';
            if (currentMediaType === 'image') {
                const img = document.createElement('img');
                img.src = url;
                img.onerror = () => { previewBox.style.display = 'none'; };
                previewContainer.appendChild(img);
            } else {
                const video = document.createElement('video');
                video.src = url;
                video.controls = true;
                video.onerror = () => { previewBox.style.display = 'none'; };
                previewContainer.appendChild(video);
            }
        } else {
            previewBox.style.display = 'none';
        }
    } else {
        previewBox.style.display = 'none';
    }
}

function initMediaDropzone() {
    const dropzone = document.getElementById('media-dropzone');
    if (!dropzone || dropzone._initDnD) return;
    dropzone._initDnD = true;

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('drag-active');
    });

    dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('drag-active');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('drag-active');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (!validateMediaFileSize(file, currentMediaType)) {
                return;
            }
            selectedMediaFile = file;
            renderSelectedFilePill(file);
            updateMediaPreview();
        }
    });
}

function openMediaModal(type = 'image') {
    if (!activeNoteName) {
        showToast('Create or open a note first', 'warning');
        return;
    }

    currentMediaType = type;
    selectedMediaFile = null;

    const titleEl = document.getElementById('media-modal-title');
    const iconEl = document.getElementById('media-modal-icon');
    const subtitleEl = document.getElementById('media-modal-subtitle');
    const btnTextEl = document.getElementById('media-confirm-btn-text');
    const formatsEl = document.getElementById('media-dropzone-formats');
    const fileInput = document.getElementById('media-file-input');
    const urlInput = document.getElementById('media-url-input');

    if (titleEl) {
        titleEl.textContent = type === 'image' ? 'Insert Image' : 'Insert Video';
    }
    if (iconEl) {
        iconEl.setAttribute('icon', type === 'image' ? 'solar:gallery-bold' : 'solar:videocamera-record-bold');
    }
    if (subtitleEl) {
        subtitleEl.textContent = type === 'image' ? 'Add photos, screenshots, or graphics' : 'Embed MP4, WebM, or online videos';
    }
    if (btnTextEl) {
        btnTextEl.textContent = type === 'image' ? 'Insert Image' : 'Insert Video';
    }
    if (formatsEl) {
        formatsEl.textContent = type === 'image'
            ? `Supports PNG, JPG, GIF, WebP, SVG • Max ${MAX_IMAGE_SIZE_MB} MB`
            : `Supports MP4, WebM, OGG • Max ${MAX_VIDEO_SIZE_MB} MB`;
    }
    if (fileInput) {
        fileInput.value = '';
        fileInput.accept = type === 'image' ? 'image/*' : 'video/*';
    }
    if (urlInput) {
        urlInput.value = '';
        urlInput.placeholder = type === 'image' ? 'https://example.com/photo.png' : 'https://example.com/clip.mp4';
    }

    clearSelectedMediaFile();
    switchMediaTab('upload');
    initMediaDropzone();
    openModal('media-modal');
}

async function confirmAddMedia() {
    const fileInput = document.getElementById('media-file-input');
    const urlInput = document.getElementById('media-url-input');

    const file = selectedMediaFile || (fileInput && fileInput.files && fileInput.files[0]);
    const url = urlInput ? urlInput.value.trim() : '';

    if (currentMediaTab === 'upload' && file) {
        if (!validateMediaFileSize(file, currentMediaType)) return;
        try {
            const relAssetPath = await saveMediaAsset(file);
            insertMediaElement(relAssetPath, currentMediaType);
        } catch (err) {
            console.error('Failed to save media to assets folder, fallback to data URL:', err);
            const reader = new FileReader();
            reader.onload = (e) => {
                insertMediaElement(e.target.result, currentMediaType);
            };
            reader.readAsDataURL(file);
        }
    } else if (url) {
        insertMediaElement(url, currentMediaType);
    } else if (file) {
        if (!validateMediaFileSize(file, currentMediaType)) return;
        try {
            const relAssetPath = await saveMediaAsset(file);
            insertMediaElement(relAssetPath, currentMediaType);
        } catch (err) {
            insertMediaElement(url, currentMediaType);
        }
    } else {
        showToast('Please select a file or enter a valid URL', 'warning');
        return;
    }

    closeAllModals();
}

function toLocalMediaUrl(filePath) {
    if (!filePath) return '';
    if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('data:') || filePath.startsWith('file://')) {
        return filePath;
    }
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function attachMediaToolbar(container) {
    if (!container || container.querySelector('.media-toolbar')) return;
    const isImage = Boolean(container.querySelector('img'));
    const cropBtnHtml = isImage ? `
        <button class="media-btn crop-btn" onclick="openCropModalForEditorBlock(this)" title="Crop Image">
            <iconify-icon icon="solar:crop-minimalistic-linear"></iconify-icon>
        </button>
    ` : '';
    const tb = document.createElement('div');
    tb.className = 'media-toolbar';
    tb.setAttribute('contenteditable', 'false');
    tb.innerHTML = `
        <span class="block-drag-handle media-drag-handle" draggable="true" title="Drag to reorder">
            <iconify-icon icon="solar:menu-dots-bold"></iconify-icon>
        </span>
        <button class="media-btn size-btn" onclick="setMediaSize(this, '25%')" title="Small size (25%)">25%</button>
        <button class="media-btn size-btn" onclick="setMediaSize(this, '50%')" title="Medium size (50%)">50%</button>
        <button class="media-btn size-btn" onclick="setMediaSize(this, '100%')" title="Full width (100%)">Full</button>
        ${cropBtnHtml}
        <button class="media-btn move-up-btn" onclick="moveBlockUp(this)" title="Move Up">
            <iconify-icon icon="solar:alt-arrow-up-linear"></iconify-icon>
        </button>
        <button class="media-btn move-down-btn" onclick="moveBlockDown(this)" title="Move Down">
            <iconify-icon icon="solar:alt-arrow-down-linear"></iconify-icon>
        </button>
        <button class="media-btn delete-btn" onclick="deleteMediaBlock(this)" title="Delete Media">
            <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
        </button>
    `;
    container.appendChild(tb);
}

function setMediaSize(btnOrEl, size) {
    const container = btnOrEl.closest('.media-container');
    if (!container) return;
    const applyResize = () => {
        container.style.width = size;
    };
    if (window.NoshUndo) window.NoshUndo.runWithUndo(applyResize);
    else applyResize();
    hasUnsavedChanges = true;
    if (unsavedDot) unsavedDot.classList.add('active');
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
    if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
}

function attachMediaResizeHandle(container) {
    if (!container || container.querySelector('.media-resize-handle')) return;
    const handle = document.createElement('span');
    handle.className = 'media-resize-handle';
    handle.setAttribute('contenteditable', 'false');
    handle.setAttribute('title', 'Drag to resize');

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const dragTx = window.NoshUndo ? window.NoshUndo.beginTransaction() : null;
        const startX = e.clientX;
        const startWidth = container.offsetWidth;
        container.classList.add('is-resizing');

        const onMouseMove = (moveEvent) => {
            const currentX = moveEvent.clientX;
            const diffX = currentX - startX;
            const maxWidth = content ? content.clientWidth - 20 : 860;
            const newWidth = Math.max(100, Math.min(maxWidth, startWidth + diffX));
            container.style.width = `${newWidth}px`;
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            container.classList.remove('is-resizing');

            if (dragTx) dragTx.commit();

            hasUnsavedChanges = true;
            if (unsavedDot) unsavedDot.classList.add('active');
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });

    container.appendChild(handle);
}

function deleteMediaBlock(btn) {
    const container = btn.closest('.media-container');
    if (container) {
        const applyDelete = () => {
            const focusTarget = container.nextElementSibling || container.previousElementSibling;
            container.remove();
            if (focusTarget && typeof placeCaretInElement === 'function') {
                placeCaretInElement(focusTarget, true);
            } else if (content) {
                content.focus();
            }
        };
        if (window.NoshUndo) window.NoshUndo.runWithUndo(applyDelete);
        else applyDelete();
        hasUnsavedChanges = true;
        if (unsavedDot) unsavedDot.classList.add('active');
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
        if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
        showToast('Media removed', 'info');
    }
}

function insertMediaElement(src, type) {
    const applyInsertMedia = () => {
        const container = document.createElement('div');
        container.className = 'media-container resizable';
        container.setAttribute('contenteditable', 'false');

        let displaySrc = src;
        if (src.startsWith('assets/') && savesDir) {
            displaySrc = toLocalMediaUrl(path.join(savesDir, src));
        }

        if (type === 'image') {
            const img = document.createElement('img');
            img.src = displaySrc;
            if (src.startsWith('assets/')) {
                img.setAttribute('data-asset-rel', src);
            }
            img.alt = 'Inserted Image';
            img.style.maxWidth = '100%';
            container.appendChild(img);
        } else {
            const video = document.createElement('video');
            video.src = displaySrc;
            if (src.startsWith('assets/')) {
                video.setAttribute('data-asset-rel', src);
            }
            video.controls = true;
            video.style.maxWidth = '100%';
            container.appendChild(video);
        }

        attachMediaToolbar(container);
        attachMediaResizeHandle(container);

        // Insert at caret or after current block if inside #content
        const sel = window.getSelection();
        let insertRef = null;
        if (sel && sel.rangeCount > 0 && content && content.contains(sel.anchorNode)) {
            let node = sel.getRangeAt(0).startContainer;
            while (node && node.parentElement !== content) {
                node = node.parentElement;
            }
            if (node && node.parentElement === content) {
                insertRef = node;
            }
        }

        if (insertRef && insertRef.nextSibling) {
            content.insertBefore(container, insertRef.nextSibling);
        } else {
            content.appendChild(container);
        }

        let emptyLine = container.nextElementSibling;
        if (!emptyLine) {
            emptyLine = document.createElement('p');
            emptyLine.innerHTML = '<br>';
            content.appendChild(emptyLine);
        }
        if (typeof placeCaretInElement === 'function') {
            placeCaretInElement(emptyLine, true);
        }

        initInteractResizable();
    };

    if (window.NoshUndo) window.NoshUndo.runWithUndo(applyInsertMedia);
    else applyInsertMedia();

    hasUnsavedChanges = true;
    if (unsavedDot) unsavedDot.classList.add('active');
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
    if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
    showToast(`${type === 'image' ? 'Image' : 'Video'} inserted`, 'success');
}

function initInteractResizable() {
    if (typeof interact === 'undefined') return;

    let interactDragTx = null;
    interact('.resizable')
        .resizable({
            edges: { left: true, right: true, bottom: true, top: false },
            listeners: {
                start() {
                    if (window.NoshUndo && !interactDragTx) {
                        interactDragTx = window.NoshUndo.beginTransaction();
                    }
                },
                move(event) {
                    const target = event.target;
                    let width = event.rect.width;
                    if (width < 80) width = 80;
                    if (width > 860) width = 860;
                    target.style.width = `${width}px`;
                    hasUnsavedChanges = true;
                    if (unsavedDot) unsavedDot.classList.add('active');
                },
                end() {
                    if (interactDragTx) {
                        interactDragTx.commit();
                        interactDragTx = null;
                    }
                    if (typeof triggerAutoSave === 'function') triggerAutoSave();
                    if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
                }
            }
        });
}

// Clipboard Paste Image Handler
if (content) {
    content.addEventListener('paste', async (e) => {
        if (!e.clipboardData || !e.clipboardData.files || e.clipboardData.files.length === 0) return;
        const file = e.clipboardData.files[0];
        if (file && file.type.startsWith('image/')) {
            e.preventDefault();
            if (!validateMediaFileSize(file, 'image')) return;
            try {
                const relAssetPath = await saveMediaAsset(file);
                insertMediaElement(relAssetPath, 'image');
                showToast('Pasted image saved to local assets', 'success');
            } catch (err) {
                console.error('Failed to save pasted image to assets:', err);
            }
        }
    });
}

// Process and resolve asset URLs when note is loaded
function processLoadedMedia() {
    if (!content || !savesDir) return;
    const imgs = content.querySelectorAll('img');
    imgs.forEach(img => {
        const rel = img.getAttribute('data-asset-rel') || (img.getAttribute('src')?.startsWith('assets/') ? img.getAttribute('src') : null);
        if (rel) {
            img.setAttribute('data-asset-rel', rel);
            img.src = toLocalMediaUrl(path.join(savesDir, rel));
        }
    });

    const videos = content.querySelectorAll('video');
    videos.forEach(v => {
        const rel = v.getAttribute('data-asset-rel') || (v.getAttribute('src')?.startsWith('assets/') ? v.getAttribute('src') : null);
        if (rel) {
            v.setAttribute('data-asset-rel', rel);
            v.src = toLocalMediaUrl(path.join(savesDir, rel));
        }
    });

    const containers = content.querySelectorAll('.media-container');
    containers.forEach(c => {
        const existingTb = c.querySelector('.media-toolbar');
        if (existingTb && c.querySelector('img') && !existingTb.querySelector('.crop-btn')) {
            existingTb.remove();
        }
        attachMediaToolbar(c);
        attachMediaResizeHandle(c);
    });

    initInteractResizable();
}

// ==========================================================================
// Interactive Image Cropper Studio (Modal & In-Editor Support)
// ==========================================================================
let cropState = {
    mode: 'modal', // 'modal' | 'editor'
    targetImgEl: null,
    aspectRatio: null,
    box: { x: 0, y: 0, w: 100, h: 100 },
    stageW: 100,
    stageH: 100,
    naturalW: 100,
    naturalH: 100,
    initializedEvents: false
};

function openCropModalFromMediaModal() {
    if (currentMediaType !== 'image') return;
    const previewImg = document.querySelector('#media-preview-container img');
    if (previewImg && previewImg.src) {
        openCropStudioWithSrc(previewImg.src, 'modal', null);
    } else if (selectedMediaFile) {
        const src = selectedMediaFile.path
            ? toLocalMediaUrl(selectedMediaFile.path)
            : URL.createObjectURL(selectedMediaFile);
        openCropStudioWithSrc(src, 'modal', null);
    } else {
        showToast('Select an image first to crop', 'warning');
    }
}

function openCropModalForEditorBlock(btn) {
    const container = btn.closest('.media-container');
    const img = container ? container.querySelector('img') : null;
    if (!img || !img.src) {
        showToast('Image not found', 'warning');
        return;
    }
    openCropStudioWithSrc(img.src, 'editor', img);
}

function openCropStudioWithSrc(src, mode = 'modal', targetImgEl = null) {
    const cropImg = document.getElementById('crop-source-img');
    if (!cropImg) return;

    cropState.mode = mode;
    cropState.targetImgEl = targetImgEl;
    cropState.aspectRatio = null;

    // Reset ratio active button UI
    document.querySelectorAll('#crop-modal .crop-ratio-btn[data-ratio]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-ratio') === 'free');
    });

    initCropStageInteractions();
    openModal('crop-modal');

    cropImg.onload = () => {
        requestAnimationFrame(() => {
            cropState.naturalW = cropImg.naturalWidth || cropImg.width || 100;
            cropState.naturalH = cropImg.naturalHeight || cropImg.height || 100;
            cropState.stageW = cropImg.clientWidth || cropImg.width || 100;
            cropState.stageH = cropImg.clientHeight || cropImg.height || 100;
            resetCropBox();
        });
    };

    cropImg.onerror = () => {
        // Fallback without crossOrigin if remote server disallowed anonymous CORS
        if (cropImg.getAttribute('crossorigin')) {
            cropImg.removeAttribute('crossorigin');
            cropImg.src = src;
        } else {
            showToast('Could not load image for cropping', 'error');
        }
    };

    if (/^https?:\/\//i.test(src)) {
        cropImg.setAttribute('crossorigin', 'anonymous');
    } else {
        cropImg.removeAttribute('crossorigin');
    }
    cropImg.src = src;
}

function resetCropBox() {
    const cropImg = document.getElementById('crop-source-img');
    if (cropImg) {
        cropState.stageW = cropImg.clientWidth || cropState.stageW || 100;
        cropState.stageH = cropImg.clientHeight || cropState.stageH || 100;
    }

    const sw = cropState.stageW;
    const sh = cropState.stageH;

    if (cropState.aspectRatio) {
        const ratio = cropState.aspectRatio;
        let w = sw * 0.85;
        let h = w / ratio;
        if (h > sh * 0.85) {
            h = sh * 0.85;
            w = h * ratio;
        }
        cropState.box = {
            x: Math.max(0, (sw - w) / 2),
            y: Math.max(0, (sh - h) / 2),
            w: Math.max(24, w),
            h: Math.max(24, h)
        };
    } else {
        // Default: full image selected (or 90% centered so handles are clearly visible)
        const padX = Math.min(16, sw * 0.06);
        const padY = Math.min(16, sh * 0.06);
        cropState.box = {
            x: padX,
            y: padY,
            w: Math.max(24, sw - padX * 2),
            h: Math.max(24, sh - padY * 2)
        };
    }

    updateCropSelectionDOM();
}

function setCropAspectRatio(ratio, btnEl) {
    cropState.aspectRatio = ratio;
    document.querySelectorAll('#crop-modal .crop-ratio-btn[data-ratio]').forEach(b => {
        b.classList.remove('active');
    });
    if (btnEl) btnEl.classList.add('active');
    resetCropBox();
}

function updateCropSelectionDOM() {
    const selBox = document.getElementById('crop-selection-box');
    const dimBadge = document.getElementById('crop-dimensions-badge');
    if (!selBox) return;

    const { x, y, w, h } = cropState.box;
    selBox.style.left = `${x}px`;
    selBox.style.top = `${y}px`;
    selBox.style.width = `${w}px`;
    selBox.style.height = `${h}px`;

    if (dimBadge && cropState.stageW > 0 && cropState.stageH > 0) {
        const scaleX = cropState.naturalW / cropState.stageW;
        const scaleY = cropState.naturalH / cropState.stageH;
        const pxW = Math.max(1, Math.round(w * scaleX));
        const pxH = Math.max(1, Math.round(h * scaleY));
        dimBadge.textContent = `${pxW} × ${pxH} px`;
    }
}

function initCropStageInteractions() {
    if (cropState.initializedEvents) return;
    const stage = document.getElementById('crop-stage');
    const selBox = document.getElementById('crop-selection-box');
    if (!stage || !selBox) return;

    cropState.initializedEvents = true;

    let action = null; // 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'draw'
    let startMouseX = 0;
    let startMouseY = 0;
    let startBox = { x: 0, y: 0, w: 0, h: 0 };

    stage.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const cropImg = document.getElementById('crop-source-img');
        if (cropImg) {
            cropState.stageW = cropImg.clientWidth || cropState.stageW;
            cropState.stageH = cropImg.clientHeight || cropState.stageH;
        }

        const handleEl = e.target.closest('.crop-handle');
        if (handleEl) {
            action = handleEl.getAttribute('data-handle');
        } else if (e.target === selBox || selBox.contains(e.target)) {
            action = 'move';
        } else {
            // Clicked on image outside selection box -> start drawing a new box
            const rect = stage.getBoundingClientRect();
            const clickX = Math.max(0, Math.min(cropState.stageW, e.clientX - rect.left));
            const clickY = Math.max(0, Math.min(cropState.stageH, e.clientY - rect.top));
            cropState.box = { x: clickX, y: clickY, w: 24, h: 24 };
            action = 'se';
        }

        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startBox = { ...cropState.box };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!action) return;
        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;
        const sw = cropState.stageW;
        const sh = cropState.stageH;
        const minSize = 24;
        const ratio = cropState.aspectRatio;

        let { x, y, w, h } = startBox;

        if (action === 'move') {
            x = Math.max(0, Math.min(sw - w, x + dx));
            y = Math.max(0, Math.min(sh - h, y + dy));
            cropState.box = { x, y, w, h };
            updateCropSelectionDOM();
            return;
        }

        // Resize handles
        if (action.includes('e')) {
            w = Math.max(minSize, Math.min(sw - x, startBox.w + dx));
        }
        if (action.includes('s')) {
            h = Math.max(minSize, Math.min(sh - y, startBox.h + dy));
        }
        if (action.includes('w')) {
            const maxLeftShift = startBox.w - minSize;
            const shift = Math.max(-startBox.x, Math.min(maxLeftShift, dx));
            x = startBox.x + shift;
            w = startBox.w - shift;
        }
        if (action.includes('n')) {
            const maxTopShift = startBox.h - minSize;
            const shift = Math.max(-startBox.y, Math.min(maxTopShift, dy));
            y = startBox.y + shift;
            h = startBox.h - shift;
        }

        if (ratio) {
            if (action === 'n' || action === 's') {
                w = h * ratio;
                if (x + w > sw) {
                    w = sw - x;
                    h = w / ratio;
                }
            } else {
                h = w / ratio;
                if (y + h > sh) {
                    h = sh - y;
                    w = h * ratio;
                }
            }
        }

        cropState.box = { x, y, w, h };
        updateCropSelectionDOM();
    }

    function onMouseUp() {
        action = null;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    }
}

async function applyImageCrop() {
    const cropImg = document.getElementById('crop-source-img');
    if (!cropImg || !cropImg.src) return;

    const sw = cropImg.clientWidth || cropState.stageW;
    const sh = cropImg.clientHeight || cropState.stageH;
    const nw = cropImg.naturalWidth || sw;
    const nh = cropImg.naturalHeight || sh;

    if (!sw || !sh || !nw || !nh) return;

    const scaleX = nw / sw;
    const scaleY = nh / sh;

    const sx = Math.max(0, Math.round(cropState.box.x * scaleX));
    const sy = Math.max(0, Math.round(cropState.box.y * scaleY));
    const sWidth = Math.max(1, Math.min(nw - sx, Math.round(cropState.box.w * scaleX)));
    const sHeight = Math.max(1, Math.min(nh - sy, Math.round(cropState.box.h * scaleY)));

    try {
        const canvas = document.createElement('canvas');
        canvas.width = sWidth;
        canvas.height = sHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(cropImg, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => {
                if (b) resolve(b);
                else reject(new Error('Failed to generate cropped image blob'));
            }, 'image/png');
        });

        const baseName = (selectedMediaFile && selectedMediaFile.name)
            ? selectedMediaFile.name.replace(/\.[^.]+$/, '') + '_cropped.png'
            : `cropped_${Date.now()}.png`;

        const croppedFile = new File([blob], baseName, { type: 'image/png' });

        if (cropState.mode === 'editor' && cropState.targetImgEl) {
            const relAssetPath = await saveMediaAsset(croppedFile);
            const applyCropUpdate = () => {
                cropState.targetImgEl.setAttribute('data-asset-rel', relAssetPath);
                cropState.targetImgEl.src = toLocalMediaUrl(path.join(savesDir, relAssetPath));
            };
            if (window.NoshUndo) window.NoshUndo.runWithUndo(applyCropUpdate);
            else applyCropUpdate();

            hasUnsavedChanges = true;
            if (unsavedDot) unsavedDot.classList.add('active');
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            if (typeof updateStatusBarStats === 'function') updateStatusBarStats();

            closeModal('crop-modal');
            showToast('Image cropped', 'success');
        } else {
            selectedMediaFile = croppedFile;
            switchMediaTab('upload');
            renderSelectedFilePill(croppedFile);
            updateMediaPreview();
            closeModal('crop-modal');
            showToast('Crop applied to preview', 'success');
        }
    } catch (err) {
        console.error('Error applying image crop:', err);
        showToast('Could not crop this image (CORS or format restriction)', 'error');
    }
}

initInteractResizable();
