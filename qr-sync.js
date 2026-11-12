// ==========================================================================
// Nosh Anonymous AuthToken & Per-Note E2EE Vault Sync Bridge (Desktop)
// Zero-Account • Local AuthToken • Per-Note Supabase Storage • Drive Backup
// ==========================================================================

(function () {
    const SUPABASE_BASE_URL = 'https://buvtdaxlibejpjlkxaor.supabase.co';
    const SUPABASE_ANON_KEY =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1dnRkYXhsaWJlanBqbGt4YW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MjA2NTIsImV4cCI6MjEwOTA5NjY1Mn0.Kd2bR8gAm2lLGKHLhV1CJCacuLE1NKPptVmIJiKZnNY';
    const RELAY_WS_URL = `${SUPABASE_BASE_URL.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;

    const AUTH_TOKEN_STORAGE_KEY = 'nosh_auth_token';
    const QR_EPHEMERAL_KEY_STORAGE = 'nosh_qr_transfer_key';
    const SYNCED_MTIMES_PREFIX = 'nosh_synced_mtimes_';

    function generateRandomHex(byteLen = 16) {
        const bytes = new Uint8Array(byteLen);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => ('0' + b.toString(16)).slice(-2)).join('');
    }

    function utf8ToBytes(str) {
        const encoded = encodeURIComponent(str);
        const bytes = [];
        for (let i = 0; i < encoded.length; i++) {
            if (encoded[i] === '%') {
                bytes.push(parseInt(encoded.substr(i + 1, 2), 16));
                i += 2;
            } else {
                bytes.push(encoded.charCodeAt(i));
            }
        }
        return bytes;
    }

    function bytesToUtf8(bytes) {
        let encoded = '';
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i] & 0xff;
            encoded += '%' + ('00' + b.toString(16)).slice(-2);
        }
        try {
            return decodeURIComponent(encoded);
        } catch {
            return String.fromCharCode(...bytes);
        }
    }

    function bytesToHex(bytes) {
        return bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
    }

    function hexToBytes(hex) {
        const clean = (hex || '').replace(/[^0-9a-fA-F]/g, '');
        const out = [];
        for (let i = 0; i < clean.length; i += 2) {
            out.push(parseInt(clean.substr(i, 2), 16) || 0);
        }
        return out;
    }

    // Identical 256-bit keystream & MAC function as Nosh Mobile (src/utils/cryptoE2EE.ts)
    function mixState(seed, blockCounter) {
        const s = `${seed}:${blockCounter}`;
        let h1 = 0x811c9dc5;
        let h2 = 0xcbf29ce4;
        let h3 = 0x1b873593;
        let h4 = 0x85ebca6b;

        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
            h2 = Math.imul(h2 ^ ((c << 3) | (c >>> 5)), 0x5bd1e995) >>> 0;
            h3 = Math.imul(h3 ^ (c + i), 0xcc9e2d51) >>> 0;
            h4 = Math.imul(h4 ^ (c * 31), 0x1b873593) >>> 0;
        }

        for (let r = 0; r < 8; r++) {
            h1 = (Math.imul(h1 ^ (h4 >>> 13), 0xc2b2ae35) + h2) >>> 0;
            h2 = (Math.imul(h2 ^ (h1 >>> 15), 0x85ebca6b) + h3) >>> 0;
            h3 = (Math.imul(h3 ^ (h2 >>> 16), 0x27d4eb2d) + h4) >>> 0;
            h4 = (Math.imul(h4 ^ (h3 >>> 11), 0x165667b1) + h1) >>> 0;
        }

        return [
            h1 & 0xff, (h1 >>> 8) & 0xff, (h1 >>> 16) & 0xff, (h1 >>> 24) & 0xff,
            h2 & 0xff, (h2 >>> 8) & 0xff, (h2 >>> 16) & 0xff, (h2 >>> 24) & 0xff,
            h3 & 0xff, (h3 >>> 8) & 0xff, (h3 >>> 16) & 0xff, (h3 >>> 24) & 0xff,
            h4 & 0xff, (h4 >>> 8) & 0xff, (h4 >>> 16) & 0xff, (h4 >>> 24) & 0xff
        ];
    }

    function computeKeyedMac(secretKey, iv, ciphertextHex) {
        return bytesToHex(mixState(`mac:${secretKey}:${iv}:${ciphertextHex}`, ciphertextHex.length));
    }

    function normalizeAuthToken(rawToken) {
        const clean = String(rawToken || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
        return clean.length >= 24 ? clean.slice(0, 64) : '';
    }

    // Deterministic derivation of Database ID, E2EE Key, and Write Token from authToken
    function deriveVaultCredentials(authToken) {
        const cleanToken = normalizeAuthToken(authToken);
        const vaultDbId = 'vlt' + computeKeyedMac(cleanToken, 'nosh-vault-db-id', 'v1').slice(0, 24);
        const vaultEncKey = computeKeyedMac(cleanToken, 'nosh-vault-enc-key', 'v1');
        const vaultWriteToken = computeKeyedMac(cleanToken, 'nosh-vault-write-token', 'v1');
        return {
            authToken: cleanToken,
            vaultDbId,
            vaultEncKey,
            vaultWriteToken
        };
    }

    // Deterministic per-note row ID in Supabase (27 alphanumeric chars)
    function deriveNoteDbId(authToken, noteTitle) {
        const cleanToken = normalizeAuthToken(authToken);
        const cleanTitle = String(noteTitle || '').trim();
        return 'nte' + computeKeyedMac(cleanToken, 'nosh-note-db-id', cleanTitle).slice(0, 24);
    }

    // Encrypts authToken into a compact QR URI: nosh://token?e=<cipherHex>&k=<keyHex>&m=<macHex>
    function encodeEncryptedTokenQR(authToken, transferKey) {
        const cleanToken = normalizeAuthToken(authToken);
        const k = (transferKey || generateRandomHex(8)).replace(/[^0-9a-fA-F]/g, '').slice(0, 16);
        const plainBytes = utf8ToBytes(cleanToken);
        const cipherBytes = new Array(plainBytes.length);
        let ksBlock = [];
        for (let i = 0; i < plainBytes.length; i++) {
            if (i % 16 === 0) ksBlock = mixState(`qr-token:${k}`, Math.floor(i / 16));
            cipherBytes[i] = plainBytes[i] ^ ksBlock[i % 16];
        }
        const e = bytesToHex(cipherBytes);
        const m = computeKeyedMac(k, 'qr-token-mac', e).slice(0, 16);
        return `nosh://token?e=${e}&k=${k}&m=${m}`;
    }

    // Decrypts nosh://token?e=...&k=...&m=... back into the user's authToken
    function decodeEncryptedTokenQR(rawInput) {
        const trimmed = String(rawInput || '').trim();
        if (!trimmed) return null;

        if (/^[0-9a-fA-F]{24,64}$/.test(trimmed)) {
            return normalizeAuthToken(trimmed);
        }

        const qIdx = trimmed.indexOf('?');
        if (qIdx === -1) return null;
        const query = trimmed.slice(qIdx + 1);
        const map = {};
        for (const part of query.split('&')) {
            const eq = part.indexOf('=');
            if (eq > 0) {
                map[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
            }
        }

        if (map.e && map.k && map.m) {
            const expectedMac = computeKeyedMac(map.k, 'qr-token-mac', map.e).slice(0, 16);
            if (expectedMac !== map.m) return null;
            const cipherBytes = hexToBytes(map.e);
            const plainBytes = new Array(cipherBytes.length);
            let ksBlock = [];
            for (let i = 0; i < cipherBytes.length; i++) {
                if (i % 16 === 0) ksBlock = mixState(`qr-token:${map.k}`, Math.floor(i / 16));
                plainBytes[i] = cipherBytes[i] ^ ksBlock[i % 16];
            }
            const candidate = bytesToUtf8(plainBytes);
            return normalizeAuthToken(candidate) || null;
        }

        if (map.k && normalizeAuthToken(map.k)) {
            return normalizeAuthToken(map.k);
        }

        return null;
    }

    function encryptPayloadE2EE(payloadObj, secretKey, roomId, senderId, type) {
        const iv = generateRandomHex(8);
        const plainBytes = utf8ToBytes(JSON.stringify(payloadObj));
        const cipherBytes = new Array(plainBytes.length);
        let ksBlock = [];
        for (let i = 0; i < plainBytes.length; i++) {
            if (i % 16 === 0) ksBlock = mixState(`${secretKey}:${iv}`, Math.floor(i / 16));
            cipherBytes[i] = plainBytes[i] ^ ksBlock[i % 16];
        }
        const ciphertext = bytesToHex(cipherBytes);
        const mac = computeKeyedMac(secretKey, iv, ciphertext);
        return { v: 1, roomId, senderId, type, iv, ciphertext, mac, ts: Date.now() };
    }

    function decryptPayloadE2EE(envelope, secretKey) {
        if (!envelope || !envelope.ciphertext || !envelope.iv || !envelope.mac) return null;
        if (computeKeyedMac(secretKey, envelope.iv, envelope.ciphertext) !== envelope.mac) return null;
        const cipherBytes = hexToBytes(envelope.ciphertext);
        const plainBytes = new Array(cipherBytes.length);
        let ksBlock = [];
        for (let i = 0; i < cipherBytes.length; i++) {
            if (i % 16 === 0) ksBlock = mixState(`${secretKey}:${envelope.iv}`, Math.floor(i / 16));
            plainBytes[i] = cipherBytes[i] ^ ksBlock[i % 16];
        }
        try {
            return JSON.parse(bytesToUtf8(plainBytes));
        } catch {
            return null;
        }
    }

    // Encrypts/Decrypts authToken for Google Drive backup (nosh_auth_token.enc)
    function encryptAuthTokenForDrive(authToken) {
        const iv = generateRandomHex(8);
        const driveKey = computeKeyedMac('nosh-google-drive-vault-v1', iv, 'token-backup');
        const env = encryptPayloadE2EE(
            { v: 1, authToken: normalizeAuthToken(authToken), updatedAt: Date.now() },
            driveKey,
            'noshdrivevault01',
            'desktop',
            'vault-snapshot'
        );
        env.driveIv = iv;
        return JSON.stringify(env);
    }

    function decryptAuthTokenFromDrive(rawStr) {
        if (!rawStr) return null;
        try {
            const env = typeof rawStr === 'string' ? JSON.parse(rawStr) : rawStr;
            if (!env || !env.driveIv) return null;
            const driveKey = computeKeyedMac('nosh-google-drive-vault-v1', env.driveIv, 'token-backup');
            const dec = decryptPayloadE2EE(env, driveKey);
            if (dec && dec.authToken) {
                return normalizeAuthToken(dec.authToken) || null;
            }
        } catch {}
        return null;
    }

    // Standard ISO/IEC 18004 QR Code SVG Generator via qrcode-generator
    function renderQRCodeSvg(text, pxSize = 196) {
        if (typeof window.qrcode !== 'function') {
            return '<div style="padding:20px;font-size:12px;color:#ef4444;">QR library not loaded</div>';
        }
        const qr = window.qrcode(0, 'M');
        qr.addData(text || 'nosh://token');
        qr.make();

        const moduleCount = qr.getModuleCount();
        const quietZone = 2;
        const totalModules = moduleCount + quietZone * 2;
        const cellSize = pxSize / totalModules;

        let rects = '';
        for (let r = 0; r < moduleCount; r++) {
            for (let c = 0; c < moduleCount; c++) {
                if (qr.isDark(r, c)) {
                    const x = ((c + quietZone) * cellSize).toFixed(2);
                    const y = ((r + quietZone) * cellSize).toFixed(2);
                    const w = (cellSize + 0.35).toFixed(2);
                    rects += `<rect x="${x}" y="${y}" width="${w}" height="${w}" fill="#0d0f12"/>`;
                }
            }
        }
        return `<svg width="${pxSize}" height="${pxSize}" viewBox="0 0 ${pxSize} ${pxSize}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${pxSize}" height="${pxSize}" rx="6" fill="#ffffff"/>${rects}</svg>`;
    }

    const desktopPeer = {
        peerId: localStorage.getItem('nosh_anon_peer_id') || `desk-${generateRandomHex(3)}`,
        alias: 'Desktop',
        color: '#6366f1',
        deviceType: 'desktop',
        lastSeen: Date.now()
    };
    localStorage.setItem('nosh_anon_peer_id', desktopPeer.peerId);

    function getOrInitAuthToken() {
        let existing = normalizeAuthToken(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY));
        if (!existing) {
            existing = generateRandomHex(16);
            localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, existing);
        }
        return existing;
    }

    function getOrInitQrTransferKey() {
        let key = localStorage.getItem(QR_EPHEMERAL_KEY_STORAGE);
        if (!key || key.length < 16) {
            key = generateRandomHex(8);
            localStorage.setItem(QR_EPHEMERAL_KEY_STORAGE, key);
        }
        return key;
    }

    let activeAuthToken = getOrInitAuthToken();
    let qrTransferKey = getOrInitQrTransferKey();
    let ws = null;
    let refCounter = 1;
    let heartbeatId = null;
    let pollId = null;
    let pushDebounceTimer = null;
    let lastProcessedManifestTs = 0;
    let dbSyncedStatus = false;
    let driveTokenBackedUp = false;
    let isPushingVault = false;

    function loadSyncedMtimes(token) {
        try {
            const raw = localStorage.getItem(SYNCED_MTIMES_PREFIX + token);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }

    function saveSyncedMtimes(token, map) {
        try {
            localStorage.setItem(SYNCED_MTIMES_PREFIX + token, JSON.stringify(map));
        } catch {}
    }

    async function collectDesktopVaultNotes() {
        if (typeof invokeSavesDir === 'function') await invokeSavesDir();
        if (typeof savesDir === 'undefined' || !savesDir || typeof fsPromises === 'undefined') return [];
        try {
            const files = await fsPromises.readdir(savesDir);
            const nshFiles = files.filter((f) => f.toLowerCase().endsWith('.nsh'));
            const notes = [];
            for (const file of nshFiles) {
                const title = path.basename(file, '.nsh');
                const fullPath = path.join(savesDir, file);
                let rawNsh = await fsPromises.readFile(fullPath, 'utf8');
                if (
                    typeof activeNoteName !== 'undefined' &&
                    activeNoteName === title &&
                    typeof getCleanContentHTML === 'function'
                ) {
                    const liveHtml = getCleanContentHTML();
                    if (liveHtml) rawNsh = liveHtml;
                }
                const stat = await fsPromises.stat(fullPath);
                notes.push({
                    id: `note-${title}`,
                    title,
                    blocks: [],
                    rawNsh,
                    pinned: typeof getPinnedNotes === 'function' ? getPinnedNotes().includes(title) : false,
                    updatedAt: Math.floor(stat.mtimeMs || Date.now()),
                    versionClock: 1
                });
            }
            return notes;
        } catch {
            return [];
        }
    }

    async function upsertEncryptedRowToSupabase(rowId, writeToken, titleLabel, envelope) {
        const contentStr = JSON.stringify(envelope);
        if (contentStr.length > 1990000) {
            console.warn(`Skipping oversized row ${rowId} (${contentStr.length} chars)`);
            return false;
        }
        const headers = {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
        };

        try {
            const updRes = await fetch(`${SUPABASE_BASE_URL}/rest/v1/rpc/update_shared_note`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    p_id: rowId,
                    p_edit_token: writeToken,
                    p_title: titleLabel,
                    p_content: contentStr
                })
            });
            const updated = updRes.ok ? await updRes.json() : false;
            if (!updated) {
                const pubRes = await fetch(`${SUPABASE_BASE_URL}/rest/v1/rpc/publish_shared_note`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        p_id: rowId,
                        p_title: titleLabel,
                        p_content: contentStr,
                        p_edit_token: writeToken
                    })
                });
                return pubRes.ok;
            }
            return true;
        } catch {
            return false;
        }
    }

    async function fetchEncryptedRowsByIds(rowIds) {
        if (!Array.isArray(rowIds) || rowIds.length === 0) return [];
        const headers = {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        };
        const results = [];
        const batchSize = 15;
        for (let i = 0; i < rowIds.length; i += batchSize) {
            const slice = rowIds.slice(i, i + batchSize);
            const inList = slice.map((id) => encodeURIComponent(id)).join(',');
            try {
                const res = await fetch(
                    `${SUPABASE_BASE_URL}/rest/v1/shared_notes?id=in.(${inList})&select=id,content`,
                    { headers }
                );
                if (res.ok) {
                    const rows = await res.json();
                    if (Array.isArray(rows)) {
                        results.push(...rows);
                    }
                }
            } catch {}
        }
        return results;
    }

    // ========================================================================
    // Per-Note + Vault Manifest Push & Pull via authToken
    // ========================================================================
    async function pushVaultByAuthToken(forceAllNotes = false) {
        if (isPushingVault) return false;
        isPushingVault = true;

        try {
            const creds = deriveVaultCredentials(activeAuthToken);
            const allNotes = await collectDesktopVaultNotes();
            const syncedMtimes = loadSyncedMtimes(creds.authToken);
            const nextMtimes = { ...syncedMtimes };
            const manifest = [];

            for (const note of allNotes) {
                const noteDbId = deriveNoteDbId(creds.authToken, note.title);
                manifest.push({
                    noteDbId,
                    title: note.title,
                    pinned: Boolean(note.pinned),
                    updatedAt: note.updatedAt,
                    versionClock: note.versionClock || 1
                });

                // Upload individual note row if new, modified, or forced
                if (forceAllNotes || nextMtimes[noteDbId] !== note.updatedAt) {
                    const noteEnv = encryptPayloadE2EE(
                        note,
                        creds.vaultEncKey,
                        noteDbId,
                        desktopPeer.peerId,
                        'vault-snapshot'
                    );
                    const ok = await upsertEncryptedRowToSupabase(
                        noteDbId,
                        creds.vaultWriteToken,
                        'nosh-note-row',
                        noteEnv
                    );
                    if (ok) {
                        nextMtimes[noteDbId] = note.updatedAt;
                    }
                }
            }

            // Clean up mtime entries for notes that no longer exist locally
            const activeDbIds = new Set(manifest.map((m) => m.noteDbId));
            for (const k of Object.keys(nextMtimes)) {
                if (!activeDbIds.has(k)) {
                    delete nextMtimes[k];
                }
            }
            saveSyncedMtimes(creds.authToken, nextMtimes);

            // Upload lightweight Vault Manifest row
            const manifestPayload = {
                v: 2,
                peer: desktopPeer,
                updatedAt: Date.now(),
                manifest
            };
            const manifestEnv = encryptPayloadE2EE(
                manifestPayload,
                creds.vaultEncKey,
                creds.vaultDbId,
                desktopPeer.peerId,
                'vault-snapshot'
            );
            const manifestOk = await upsertEncryptedRowToSupabase(
                creds.vaultDbId,
                creds.vaultWriteToken,
                'nosh-token-vault',
                manifestEnv
            );

            if (manifestOk) {
                dbSyncedStatus = true;
                updateQRModalUI();
                broadcastEncryptedWs('vault-snapshot', manifestPayload);
            }
            return manifestOk;
        } finally {
            isPushingVault = false;
        }
    }

    async function applyRemoteManifestToDesktop(manifest, creds, strategy = 'incremental', showNotification = false) {
        if (!Array.isArray(manifest)) return 0;
        if (typeof invokeSavesDir === 'function') await invokeSavesDir();
        if (!savesDir || typeof fsPromises === 'undefined') return 0;

        const syncedMtimes = loadSyncedMtimes(creds.authToken);
        const localFiles = await fsPromises.readdir(savesDir);
        const localNshMap = new Map();

        for (const f of localFiles) {
            if (!f.toLowerCase().endsWith('.nsh')) continue;
            const title = path.basename(f, '.nsh');
            const fullPath = path.join(savesDir, f);
            try {
                const st = await fsPromises.stat(fullPath);
                localNshMap.set(title, {
                    filePath: fullPath,
                    mtimeMs: Math.floor(st.mtimeMs || 0)
                });
            } catch {}
        }

        // Determine which noteDbIds need to be downloaded from Supabase
        const toDownloadIds = [];
        for (const item of manifest) {
            if (!item || !item.title || !item.noteDbId) continue;
            const localInfo = localNshMap.get(item.title);
            if (strategy === 'replace' || !localInfo || (item.updatedAt || 0) > localInfo.mtimeMs + 500) {
                toDownloadIds.push(item.noteDbId);
            }
        }

        let changedCount = 0;

        if (toDownloadIds.length > 0) {
            const rows = await fetchEncryptedRowsByIds(toDownloadIds);
            for (const row of rows) {
                if (!row || !row.content) continue;
                try {
                    const env = JSON.parse(row.content);
                    const noteObj = decryptPayloadE2EE(env, creds.vaultEncKey);
                    if (!noteObj || !noteObj.title) continue;

                    const safeName = noteObj.title.trim().replace(/[\/\\:*?"<>|]/g, '');
                    if (!safeName) continue;
                    const filePath = path.join(savesDir, `${safeName}.nsh`);
                    const incomingHtml = noteObj.rawNsh || `<h1>${safeName}</h1>`;

                    let existingHtml = null;
                    try {
                        existingHtml = await fsPromises.readFile(filePath, 'utf8');
                    } catch {}

                    if (existingHtml !== incomingHtml) {
                        await fsPromises.writeFile(filePath, incomingHtml, 'utf8');
                        changedCount++;
                        if (typeof activeNoteName !== 'undefined' && activeNoteName === safeName && typeof content !== 'undefined') {
                            const beforeSync = window.NoshUndo ? window.NoshUndo.peekCommittedState() : null;
                            content.innerHTML = incomingHtml;
                            if (typeof processCodeBlock === 'function') processCodeBlock();
                            if (window.NoshUndo) window.NoshUndo.onExternalContentReplaced(safeName, beforeSync);
                        }
                    }

                    const stAfter = await fsPromises.stat(filePath);
                    syncedMtimes[row.id] = Math.floor(stAfter.mtimeMs || Date.now());
                } catch {}
            }
        }

        // Handle notes deleted on the remote device (or when replacing vault)
        const remoteTitleSet = new Set(manifest.map((m) => m.title));
        for (const [localTitle, localInfo] of localNshMap.entries()) {
            const noteDbId = deriveNoteDbId(creds.authToken, localTitle);
            const wasPreviouslySynced = Boolean(syncedMtimes[noteDbId]);
            if (!remoteTitleSet.has(localTitle) && (strategy === 'replace' || wasPreviouslySynced)) {
                try {
                    const trashDir = path.join(savesDir, '.trash');
                    if (!fs.existsSync(trashDir)) {
                        await fsPromises.mkdir(trashDir, { recursive: true });
                    }
                    await fsPromises.rename(localInfo.filePath, path.join(trashDir, `${localTitle}.nsh`));
                    delete syncedMtimes[noteDbId];
                    changedCount++;
                } catch {}
            }
        }

        saveSyncedMtimes(creds.authToken, syncedMtimes);

        if (changedCount > 0) {
            if (typeof readDatabase === 'function') {
                await readDatabase(typeof activeNoteName !== 'undefined' ? activeNoteName : undefined);
            }
            if (showNotification && typeof showToast === 'function') {
                showToast(`Synced ${changedCount} note(s) with vault`, 'success');
            }
        }
        return changedCount;
    }

    async function pullVaultByAuthToken(strategy = 'incremental', showNotification = false) {
        const creds = deriveVaultCredentials(activeAuthToken);
        const rows = await fetchEncryptedRowsByIds([creds.vaultDbId]);
        if (!Array.isArray(rows) || rows.length === 0 || !rows[0].content) return false;

        try {
            const env = JSON.parse(rows[0].content);
            if (!env) return false;
            dbSyncedStatus = true;
            updateQRModalUI();

            if (strategy === 'incremental') {
                if (env.senderId === desktopPeer.peerId) return true;
                if (env.ts && env.ts <= lastProcessedManifestTs) return true;
            }

            const dec = decryptPayloadE2EE(env, creds.vaultEncKey);
            if (!dec) return false;

            lastProcessedManifestTs = env.ts || Date.now();

            if (Array.isArray(dec.manifest)) {
                await applyRemoteManifestToDesktop(dec.manifest, creds, strategy, showNotification);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    function scheduleAuthTokenVaultPush() {
        if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
        pushDebounceTimer = setTimeout(() => {
            pushVaultByAuthToken(false);
        }, 300);
    }

    function broadcastEncryptedWs(type, data) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const creds = deriveVaultCredentials(activeAuthToken);
        const envelope = encryptPayloadE2EE(data, creds.vaultEncKey, creds.vaultDbId, desktopPeer.peerId, type);
        const topic = `realtime:nosh-e2ee-${creds.vaultDbId}`;
        ws.send(
            JSON.stringify({
                topic,
                event: 'broadcast',
                payload: { type: 'broadcast', event: 'nosh-e2ee', payload: envelope },
                ref: String(refCounter++)
            })
        );
    }

    function connectAuthTokenSyncChannel() {
        if (ws) {
            try { ws.close(); } catch {}
        }
        if (heartbeatId) clearInterval(heartbeatId);
        if (pollId) clearInterval(pollId);

        const creds = deriveVaultCredentials(activeAuthToken);

        // Upload all local Desktop notes (including existing old .nsh files) to Supabase,
        // then pull any remote updates
        pushVaultByAuthToken(false).then(() => {
            pullVaultByAuthToken('incremental', false);
        });

        // Poll database every 4 seconds for edits coming from Mobile
        pollId = setInterval(() => {
            pullVaultByAuthToken('incremental', true);
        }, 4000);

        // Connect Realtime WebSocket on vaultDbId for instant notifications
        try {
            ws = new WebSocket(RELAY_WS_URL);
            const topic = `realtime:nosh-e2ee-${creds.vaultDbId}`;

            ws.onopen = () => {
                ws.send(
                    JSON.stringify({
                        topic,
                        event: 'phx_join',
                        payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' } } },
                        ref: String(refCounter++)
                    })
                );
                broadcastEncryptedWs('peer-hello', desktopPeer);

                heartbeatId = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(refCounter++) }));
                    }
                }, 20000);
            };

            ws.onmessage = async (ev) => {
                try {
                    const msg = JSON.parse(ev.data);
                    if (msg.event === 'broadcast' && msg.payload && msg.payload.payload) {
                        const env = msg.payload.payload;
                        if (!env || env.senderId === desktopPeer.peerId) return;
                        const dec = decryptPayloadE2EE(env, creds.vaultEncKey);
                        if (!dec) return;

                        if (env.type === 'peer-hello' || env.type === 'vault-request') {
                            await pushVaultByAuthToken(false);
                        } else if (env.type === 'vault-snapshot' || env.type === 'block-crdt-op' || env.type === 'note-crdt-op') {
                            await pullVaultByAuthToken('incremental', true);
                        }
                    }
                } catch {}
            };
        } catch {}
    }

    // ========================================================================
    // Google Drive Encrypted AuthToken Backup & Restore
    // ========================================================================
    function isGoogleDriveLinked() {
        const access = localStorage.getItem('google_drive_access_token');
        const refresh = localStorage.getItem('google_drive_refresh_token');
        return Boolean((access && access !== 'null') || (refresh && refresh !== 'null'));
    }

    async function syncAuthTokenWithGoogleDrive(forceUploadCurrent = false) {
        if (!isGoogleDriveLinked() || typeof driveCall !== 'function') {
            driveTokenBackedUp = false;
            updateQRModalUI();
            return false;
        }

        try {
            if (!forceUploadCurrent) {
                const remoteEncrypted = await driveCall('loadEncryptedAuthToken');
                if (remoteEncrypted) {
                    const recoveredToken = decryptAuthTokenFromDrive(remoteEncrypted);
                    if (recoveredToken && recoveredToken !== activeAuthToken) {
                        activeAuthToken = recoveredToken;
                        localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, activeAuthToken);
                        lastProcessedManifestTs = 0;
                        connectAuthTokenSyncChannel();
                        if (typeof showToast === 'function') {
                            showToast('Restored encrypted sync token from Google Drive', 'success');
                        }
                    }
                    driveTokenBackedUp = true;
                    updateQRModalUI();
                    return true;
                }
            }

            const encryptedPayload = encryptAuthTokenForDrive(activeAuthToken);
            await driveCall('saveEncryptedAuthToken', encryptedPayload);
            driveTokenBackedUp = true;
            updateQRModalUI();
            return true;
        } catch (err) {
            console.warn('Could not sync encrypted authToken with Google Drive:', err);
            return false;
        }
    }

    function setAuthToken(newToken, uploadToDrive = true) {
        const clean = normalizeAuthToken(newToken);
        if (!clean) return false;
        activeAuthToken = clean;
        localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, activeAuthToken);
        qrTransferKey = generateRandomHex(8);
        localStorage.setItem(QR_EPHEMERAL_KEY_STORAGE, qrTransferKey);
        lastProcessedManifestTs = 0;
        if (uploadToDrive && isGoogleDriveLinked()) {
            syncAuthTokenWithGoogleDrive(true);
        }
        updateQRModalUI();
        return true;
    }

    function updateQRModalUI() {
        const qrContainer = document.getElementById('nosh-qr-svg-wrap');
        const uriInput = document.getElementById('nosh-qr-uri-display');
        const statusText = document.getElementById('nosh-qr-status-text');
        const tokenBadgeEl = document.getElementById('nosh-auth-token-preview');
        const driveBadgeEl = document.getElementById('nosh-drive-token-status');
        if (!qrContainer) return;

        const encryptedQrUri = encodeEncryptedTokenQR(activeAuthToken, qrTransferKey);
        qrContainer.innerHTML = renderQRCodeSvg(encryptedQrUri, 196);
        if (uriInput) uriInput.value = encryptedQrUri;

        if (tokenBadgeEl) {
            const masked = `${activeAuthToken.slice(0, 6)}••••${activeAuthToken.slice(-6)}`;
            tokenBadgeEl.textContent = masked;
        }

        if (driveBadgeEl) {
            if (isGoogleDriveLinked()) {
                driveBadgeEl.textContent = driveTokenBackedUp
                    ? 'Google Drive: Token Encrypted & Backed Up'
                    : 'Google Drive: Encrypting Token...';
                driveBadgeEl.style.color = '#10b981';
            } else {
                driveBadgeEl.textContent = 'Google Drive: Not Linked (Local Token)';
                driveBadgeEl.style.color = 'var(--text-muted)';
            }
        }

        if (statusText) {
            if (dbSyncedStatus) {
                statusText.textContent = 'All Notes Uploaded to Encrypted Vault • Ready to Scan';
                statusText.style.color = '#10b981';
            } else {
                statusText.textContent = 'Uploading Vault Notes to Encrypted Database...';
                statusText.style.color = 'var(--text-muted)';
            }
        }
    }

    async function openQRSyncModal() {
        updateQRModalUI();
        if (typeof openModal === 'function') {
            openModal('qr-sync-modal');
        }
        // Ensure all existing and current Desktop notes are pushed to Supabase before scanning
        await pushVaultByAuthToken(false);
        if (isGoogleDriveLinked() && !driveTokenBackedUp) {
            syncAuthTokenWithGoogleDrive(false);
        }
    }

    function copyQRSyncUri() {
        const inp = document.getElementById('nosh-qr-uri-display');
        if (inp && navigator.clipboard) {
            navigator.clipboard.writeText(inp.value);
            if (typeof showToast === 'function') showToast('Encrypted token link copied', 'success');
        }
    }

    async function resetQRSyncRoom() {
        const freshToken = generateRandomHex(16);
        setAuthToken(freshToken, true);
        await pushVaultByAuthToken(true);
        connectAuthTokenSyncChannel();
        if (typeof showToast === 'function') showToast('Generated new encrypted auth token & uploaded vault', 'info');
    }

    async function joinQRSyncFromInput(strategy = 'merge') {
        const inp = document.getElementById('nosh-qr-uri-display');
        if (!inp) return;
        const decodedToken = decodeEncryptedTokenQR(inp.value);
        if (!decodedToken) {
            if (typeof showToast === 'function') showToast('Invalid encrypted token link', 'error');
            return;
        }
        setAuthToken(decodedToken, true);
        if (strategy === 'replace') {
            await pullVaultByAuthToken('replace', true);
        } else {
            await pullVaultByAuthToken('merge', true);
            await pushVaultByAuthToken(true);
        }
        connectAuthTokenSyncChannel();
        if (typeof showToast === 'function') {
            showToast(
                strategy === 'replace' ? 'Loaded remote vault' : 'Merged vaults across devices',
                'success'
            );
        }
    }

    async function pushQRSyncNow() {
        await pushVaultByAuthToken(true);
        await pullVaultByAuthToken('incremental', true);
        if (isGoogleDriveLinked()) {
            await syncAuthTokenWithGoogleDrive(false);
        }
        if (typeof showToast === 'function') showToast('All notes synced with Supabase vault', 'success');
    }

    window.openQRSyncModal = openQRSyncModal;
    window.copyQRSyncUri = copyQRSyncUri;
    window.resetQRSyncRoom = resetQRSyncRoom;
    window.joinQRSyncFromInput = joinQRSyncFromInput;
    window.pushQRSyncNow = pushQRSyncNow;
    window.scheduleAuthTokenVaultPush = scheduleAuthTokenVaultPush;
    window.syncAuthTokenWithGoogleDrive = syncAuthTokenWithGoogleDrive;

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            connectAuthTokenSyncChannel();
            if (isGoogleDriveLinked()) {
                syncAuthTokenWithGoogleDrive(false);
            }
        }, 350);
    });
})();
