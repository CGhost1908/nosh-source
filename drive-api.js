// Google Drive operations. Loaded by preload.js only (never by page code), so the OAuth client
// and the googleapis library stay outside the page; the page gets plain results back.
//
// Every function takes `auth` = { clientId, clientSecret, accessToken, refreshToken } and returns
// { value, tokens } where `tokens` holds anything that was refreshed, for the page to persist.
const fs = require('fs');
const path = require('path');

const REDIRECT_URI = 'http://localhost:2222/drive-callback';
const FOLDER_NAME = 'noshTheNotepad';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

function coded(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

// Optional .env (git-ignored) holding default credentials, same as the main process reads
let envLoaded = false;
function defaultCredentials() {
    if (!envLoaded) {
        envLoaded = true;
        try {
            const envPath = path.join(__dirname, '.env');
            if (fs.existsSync(envPath)) {
                for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;
                    const eq = trimmed.indexOf('=');
                    if (eq <= 0) continue;
                    const key = trimmed.slice(0, eq).trim();
                    let val = trimmed.slice(eq + 1).trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    if (!process.env[key]) process.env[key] = val;
                }
            }
        } catch (err) {
            console.error('Error loading .env for Google Drive:', err);
        }
    }
    return {
        clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || ''
    };
}

function hasDefaultCredentials() {
    const d = defaultCredentials();
    return Boolean(d.clientId && d.clientSecret);
}

function resolveCredentials(auth) {
    const d = defaultCredentials();
    return {
        clientId: d.clientId || (auth && auth.clientId) || '',
        clientSecret: d.clientSecret || (auth && auth.clientSecret) || ''
    };
}

// Escape a value for use inside a single-quoted Drive search query
function q(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function newOAuthClient(auth) {
    const { google } = require('googleapis');
    const { clientId, clientSecret } = resolveCredentials(auth);
    if (!clientId || !clientSecret) {
        throw coded('DRIVE_NOT_CONFIGURED', 'Google Drive client ID and secret are not set');
    }
    return { google, oauth: new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI) };
}

// Authenticated Drive client that refreshes the access token when it can
async function connect(auth) {
    if (!auth || (!auth.accessToken && !auth.refreshToken)) {
        throw coded('DRIVE_NOT_CONFIGURED', 'Google Drive is not connected');
    }
    const { google, oauth } = newOAuthClient(auth);
    oauth.setCredentials({
        access_token: auth.accessToken || undefined,
        refresh_token: auth.refreshToken || undefined
    });

    const tokens = {};
    oauth.on('tokens', (t) => {
        if (t.access_token) tokens.accessToken = t.access_token;
        if (t.refresh_token) tokens.refreshToken = t.refresh_token;
    });

    if (auth.refreshToken) {
        try {
            const res = await oauth.getAccessToken();
            if (res && res.token) tokens.accessToken = res.token;
        } catch (err) {
            const msg = (err && err.message) || '';
            if (msg.includes('invalid_grant') || msg.includes('Invalid Credentials')) {
                throw coded('DRIVE_SESSION_EXPIRED', 'Google Drive session expired');
            }
            console.error('Failed to validate or refresh the Google Drive access token:', err);
        }
    }
    return { drive: google.drive({ version: 'v3', auth: oauth }), tokens };
}

async function findFolderId(drive) {
    const res = await drive.files.list({
        q: `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: 'files(id, name)'
    });
    return (res.data.files && res.data.files[0] && res.data.files[0].id) || null;
}

const operations = {
    async authUrl(auth) {
        const { oauth } = newOAuthClient(auth);
        const value = oauth.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/drive.file',
                'https://www.googleapis.com/auth/userinfo.email'
            ]
        });
        return { value, tokens: {} };
    },

    async ping(auth) {
        const { tokens } = await connect(auth);
        return { value: true, tokens };
    },

    async profile(auth) {
        const { drive, tokens } = await connect(auth);
        const res = await drive.about.get({ fields: 'user(displayName,emailAddress)' });
        const user = res && res.data && res.data.user;
        return { value: user ? { email: user.emailAddress || '', name: user.displayName || '' } : null, tokens };
    },

    async upload(auth, fileName, content) {
        const name = path.basename(String(fileName));
        const { drive, tokens } = await connect(auth);

        let folderId = await findFolderId(drive);
        if (!folderId) {
            const created = await drive.files.create({
                resource: { name: FOLDER_NAME, mimeType: FOLDER_MIME },
                fields: 'id'
            });
            folderId = created.data.id;
        }

        const existing = await drive.files.list({
            q: `name = '${q(name)}' and '${q(folderId)}' in parents and trashed = false`,
            fields: 'files(id, name)'
        });
        const media = { mimeType: 'text/plain', body: String(content) };
        const files = existing.data.files || [];

        if (files.length > 0) {
            await drive.files.update({ fileId: files[0].id, media });
            for (let i = 1; i < files.length; i++) { // clean up duplicate copies
                try { await drive.files.delete({ fileId: files[i].id }); } catch (_) {}
            }
        } else {
            await drive.files.create({ resource: { name, parents: [folderId] }, media, fields: 'id' });
        }
        return { value: true, tokens };
    },

    async deleteByName(auth, noteName) {
        const { drive, tokens } = await connect(auth);
        const res = await drive.files.list({
            q: `name = '${q(noteName)}.nsh' and trashed = false`,
            fields: 'files(id, name)'
        });
        for (const file of res.data.files || []) {
            await drive.files.delete({ fileId: file.id });
        }
        return { value: true, tokens };
    },

    async rename(auth, oldName, newName) {
        const { drive, tokens } = await connect(auth);
        const res = await drive.files.list({
            q: `name = '${q(oldName)}.nsh' and trashed = false`,
            fields: 'files(id, name)'
        });
        for (const file of res.data.files || []) {
            await drive.files.update({ fileId: file.id, resource: { name: `${newName}.nsh` } });
        }
        return { value: true, tokens };
    },

    // Names (without .nsh) of the notes synced to Drive; null when the folder does not exist yet
    async listSyncedNames(auth) {
        const { drive, tokens } = await connect(auth);
        const folderId = await findFolderId(drive);
        if (!folderId) return { value: null, tokens };
        const res = await drive.files.list({
            q: `'${q(folderId)}' in parents and trashed = false`,
            fields: 'files(id, name)',
            pageSize: 1000
        });
        const names = (res.data.files || []).map(f => path.basename(f.name, '.nsh'));
        return { value: names, tokens };
    },

    async listNoteFiles(auth) {
        const { drive, tokens } = await connect(auth);
        const folderId = await findFolderId(drive);
        if (!folderId) return { value: { folderExists: false, files: [] }, tokens };
        const res = await drive.files.list({
            q: `'${q(folderId)}' in parents and name contains '.nsh' and trashed = false`,
            fields: 'files(id, name)'
        });
        const files = (res.data.files || []).map(f => ({ id: f.id, name: f.name }));
        return { value: { folderExists: true, files }, tokens };
    },

    async download(auth, fileId) {
        const { drive, tokens } = await connect(auth);
        const res = await drive.files.get({ fileId: String(fileId), alt: 'media' }, { responseType: 'text' });
        return { value: typeof res.data === 'string' ? res.data : String(res.data), tokens };
    }
};

// Entry point used by the preload bridge: runs a whitelisted operation and never throws
async function call(op, auth, args) {
    if (!Object.prototype.hasOwnProperty.call(operations, op)) {
        return { ok: false, code: 'DRIVE_UNKNOWN_OP', message: `Unknown Drive operation "${op}"` };
    }
    try {
        const { value, tokens } = await operations[op](auth || {}, ...(Array.isArray(args) ? args : []));
        return { ok: true, value, tokens: tokens && Object.keys(tokens).length ? tokens : null };
    } catch (err) {
        return { ok: false, code: err.code && String(err.code).startsWith('DRIVE_') ? err.code : 'DRIVE_ERROR', message: (err && err.message) || 'Google Drive request failed' };
    }
}

module.exports = { call, hasDefaultCredentials };
