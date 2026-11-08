# Nosh Privacy Policy

**Effective Date:** November 8, 2026  
**Application:** Nosh Desktop (Code & Note Editor)  
**Publisher / Maintainers:** CGhost1908 and Nosh Contributors  
**License:** [MIT License](LICENSE)  
**Repository:** [https://github.com/CGhost1908/nosh-source](https://github.com/CGhost1908/nosh-source)

---

## Overview

Nosh is a desktop notepad and code organizer. Your notes, files, and settings are stored locally on your device by default. Nosh does not collect background telemetry or track your usage, and only establishes network connections for online features you explicitly choose to use.

---

## 1. Local Data Storage

All notes (saved as `.nsh` files), folder structures, snapshots, and application settings are written directly to your local file system.

- **Local Ownership:** You own your files. You can copy, backup, move, or delete your note files directly through your system file manager at any time.
- **No Mandatory Account:** You do not need to register an account or provide personal information to use the application.
- **No Central Surveillance Server:** Nosh does not run a proprietary server that silently reads or indexes your local notes.

---

## 2. No Telemetry or Usage Analytics

- Nosh does not include telemetry frameworks, user tracking services, or analytics packages (such as Google Analytics, PostHog, or Mixpanel).
- Nosh does not collect crash logs, hardware fingerprints, session durations, or statistics about what you write.

---

## 3. Network Connections and Online Features

Nosh only connects to external networks when you use features that inherently require an internet connection:

### 3.1 Google Drive Integration (Optional)

If you connect Google Drive to back up or sync your notes:
- **Scope of Access:** Nosh requests access only to files and folders it creates or opens within the dedicated `noshTheNotepad` folder (`https://www.googleapis.com/auth/drive.file`), and read-only access to your email address (`https://www.googleapis.com/auth/userinfo.email`) to display the connected account in settings. Nosh cannot view or modify other files in your Google Drive.
- **Token Storage:** OAuth authentication tokens are stored exclusively on your local computer and are never sent to third parties.
- **Disconnection:** You can disconnect Google Drive at any time in the app settings, which immediately purges all stored tokens from your machine.
- **Google Limited Use Compliance:** Nosh adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including Limited Use requirements. Google user data is not transferred to third parties (except to facilitate Google Drive sync), is not used for advertising, and is not used to train AI or machine learning models.

### 3.2 Public Note Sharing (Supabase)

If you use the feature to share a note publicly via a link:
- Only the specific note you explicitly choose to publish is uploaded over HTTPS to our Supabase database instance.
- Notes you do not publish remain strictly on your local computer.
- Anyone with the generated share link can view the published note through the web viewer. You can unpublish or delete the shared note from the editor at any time.

### 3.3 Media Hosting for Shared Notes (Catbox.moe)

If a note you choose to share publicly contains local image or video files, those media assets are uploaded via HTTPS to [Catbox.moe](https://catbox.moe) so that viewers of the shared web link can see them. This upload occurs only upon publishing a note containing media.

### 3.4 Multi-Device Vault Sync (Optional)

If you use the optional cross-device synchronization feature:
- Notes are encrypted on your device using client-side encryption before transmission.
- The relay server receives only encrypted ciphertext blobs and cannot read the plain text of your notes.

### 3.5 Embedded Content (YouTube)

When you embed or play a YouTube video in Nosh, requests are made directly to YouTube/Google servers (IFrame and oEmbed APIs) to display the player. These requests are governed by Google's Privacy Policy. Nosh does not monitor or record your viewing history.

---

## 4. Security

- All external network transmissions (Google Drive, Supabase, Catbox, YouTube) are encrypted using industry-standard protocols (HTTPS / TLS).
- Access tokens and credentials are kept strictly on your local device.
- Release binaries do not contain hardcoded private credentials or backdoor access.

---

## 5. Data Retention and Deletion

- You can delete local notes at any time. Deleted notes are moved to your local trash folder or permanently removed.
- Disconnecting your Google Drive account removes all cached tokens immediately.
- Shared notes can be removed from the public database by deleting or unpublishing them within the app.
- Uninstalling Nosh removes the program binaries through standard operating system controls.

---

## 6. Contact

If you have questions about this privacy policy, you can contact:
- **Email:** [noshthenotepad@gmail.com](mailto:noshthenotepad@gmail.com)
- **Repository:** [https://github.com/CGhost1908/nosh-source/issues](https://github.com/CGhost1908/nosh-source/issues)
