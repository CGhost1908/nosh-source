// YouTube Companion Player Integration for Nosh

const YOUTUBE_PRESETS = [
    { id: 'tRsQsTMvPNg', name: 'Claude FM', desc: 'Music for Thinking & Building' },
    { id: 'rFZHOHl-L8A', name: 'Lofi Girl', desc: 'Beats to Relax/Study to' },
    { id: '5yx6BWlEVcY', name: 'Chillhop', desc: 'Jazzy & Lofi Hip Hop' },
    { id: '4xDzrJKXOOY', name: 'Synthwave', desc: 'Retro / Chillwave Radio' },
    { id: '2OEL4P1Rz04', name: 'Coffee Rain', desc: 'Cozy Ambient & Coffee' }
];

let currentYouTubeVideoId = localStorage.getItem('youtube_current_video_id') || 'rFZHOHl-L8A';
if (currentYouTubeVideoId === 'jfKfPfyJRdk' || currentYouTubeVideoId === 'WJ3-F02-UWP' || currentYouTubeVideoId === 'mIYzp5rcTvU') {
    currentYouTubeVideoId = 'rFZHOHl-L8A';
    localStorage.setItem('youtube_current_video_id', 'rFZHOHl-L8A');
    localStorage.setItem('youtube_current_title', 'Lofi Girl - Beats to Study to');
}
let currentYouTubeTitle = localStorage.getItem('youtube_current_title') || 'Lofi Girl - Beats to Study to';
let noshServerPort = 2222;

let isPlaying = false;
let isMuted = localStorage.getItem('youtube_is_muted') === 'true';
let currentVolume = parseInt(localStorage.getItem('youtube_volume') || '80', 10);
let isFloating = localStorage.getItem('youtube_is_floating') === 'true';
let isPlayerReady = false;
let hasStartedPlayback = false;

let currentTime = 0;
let currentDuration = 0;
let isScrubbing = false;

const youtubeWidget = document.getElementById('youtube-widget');
const youtubeIframe = document.getElementById('youtube-iframe');
const youtubeTitleEl = document.getElementById('youtube-track-title');

function extractYouTubeInfo(urlOrId) {
    if (!urlOrId) return { videoId: null, listId: null };
    const trimmed = urlOrId.trim();

    const listMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
    const listId = listMatch ? listMatch[1] : null;

    // Already an 11-char ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
        return { videoId: trimmed, listId: null };
    }

    // Match youtube.com/watch?v=ID or /embed/ID or /live/ID or youtu.be/ID
    const longMatch = trimmed.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|live)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
    const videoId = longMatch && longMatch[1] ? longMatch[1] : null;

    if (!videoId && listId) {
        return { videoId: null, listId };
    }

    return { videoId: videoId || trimmed, listId };
}

function extractYouTubeId(urlOrId) {
    return extractYouTubeInfo(urlOrId).videoId;
}

function sendYouTubeCommand(action, val) {
    const iframe = document.getElementById('youtube-iframe');
    if (!iframe || !iframe.contentWindow) return;
    try {
        iframe.contentWindow.postMessage({ action, val }, '*');
    } catch (e) {
        console.warn('Failed to postMessage to YouTube iframe:', e);
    }
}

function applyVideoTitle(title) {
    if (!title || !title.trim()) return;
    const cleanTitle = title.trim();
    currentYouTubeTitle = cleanTitle;
    localStorage.setItem('youtube_current_title', cleanTitle);
    if (youtubeTitleEl) {
        youtubeTitleEl.textContent = cleanTitle;
        youtubeTitleEl.setAttribute('title', cleanTitle);
    }
}

async function fetchYouTubeTitle(videoId) {
    if (!videoId) return;
    try {
        const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.title) {
                applyVideoTitle(data.title);
            }
        }
    } catch (e) {
        // oEmbed fallback failed silently
    }
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
    const s = Math.floor(seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    const formattedSecs = secs < 10 ? '0' + secs : secs;
    if (mins >= 60) {
        const hrs = Math.floor(mins / 60);
        const remMins = mins % 60;
        return `${hrs}:${remMins < 10 ? '0' + remMins : remMins}:${formattedSecs}`;
    }
    return `${mins}:${formattedSecs}`;
}

function updateTimeUI(cur, dur) {
    currentDuration = dur || 0;
    currentTime = cur || 0;

    const currentEl = document.getElementById('yt-current-time');
    const durationEl = document.getElementById('yt-duration-time');
    const dividerEl = document.querySelector('.yt-time-divider');
    const seekBar = document.getElementById('yt-seek-bar');

    // Live streams have duration <= 0 or duration > 86400
    const isLive = dur <= 0 || dur > 86400;

    if (durationEl) {
        if (isLive) {
            durationEl.innerHTML = '<span class="yt-live-badge"><span class="yt-live-dot"></span>LIVE</span>';
            if (dividerEl) dividerEl.style.display = 'none';
        } else {
            durationEl.textContent = formatTime(dur);
            if (dividerEl) dividerEl.style.display = 'inline';
        }
    }

    if (seekBar) {
        if (isLive) {
            seekBar.disabled = true;
            seekBar.style.opacity = '0.3';
            seekBar.value = 100;
        } else {
            seekBar.disabled = false;
            seekBar.style.opacity = '1';
            seekBar.max = dur;
            if (!isScrubbing) {
                seekBar.value = cur;
                if (currentEl) {
                    currentEl.textContent = formatTime(cur);
                }
            }
        }
    } else if (currentEl && !isScrubbing) {
        currentEl.textContent = formatTime(cur);
    }
}

// Poster Thumbnail & Cover (prevents black empty void when player opens or changes)
function updatePosterThumbnail(videoId) {
    const posterImg = document.getElementById('yt-poster-img');
    const posterOverlay = document.getElementById('yt-poster-overlay');
    if (!videoId) return;

    if (posterImg) {
        posterImg.style.backgroundImage = `url('https://i.ytimg.com/vi/${videoId}/hqdefault.jpg')`;
    }
    if (posterOverlay && hasStartedPlayback) {
        posterOverlay.classList.add('playing');
    }
}

function handleSeekInput(val) {
    isScrubbing = true;
    const currentEl = document.getElementById('yt-current-time');
    if (currentEl) {
        currentEl.textContent = formatTime(parseFloat(val));
    }
}

function handleSeekChange(val) {
    isScrubbing = false;
    const numericVal = parseFloat(val);
    sendYouTubeCommand('seekTo', numericVal);
}

function loadYouTubeVideo(urlOrId, title = null, autoPlay = true) {
    const { videoId, listId } = extractYouTubeInfo(urlOrId);
    if (!videoId && !listId) {
        showToast('Please enter a valid YouTube video or playlist URL', 'warning');
        return;
    }

    const currentId = videoId || (listId ? `videoseries?list=${listId}` : null);
    currentYouTubeVideoId = currentId;
    localStorage.setItem('youtube_current_video_id', currentId);

    // Initial label before actual title arrives
    let displayTitle = title;
    if (!displayTitle) {
        const matched = YOUTUBE_PRESETS.find(p => p.id === videoId);
        displayTitle = matched ? `${matched.name} (${matched.desc})` : (videoId ? `YouTube (${videoId})` : `YouTube Playlist`);
    }
    applyVideoTitle(displayTitle);

    // Fetch full real video title in background
    if (videoId) {
        fetchYouTubeTitle(videoId);
        updatePosterThumbnail(videoId, displayTitle);
    }

    if (typeof showYouTubeSkeleton === 'function') {
        showYouTubeSkeleton();
    }

    // Update active state in preset buttons if any
    document.querySelectorAll('.yt-preset-chip').forEach(chip => {
        chip.classList.toggle('active', chip.getAttribute('data-video-id') === videoId);
    });
    document.querySelectorAll('.yt-station-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-video-id') === videoId);
    });

    const iframe = document.getElementById('youtube-iframe');
    const playerUrl = `http://localhost:${noshServerPort}/youtube-player?autoplay=${autoPlay ? 1 : 0}${videoId ? `&v=${encodeURIComponent(videoId)}` : ''}${listId ? `&list=${encodeURIComponent(listId)}` : ''}`;

    if (iframe) {
        if (isPlayerReady && iframe.src && iframe.src.includes('/youtube-player')) {
            sendYouTubeCommand('load', { videoId, listId });
            if (autoPlay) {
                sendYouTubeCommand('play');
                isPlaying = true;
                updatePlayButtonUI(true);
            }
        } else {
            iframe.src = playerUrl;
            isPlaying = autoPlay;
            updatePlayButtonUI(isPlaying);
        }
    }

    showToast(`Loading: ${displayTitle}`, 'info');
}

// Custom Player Controls: Play / Pause
function updatePlayButtonUI(playing) {
    const icon = document.getElementById('yt-play-icon');
    const btn = document.getElementById('yt-play-pause-btn');
    const posterOverlay = document.getElementById('yt-poster-overlay');
    if (icon) {
        icon.setAttribute('icon', playing ? 'solar:pause-bold' : 'solar:play-bold');
    }
    if (btn) {
        btn.setAttribute('title', playing ? 'Pause' : 'Play');
    }
    if (playing) {
        hasStartedPlayback = true;
        if (posterOverlay) {
            posterOverlay.classList.add('playing');
        }
        if (typeof hideYouTubeSkeleton === 'function') {
            hideYouTubeSkeleton();
        }
    }
}

// Auto-hide controls overlay on idle / mouse leave, show on hover/movement
let controlsHideTimeout = null;

function showVideoControlsTemporarily(durationMs = 2500) {
    if (!hasStartedPlayback) return;
    const controls = document.getElementById('youtube-video-controls');
    if (!controls) return;
    controls.classList.add('active');
    clearTimeout(controlsHideTimeout);
    if (!isScrubbing) {
        controlsHideTimeout = setTimeout(() => {
            if (!controls.matches(':hover') && !isScrubbing) {
                controls.classList.remove('active');
            }
        }, durationMs);
    }
}

function setupControlsHoverBehavior() {
    const frameWrapper = document.getElementById('youtube-frame-wrapper');
    const controls = document.getElementById('youtube-video-controls');
    if (!frameWrapper || !controls) return;

    frameWrapper.addEventListener('pointerenter', () => {
        if (!hasStartedPlayback) return;
        showVideoControlsTemporarily(3000);
    });

    frameWrapper.addEventListener('pointermove', () => {
        if (!hasStartedPlayback) return;
        showVideoControlsTemporarily(2500);
    });

    frameWrapper.addEventListener('pointerleave', () => {
        clearTimeout(controlsHideTimeout);
        if (!isScrubbing) {
            controls.classList.remove('active');
        }
    });

    controls.addEventListener('pointerenter', () => {
        if (!hasStartedPlayback) {
            controls.classList.remove('active');
            return;
        }
        clearTimeout(controlsHideTimeout);
        controls.classList.add('active');
    });

    controls.addEventListener('pointerleave', () => {
        showVideoControlsTemporarily(2000);
    });
}

function toggleYouTubePlay() {
    isPlaying = !isPlaying;
    if (isPlaying) {
        hasStartedPlayback = true;
        const posterOverlay = document.getElementById('yt-poster-overlay');
        if (posterOverlay) {
            posterOverlay.classList.add('playing');
        }
    }
    updatePlayButtonUI(isPlaying);
    sendYouTubeCommand(isPlaying ? 'play' : 'pause');
    showVideoControlsTemporarily(2000);
}

// Custom Player Controls: Volume & Mute
function updateVolumeUI(volume, muted) {
    const icon = document.getElementById('yt-mute-icon');
    const slider = document.getElementById('yt-volume-slider');
    if (slider) {
        slider.value = muted ? 0 : volume;
    }
    if (icon) {
        if (muted || volume === 0) {
            icon.setAttribute('icon', 'solar:volume-cross-bold');
        } else if (volume < 50) {
            icon.setAttribute('icon', 'solar:volume-small-bold');
        } else {
            icon.setAttribute('icon', 'solar:volume-loud-bold');
        }
    }
}

function toggleYouTubeMute() {
    isMuted = !isMuted;
    localStorage.setItem('youtube_is_muted', isMuted ? 'true' : 'false');
    sendYouTubeCommand(isMuted ? 'mute' : 'unMute');
    updateVolumeUI(currentVolume, isMuted);
}

function handleYouTubeVolume(val) {
    const numericVal = parseInt(val, 10);
    currentVolume = isNaN(numericVal) ? 80 : Math.max(0, Math.min(100, numericVal));
    localStorage.setItem('youtube_volume', currentVolume);

    if (currentVolume > 0 && isMuted) {
        isMuted = false;
        localStorage.setItem('youtube_is_muted', 'false');
    }

    sendYouTubeCommand('setVolume', currentVolume);
    updateVolumeUI(currentVolume, isMuted);
}

// Modal for Custom YouTube URL
function openYouTubeUrlModal() {
    const modal = document.getElementById('youtube-url-modal');
    const overlay = document.getElementById('global-overlay');
    const input = document.getElementById('youtube-modal-url-input');
    if (modal) modal.classList.add('active');
    if (overlay) overlay.classList.add('active');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 50);
    }
}

function submitYouTubeModalUrl() {
    const input = document.getElementById('youtube-modal-url-input');
    if (!input) return;
    const val = input.value.trim();
    if (val) {
        loadYouTubeVideo(val, null, true);
        if (typeof closeAllModals === 'function') {
            closeAllModals();
        }
        input.value = '';
    } else {
        showToast('Please enter a YouTube video URL or ID', 'warning');
    }
}

// In-App Floating / Docking Player
function toggleYouTubeFloat(forceState = null) {
    if (!youtubeWidget) return;
    const nextState = forceState !== null ? forceState : !isFloating;
    isFloating = nextState;
    localStorage.setItem('youtube_is_floating', isFloating ? 'true' : 'false');

    youtubeWidget.classList.toggle('floating-mode', isFloating);

    const placeholder = document.getElementById('youtube-sidebar-placeholder');
    if (placeholder) {
        placeholder.classList.toggle('active', isFloating);
    }

    const floatIcon = document.getElementById('youtube-float-icon');
    const floatBtn = document.getElementById('youtube-float-btn');
    if (floatIcon) {
        floatIcon.setAttribute('icon', isFloating ? 'solar:minimize-square-linear' : 'solar:pip-linear');
    }
    if (floatBtn) {
        floatBtn.setAttribute('title', isFloating ? 'Dock Player to Sidebar' : 'Float Player in Workspace');
    }

    if (isFloating) {
        const savedW = localStorage.getItem('youtube_float_width');
        if (savedW) {
            youtubeWidget.style.width = `${savedW}px`;
        } else {
            youtubeWidget.style.width = '350px';
        }

        const savedX = localStorage.getItem('youtube_float_x');
        const savedY = localStorage.getItem('youtube_float_y');
        if (savedX && savedY) {
            youtubeWidget.style.left = `${savedX}px`;
            youtubeWidget.style.top = `${savedY}px`;
            youtubeWidget.style.right = 'auto';
            youtubeWidget.style.bottom = 'auto';
        } else {
            youtubeWidget.style.left = 'auto';
            youtubeWidget.style.top = 'auto';
            youtubeWidget.style.right = '24px';
            youtubeWidget.style.bottom = '24px';
        }
        showToast('Player detached: Drag to move, bottom-right to resize', 'info');
    } else {
        youtubeWidget.style.width = '';
        youtubeWidget.style.left = '';
        youtubeWidget.style.top = '';
        youtubeWidget.style.right = '';
        youtubeWidget.style.bottom = '';
        showToast('Player docked to sidebar', 'info');
    }
}

// Draggable Handler for Floating Player
function setupFloatingDrag() {
    const topBar = document.getElementById('youtube-top-bar');
    if (!topBar || !youtubeWidget) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    topBar.addEventListener('pointerdown', (e) => {
        if (!isFloating) return;
        // Don't drag if clicking buttons or inputs
        if (e.target.closest('button') || e.target.closest('input')) return;

        isDragging = true;
        topBar.setPointerCapture(e.pointerId);

        startX = e.clientX;
        startY = e.clientY;

        const rect = youtubeWidget.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        e.preventDefault();
    });

    window.addEventListener('pointermove', (e) => {
        if (!isDragging || !isFloating) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        // Clamping within window viewport
        const minX = 10;
        const maxX = window.innerWidth - youtubeWidget.offsetWidth - 10;
        const minY = 10;
        const maxY = window.innerHeight - youtubeWidget.offsetHeight - 10;

        newLeft = Math.max(minX, Math.min(newLeft, maxX));
        newTop = Math.max(minY, Math.min(newTop, maxY));

        youtubeWidget.style.left = `${newLeft}px`;
        youtubeWidget.style.top = `${newTop}px`;
        youtubeWidget.style.right = 'auto';
        youtubeWidget.style.bottom = 'auto';
    });

    const endDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;

        const rect = youtubeWidget.getBoundingClientRect();
        localStorage.setItem('youtube_float_x', Math.round(rect.left));
        localStorage.setItem('youtube_float_y', Math.round(rect.top));
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
}

// Multi-direction Edge & Corner Resizing for Floating Player
function setupFloatingResize() {
    const resizers = document.querySelectorAll('.yt-resizer');
    if (!resizers || !resizers.length || !youtubeWidget) return;

    let isResizing = false;
    let activeDir = '';
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startLeft = 0;
    let startTop = 0;

    resizers.forEach(handle => {
        handle.addEventListener('pointerdown', (e) => {
            if (!isFloating) return;
            isResizing = true;
            activeDir = handle.getAttribute('data-dir') || '';
            handle.setPointerCapture(e.pointerId);

            startX = e.clientX;
            startY = e.clientY;
            startWidth = youtubeWidget.offsetWidth;

            const rect = youtubeWidget.getBoundingClientRect();
            startLeft = Math.round(rect.left);
            startTop = Math.round(rect.top);

            youtubeWidget.style.left = `${startLeft}px`;
            youtubeWidget.style.top = `${startTop}px`;
            youtubeWidget.style.right = 'auto';
            youtubeWidget.style.bottom = 'auto';

            document.body.style.userSelect = 'none';
            e.preventDefault();
            e.stopPropagation();
        });
    });

    window.addEventListener('pointermove', (e) => {
        if (!isResizing || !isFloating || !activeDir) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const minW = 240;
        const maxW = Math.min(850, window.innerWidth - 20);

        let newWidth = startWidth;
        let newLeft = startLeft;
        let newTop = startTop;

        if (activeDir === 'e') {
            newWidth = startWidth + dx;
        } else if (activeDir === 'w') {
            newWidth = startWidth - dx;
        } else if (activeDir === 's') {
            newWidth = startWidth + (dy * (16 / 9));
        } else if (activeDir === 'n') {
            newWidth = startWidth - (dy * (16 / 9));
        } else if (activeDir === 'se') {
            const delta = Math.abs(dx) > Math.abs(dy * 1.77) ? dx : dy * 1.77;
            newWidth = startWidth + delta;
        } else if (activeDir === 'sw') {
            const delta = Math.abs(dx) > Math.abs(dy * 1.77) ? -dx : dy * 1.77;
            newWidth = startWidth + delta;
        } else if (activeDir === 'ne') {
            const delta = Math.abs(dx) > Math.abs(dy * 1.77) ? dx : -dy * 1.77;
            newWidth = startWidth + delta;
        } else if (activeDir === 'nw') {
            const delta = Math.abs(dx) > Math.abs(dy * 1.77) ? -dx : -dy * 1.77;
            newWidth = startWidth + delta;
        }

        // Clamp width
        newWidth = Math.max(minW, Math.min(newWidth, maxW));

        // Handle West-side repositioning (w, sw, nw)
        if (activeDir.indexOf('w') !== -1) {
            newLeft = startLeft + (startWidth - newWidth);
            if (newLeft < 10) {
                newLeft = 10;
                newWidth = startLeft + startWidth - 10;
            }
            youtubeWidget.style.left = `${Math.round(newLeft)}px`;
        } else {
            // East side boundary check
            if (startLeft + newWidth > window.innerWidth - 10) {
                const adjustedLeft = Math.max(10, window.innerWidth - 10 - newWidth);
                youtubeWidget.style.left = `${Math.round(adjustedLeft)}px`;
            }
        }

        // Handle North-side repositioning (n, ne, nw)
        if (activeDir.indexOf('n') !== -1) {
            const deltaH = (newWidth - startWidth) * (9 / 16);
            newTop = startTop - deltaH;
            if (newTop < 10) newTop = 10;
            youtubeWidget.style.top = `${Math.round(newTop)}px`;
        }

        youtubeWidget.style.width = `${Math.round(newWidth)}px`;
    });

    const endResize = () => {
        if (!isResizing) return;
        isResizing = false;
        activeDir = '';
        document.body.style.userSelect = '';

        const currentWidth = Math.round(youtubeWidget.offsetWidth);
        localStorage.setItem('youtube_float_width', currentWidth);

        const rect = youtubeWidget.getBoundingClientRect();
        localStorage.setItem('youtube_float_x', Math.round(rect.left));
        localStorage.setItem('youtube_float_y', Math.round(rect.top));
    };

    window.addEventListener('pointerup', endResize);
    window.addEventListener('pointercancel', endResize);
}

// Preset Radio Stations Dropdown
function toggleYouTubeStationsMenu(event) {
    if (event && event.stopPropagation) {
        event.stopPropagation();
    }
    const popover = document.getElementById('yt-stations-popover');
    const btn = document.getElementById('youtube-stations-btn');
    if (!popover) return;
    const isShown = popover.style.display !== 'none';
    if (isShown) {
        popover.style.display = 'none';
        return;
    }

    if (isFloating && btn) {
        const btnRect = btn.getBoundingClientRect();
        if (window.innerHeight - btnRect.bottom < 220) {
            popover.classList.add('open-up');
        } else {
            popover.classList.remove('open-up');
        }
    } else {
        popover.classList.remove('open-up');
    }

    popover.style.display = 'flex';
}

function selectStationPreset(id, name) {
    loadYouTubeVideo(id, name, true);
    const popover = document.getElementById('yt-stations-popover');
    if (popover) {
        popover.style.display = 'none';
    }
}

// Close stations popover on outside click
document.addEventListener('click', (e) => {
    const popover = document.getElementById('yt-stations-popover');
    const btn = document.getElementById('youtube-stations-btn');
    if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !btn?.contains(e.target)) {
            popover.style.display = 'none';
        }
    }
});

function toggleYouTubeMinimize(eventOrForce) {
    let forceState = null;
    if (typeof eventOrForce === 'boolean') {
        forceState = eventOrForce;
    } else if (eventOrForce && eventOrForce.stopPropagation) {
        eventOrForce.stopPropagation();
    }

    if (!youtubeWidget) return;
    const isCurrentlyMinimized = youtubeWidget.classList.contains('minimized');
    const nextState = forceState !== null ? forceState : !isCurrentlyMinimized;

    youtubeWidget.classList.toggle('minimized', nextState);
    localStorage.setItem('youtube-minimized', nextState ? 'true' : 'false');

    const icon = document.getElementById('youtube-minimize-icon');
    const btn = document.getElementById('youtube-minimize-btn');
    if (icon) {
        icon.setAttribute('icon', nextState ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear');
    }
    if (btn) {
        btn.setAttribute('title', nextState ? 'Expand YouTube Player' : 'Minimize YouTube Player');
    }
}

function updateYouTubeUIState() {
    const isWidgetVisible = localStorage.getItem('view-youtube-player') !== 'false';
    if (youtubeWidget) {
        youtubeWidget.classList.toggle('hidden', !isWidgetVisible);
    }

    const isMinimized = localStorage.getItem('youtube-minimized') === 'true';
    if (youtubeWidget && isMinimized) {
        toggleYouTubeMinimize(true);
    }

    if (youtubeTitleEl) {
        youtubeTitleEl.textContent = currentYouTubeTitle;
        youtubeTitleEl.setAttribute('title', currentYouTubeTitle);
    }

    if (isFloating) {
        toggleYouTubeFloat(true);
    }

    updatePlayButtonUI(isPlaying);
    updateVolumeUI(currentVolume, isMuted);
    updateTimeUI(currentTime, currentDuration);
}

// Window message listener to synchronize player state with YouTube IFrame API
window.addEventListener('message', (event) => {
    try {
        let data = event.data;
        if (typeof data === 'string') {
            data = JSON.parse(data);
        }
        if (!data || typeof data !== 'object') return;

        if (data.type === 'yt-ready') {
            isPlayerReady = true;
            sendYouTubeCommand('setVolume', currentVolume);
            if (isMuted) sendYouTubeCommand('mute');
            sendYouTubeCommand('getInfo');
        } else if (data.type === 'yt-info') {
            if (data.title) {
                applyVideoTitle(data.title);
            }
            if (data.duration !== undefined) {
                updateTimeUI(currentTime, data.duration);
            }
        } else if (data.type === 'yt-time') {
            updateTimeUI(data.currentTime, data.duration);
        } else if (data.type === 'yt-state') {
            isPlaying = !!data.isPlaying;
            updatePlayButtonUI(isPlaying);
            const posterOverlay = document.getElementById('yt-poster-overlay');
            if (posterOverlay && isPlaying) {
                posterOverlay.classList.add('playing');
            }
            sendYouTubeCommand('getInfo');
        }
    } catch (e) {
        // Not a player message
    }
});

// Initialization
function initYouTubePlayer() {
    updateYouTubeUIState();
    setupFloatingDrag();
    setupFloatingResize();
    setupControlsHoverBehavior();

    const { videoId, listId } = extractYouTubeInfo(currentYouTubeVideoId);
    if (videoId) {
        updatePosterThumbnail(videoId, currentYouTubeTitle);
    }

    const iframe = document.getElementById('youtube-iframe');
    if (iframe && (!iframe.src || iframe.src === 'about:blank' || iframe.src === window.location.href)) {
        const playerUrl = `http://localhost:${noshServerPort}/youtube-player?autoplay=0${videoId ? `&v=${encodeURIComponent(videoId)}` : ''}${listId ? `&list=${encodeURIComponent(listId)}` : ''}`;
        iframe.src = playerUrl;
    }
}

// Window exports
window.loadYouTubeVideo = loadYouTubeVideo;
window.toggleYouTubePlay = toggleYouTubePlay;
window.toggleYouTubeMute = toggleYouTubeMute;
window.handleYouTubeVolume = handleYouTubeVolume;
window.handleSeekInput = handleSeekInput;
window.handleSeekChange = handleSeekChange;
window.openYouTubeUrlModal = openYouTubeUrlModal;
window.submitYouTubeModalUrl = submitYouTubeModalUrl;
window.toggleYouTubeFloat = toggleYouTubeFloat;
window.toggleYouTubeMinimize = toggleYouTubeMinimize;
window.updateYouTubeUIState = updateYouTubeUIState;
window.toggleYouTubeStationsMenu = toggleYouTubeStationsMenu;
window.selectStationPreset = selectStationPreset;

// Retrieve server port first, then initialize player
if (typeof ipcRenderer !== 'undefined' && ipcRenderer.invoke) {
    ipcRenderer.invoke('get-server-port').then(p => {
        if (p) noshServerPort = p;
        initYouTubePlayer();
    }).catch(() => {
        initYouTubePlayer();
    });
} else {
    initYouTubePlayer();
}

document.addEventListener('DOMContentLoaded', () => {
    initYouTubePlayer();
});
