# 📝 Nosh Privacy Policy

**Effective Date:** November 8, 2026  
**Application:** Nosh Desktop (Code & Note Editor)  
**Publisher / Maintainers:** CGhost1908 and Nosh Contributors  
**License:** [MIT License](LICENSE)  
**Repository:** [https://github.com/CGhost1908/nosh-source](https://github.com/CGhost1908/nosh-source)

---

## 🛡️ Fundamental Privacy & Security Commitment

> **&ldquo;This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.&rdquo;**

By default, Nosh operates **100% offline on your local computer**. There is no mandatory user registration, no remote telemetry, no background analytics, and no advertising. Your notes and files belong solely to you.

---

## 1. Architectural Principle: Local-First

All your notes (saved as standard `.nsh` files), organizational folders, tags, version history snapshots, and editor settings are written directly to your local file system (by default inside your operating system's local application data directory or a custom directory chosen by you).

- **No Central Nosh Server:** There is no proprietary cloud server operated by Nosh that silently syncs your notes.
- **No User Account:** You can download, install, and use Nosh indefinitely without providing an email address, name, or personal details.
- **Full Data Portability:** You can inspect, copy, backup, or delete your note files directly using your operating system's file manager at any time.

---

## 2. What We Do NOT Collect

- **🚫 Zero Telemetry & Analytics:** Nosh does **not** contain telemetry libraries, analytics tracking suites (such as Google Analytics, PostHog, or Mixpanel), advertising SDKs, remote crash reporters (such as Sentry), or hardware fingerprinting mechanisms.
- **🚫 Zero User Profiling:** We do not monitor which features you use, what notes you write, or how long your editor sessions last.

---

## 3. Network Communications & Optional External Features

Nosh connects to the internet **only** when you explicitly invoke an optional feature that intrinsically requires network connectivity.

### Summary of Network Endpoints

| Feature | External Endpoint | Trigger Action | Data Transmitted | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Google Drive Sync** | `googleapis.com` | User clicks "Connect Google Drive" & approves OAuth | OAuth token, note files for cloud backup (`noshTheNotepad`) | *Strictly Opt-In* |
| **Public Note Sharing** | `buvtdaxlibejpjlkxaor.supabase.co` | User clicks "Publish" / "Share" on a specific note | Rendered text / HTML of the published note | *Strictly Opt-In* |
| **Shared Media Hosting** | `catbox.moe` | User publishes a note containing local images/videos | Only the media files attached to the shared note | *Strictly Opt-In* |
| **E2EE Vault / Mobile Sync** | `buvtdaxlibejpjlkxaor.supabase.co` | User connects sync via secret AuthToken / QR code | Client-side encrypted ciphertext blobs (Zero-Knowledge) | *Strictly Opt-In* |
| **YouTube Companion** | `youtube.com` / `i.ytimg.com` | User embeds or plays a YouTube video link | Standard YouTube iframe & oEmbed API requests | *Strictly Opt-In* |
| **KaTeX Math Engine** | `cdnjs.cloudflare.com` | User previews mathematical formulas | Static CSS stylesheet retrieval over HTTPS | *Static Asset* |

---

### 3.1 Google Drive Integration & Limited Use Disclosure

If you choose to use the optional Google Drive synchronization feature:

- **OAuth Scopes:** Nosh requests authorization exclusively for:
  - `https://www.googleapis.com/auth/drive.file` — Permits Nosh to create, view, and modify *only* files and folders that were opened or created with Nosh inside the dedicated `noshTheNotepad` folder. Nosh has zero access to your other personal Drive files, folders, photos, or documents.
  - `https://www.googleapis.com/auth/userinfo.email` — Read-only permission strictly used to display your connected account email in the app's settings window so you can identify which Google account is active.
- **Local Token Storage:** Authentication tokens are stored exclusively on your local device. Tokens are never transmitted to Nosh maintainers, proxies, or third parties.
- **Account Disconnection:** You can disconnect your Google account at any time in Settings. Disconnecting immediately removes all stored OAuth tokens from your local machine and terminates all API sessions.
- **Google API Services User Data Policy Compliance:** Nosh's use and transfer to any other app of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements:
  - Google user data is never transferred to third parties (except as required to provide note synchronization).
  - Google user data is never used for serving advertisements.
  - Google user data is never used for training generalized artificial intelligence (AI) or machine learning (ML) models.

### 3.2 Public Note Sharing via Supabase

- **Explicit Action Only:** Uploading occurs *only* when you explicitly open the Share dialog and click &ldquo;Publish&rdquo;.
- **Isolated Scope:** Only the specific note you chose to publish is uploaded to our Supabase database instance. All other notes in your library remain strictly on your local disk.
- **Public Availability:** Any person possessing the unique share link will be able to view the contents of the published note via the web viewer (`view.html`). Do not publish notes containing passwords, secrets, or confidential personal information.
- **Unpublishing / Deletion:** You can unpublish or delete a shared note at any time via the editor interface, which immediately purges the record from the Supabase database.

### 3.3 Public Media Hosting via Catbox.moe

When you publish a note that contains locally embedded images or video files, external web browsers cannot access your local hard drive. In this event, Nosh uploads only the embedded media assets to the public media host [Catbox.moe](https://catbox.moe) via HTTPS so that viewers of your shared link can view the images. This occurs solely as part of the explicit note publishing process.

### 3.4 End-to-End Encrypted (E2EE) Vault Sync

- **Client-Side Encryption:** All notes are encrypted on your local device using high-grade 256-bit symmetric encryption before being transmitted over WebSockets / HTTPS to Supabase.
- **Zero Knowledge:** The relay database receives only encrypted ciphertext blobs, deterministic blind IDs, and message authentication codes (MACs). Decryption keys are derived locally from your private AuthToken and ephemeral QR exchange keys.
- **Server Blindness:** Neither Nosh maintainers nor Supabase have the cryptographic keys necessary to decrypt or inspect the contents of your synchronized notes.

### 3.5 Embedded Content & Third-Party Services

- **YouTube Companion Player:** When you embed a YouTube URL, Nosh interacts with the official YouTube IFrame and oEmbed APIs to render the player. Your interactions with the YouTube player are subject to the [Google Privacy Policy](https://policies.google.com/privacy). Nosh does not monitor, log, or track your viewing habits.
- **Mathematical Typesetting (KaTeX):** KaTeX styling is retrieved over secure HTTPS from Cloudflare's cdnjs CDN. No personal user information is transmitted during this static stylesheet request.

---

## 4. Data Storage and Security

- **Transport Layer Security:** All external network communication (Google Drive API, Supabase, Catbox, YouTube) strictly enforces modern encryption protocols (HTTPS/TLS 1.2 or TLS 1.3 and WSS).
- **Local Security:** Note data and tokens reside in your operating system's user profile. Access is governed by standard operating system user account access control.
- **No Bundled Secrets:** Release binaries contain no secret backdoor credentials or proprietary surveillance code.

---

## 5. User Control, Data Retention & Deletion

- **Full Retention Control:** Because your notes are saved on your local drive, you retain absolute ownership. You decide how long files are kept.
- **Trash and History:** Deleted notes are moved to your local trash folder within the Nosh workspace, allowing manual permanent deletion or restoration. Version history snapshots are stored strictly locally and can be cleared at will.
- **Application Uninstallation:** Nosh can be uninstalled at any time using standard operating system controls (e.g., Windows *Settings > Apps > Installed apps*). Uninstallation cleanly removes the program binaries without automatically deleting your local note text files, ensuring you never inadvertently lose your personal work.

---

## 6. Code Signing and Software Integrity

To protect our users against tampering, unauthorized modifications, and malware injection:
- Official Windows binaries of Nosh are built directly from this public repository using automated GitHub Actions release workflows.
- Free code signing is provided by [SignPath.io](https://about.signpath.io), with digital certificates issued by the [SignPath Foundation](https://signpath.org).
- This digital signature guarantees that the executable you install on your machine was created directly from the authentic open-source code and has not been altered by third parties.

---

## 7. Regulatory & Global Compliance (GDPR, CCPA, COPPA)

Because Nosh adopts a strict local-first philosophy and does not collect, sell, or commercialize personal data, Nosh inherently complies with international privacy regulations including the General Data Protection Regulation (GDPR, Regulation (EU) 2016/679), the California Consumer Privacy Act (CCPA), and the Children's Online Privacy Protection Act (COPPA). We do not knowingly collect information from children or any individuals.

---

## 8. Open Source & Auditability

Nosh is free and open-source software distributed under the terms of the **MIT License**. Our complete source code, build scripts, and CI/CD pipelines are fully auditable by the public:
- Source Code: [https://github.com/CGhost1908/nosh-source](https://github.com/CGhost1908/nosh-source)
- Public Distribution: [https://github.com/CGhost1908/nosh](https://github.com/CGhost1908/nosh)

---

## 9. Contact Us

If you have any questions, concerns, or requests regarding this Privacy Policy, please contact the maintainer:
- **Email:** [noshthenotepad@gmail.com](mailto:noshthenotepad@gmail.com)
- **GitHub Issues:** [https://github.com/CGhost1908/nosh-source/issues](https://github.com/CGhost1908/nosh-source/issues)
- **Maintainer:** CGhost1908
