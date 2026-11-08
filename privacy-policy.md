# Nosh Privacy Policy

**Effective Date:** November 8, 2026  
**Application:** Nosh Desktop (Code & Note Editor)  
**Publisher / Maintainers:** CGhost1908 and Nosh Contributors  
**License:** [MIT License](LICENSE)  
**Repository:** [https://github.com/CGhost1908/nosh-source](https://github.com/CGhost1908/nosh-source)

---

## Overview

Nosh is a desktop notepad and code organizer built on a local-first architecture. Notes, files, and settings are stored locally on your device by default. Nosh does not run background telemetry or usage analytics. Network connections are initiated only when you explicitly invoke features that interact with external services, such as cloud backup, public note sharing, cross-device synchronization, or embedded media playback.

---

## 1. Local Data Storage and Synchronization

All notes (saved as `.nsh` files), folder structures, snapshots, and application settings are stored primarily on your local file system.

- **Local-First Architecture:** Your local device remains the primary storage of your data. You can copy, backup, move, or delete your note files directly through your operating system file manager at any time.
- **Synchronization vs. Public Sharing:** Unencrypted notes are never sent to remote servers unless you explicitly choose to publish an individual note to the web. Notes synchronized across your devices are encrypted on your local device before transmission so that the relay server cannot inspect their content.
- **No Mandatory Account:** You do not need to register an account or provide personal information to use the application.

---

## 2. No Telemetry or Usage Analytics

- Nosh does not include telemetry frameworks, user tracking services, or analytics packages (such as Google Analytics, PostHog, or Mixpanel).
- Nosh does not collect crash logs, hardware fingerprints, session durations, or statistics about what you write.

---

## 3. Network Connections and Third-Party Services

Nosh establishes internet connections only when you explicitly trigger features that require remote communication:

### 3.1 Google Drive Integration (Optional)

If you connect Google Drive to back up or sync your notes:
- **Scope of Access:** Nosh requests access strictly to files and folders it creates or opens within the dedicated `noshTheNotepad` folder (`https://www.googleapis.com/auth/drive.file`), and read-only access to your email address (`https://www.googleapis.com/auth/userinfo.email`) solely to display the active connected account in settings. Nosh cannot view or modify other files in your Google Drive.
- **Token Storage:** OAuth authentication tokens are stored exclusively on your local computer and are never sent to third parties or Nosh maintainers.
- **Disconnection:** You can disconnect Google Drive at any time in Settings. Disconnecting immediately removes all stored OAuth tokens from your local device and terminates API access.
- **Google Limited Use Compliance:** Nosh adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including Limited Use requirements:
  - Google user data is not transferred to third parties (except as required to perform Google Drive file operations).
  - Google user data is never used for serving advertisements.
  - Google user data is never used for training generalized artificial intelligence (AI) or machine learning (ML) models.

### 3.2 Public Note Sharing (Supabase)

If you use the feature to publish a note to the web:
- Only the specific note you explicitly choose to publish is transmitted over HTTPS to our Supabase database instance (`buvtdaxlibejpjlkxaor.supabase.co`) in readable format.
- Notes you do not choose to publish are never exposed publicly or stored as readable plaintext on remote servers.
- Anyone possessing the generated share link can view the contents of the published note via the public web viewer (`view.html`). Do not publish notes containing passwords, private credentials, or sensitive personal information.

### 3.3 Public Media Hosting for Shared Notes (Catbox.moe)

When you publish a note that contains locally embedded images or video files, external web browsers cannot access files stored on your local hard drive. In this scenario:
- **Third-Party Data Transfer:** Embedded media assets attached to that specific note are uploaded via HTTPS to [Catbox.moe](https://catbox.moe) so that viewers of your shared link can view the images.
- **Third-Party Terms and Retention:** Catbox.moe is an independent third-party file hosting service. Uploaded media files are subject to [Catbox Terms of Service](https://catbox.moe/faq.php) and privacy practices. Uploaded files are publicly accessible to anyone with the direct file link and are retained according to Catbox's hosting policies (which generally store files indefinitely unless removed for policy violations).
- **Deletion Limitations:** Nosh does not possess an automated deletion API or deletion token mechanism for Catbox.moe. Removing or editing a shared note in Nosh does not automatically purge previously uploaded media files from Catbox servers. If you require manual deletion of media from Catbox, you must contact Catbox administration directly or refrain from publishing notes that contain sensitive media.

### 3.4 Cross-Device Synchronization (Supabase)

To keep your notes seamlessly synchronized across desktop and mobile devices, Nosh uses a synchronization relay hosted on Supabase:
- **Client-Side Encryption (E2EE):** Unlike publicly shared notes, all notes synchronized across devices are encrypted directly on your local device before transmission using client-side symmetric stream encryption and keyed message authentication (MAC).
- **Zero Plaintext on Server:** The synchronization relay receives and stores only encrypted ciphertext blobs and pseudonymous row identifiers. Decryption keys are derived locally on your devices from a 64-character AuthToken generated via `window.crypto.getRandomValues`. The server and third parties have no ability to read, index, or view your note titles or content.
- **Pairing and Credential Exchange:** Device pairing is conducted by scanning an encrypted QR code containing an ephemeral transfer key. This optical exchange is designed for devices in close physical proximity to prevent remote network interception. Users are responsible for shielding their screen from unauthorized cameras during pairing.
- **Metadata Visibility:** Because row identifiers and timestamps are necessary to synchronize updates between devices, the relay server processes metadata such as update timestamps, payload byte sizes, and encrypted update frequencies, while plain text note contents remain encrypted.

### 3.5 Embedded Content (YouTube Companion Player)

When you embed or play a YouTube video in Nosh, requests are made directly to YouTube/Google servers (via YouTube IFrame and oEmbed APIs) to display and play the media. These requests are governed by the [Google Privacy Policy](https://policies.google.com/privacy). Nosh does not capture, store, or monitor your video playback history.

---

## 4. Data Retention, Logs, and Deletion Lifecycle

Data retention across different components is governed as follows:

- **Local Storage:** Local notes, history snapshots (`.history/`), and settings remain on your computer until you delete them. Deleting a note in Nosh moves it to your local trash folder or deletes the file. Uninstalling the application removes the program binaries through standard operating system controls.
- **Google Drive:** Backed-up note files remain in your personal `noshTheNotepad` folder until you manually delete them from Google Drive or through Nosh. Disconnecting your account purges all local authentication tokens immediately.
- **Supabase Database and Backups:**
  - Publicly shared notes remain accessible via their public link until updated or removed.
  - Synchronized notes are stored as encrypted blobs under your pseudonymous vault ID. Modifying or deleting a note locally propagates the encrypted update or deletion to the sync relay.
  - Supabase maintains automated database backups for disaster recovery. Backups retain database snapshots according to Supabase's operational retention schedule (typically up to 30 days) before being overwritten.
  - Standard HTTP connection logs (including IP addresses and request timestamps) are collected by Supabase infrastructure for network security, DDoS protection, and diagnostic purposes, retained according to Supabase operational policies (typically 7 to 30 days).
- **Catbox.moe Media:** Media files uploaded to Catbox.moe during note publishing are hosted independently under Catbox's retention policies and are not automatically deleted upon unpublishing a note.

---

## 5. Security Measures

- **Transport Encryption:** All external network communication (Google Drive API, Supabase, Catbox, YouTube) strictly enforces HTTPS / TLS 1.2+ encryption.
- **Local Access Control:** Local application data and stored tokens reside in your operating system user directory, subject to standard operating system access controls.
- **No Hardcoded Secrets:** Official release binaries contain no hardcoded private credentials or backdoor access channels.

---

## 6. Data Protection and Regulatory Considerations (GDPR, CCPA, KVKK)

Nosh does not operate a commercial user-tracking business model. However, because certain optional features involve the transmission of data:

- **Data Roles:** For local note editing, you act as the sole custodian of your data. When utilizing optional online features, Nosh acts as client software connecting you to independent third-party service providers (Google LLC, Supabase Inc., Catbox.moe).
- **Personal Data Processed:**
  - Google account email address is received with user consent via OAuth to identify the active connected account in settings.
  - IP addresses and technical request headers are received by third-party servers (Google, Supabase, Catbox, YouTube) as part of standard TCP/IP network transport and security logging.
  - User-authored note content may contain personal data if you voluntarily choose to include personal information and publish or sync it.
- **Legal Basis (GDPR Art. 6(1)(a) / 6(1)(b)):** Processing of data through online features occurs exclusively upon voluntary, explicit user initiation to deliver requested services (backup, sharing, sync).
- **User Rights:** You have the right to access, export, modify, and delete your local data at any time. For third-party services, you may revoke Google permissions via your Google Account Security settings, disconnect cloud providers in Nosh Settings, or contact project maintainers for assistance regarding shared database records.

---

## 7. Open Source and License

Nosh is free and open-source software distributed under the terms of the **MIT License**. The complete source code is publicly auditable:
- Source Code Repository: [https://github.com/CGhost1908/nosh-source](https://github.com/CGhost1908/nosh-source)
- Distribution Repository: [https://github.com/CGhost1908/nosh](https://github.com/CGhost1908/nosh)

---

## 8. Contact

If you have questions, concerns, or requests regarding this Privacy Policy, please contact:
- **Email:** [noshthenotepad@gmail.com](mailto:noshthenotepad@gmail.com)
- **GitHub Issues:** [https://github.com/CGhost1908/nosh-source/issues](https://github.com/CGhost1908/nosh-source/issues)
- **Maintainer:** CGhost1908
