<div align="center">

# 📱 WhatsApp Contact Collector

**A privacy-conscious Baileys collector for resolved phone numbers from your direct WhatsApp chats.**

[Node.js](https://nodejs.org/) · [Baileys](https://github.com/WhiskeySockets/Baileys) · CommonJS · CSV export

</div>

---

## ✨ What it does

This project connects to WhatsApp Web through Baileys, waits for the initial device/history synchronization to complete, and then collects phone-number JIDs from **direct chats only**.

The app provides:

- 🌐 A polished local web dashboard
- 📷 A browser QR code for WhatsApp linking
- 📊 Live connection and history-sync status
- 📞 A deduplicated, numerically sorted CSV of resolved phone numbers
- 👤 WhatsApp-provided saved-contact names when available
- 📤 A one-time CSV self-message to the logged-in WhatsApp account
- 🔄 Ongoing live collection after the initial history pass
- 🔐 Optional token protection for the dashboard and CSV download
- 🧹 Optional automatic deletion of the Baileys auth session on disconnect

> **Important:** This is not a WhatsApp Web browser proxy. Baileys makes an outbound WhatsApp Web connection. The local HTTP server is a status/dashboard server for this application.

---

## 🎯 Collection scope

The collector intentionally includes only counterpart phone numbers from one-to-one chats.

| Source | Included? | Reason |
|---|:---:|---|
| Direct PN chat (`@s.whatsapp.net`) | ✅ | A real direct-chat phone JID |
| Direct LID chat (`@lid`) | ✅ | Resolved when WhatsApp supplies a PN mapping |
| Group chats (`@g.us`) | ❌ | Groups are outside the requested scope |
| Status/broadcast chats | ❌ | Not direct chats |
| Newsletters | ❌ | Not direct chats |
| Numbers written in message text | ❌ | Text is not parsed |
| Numbers inside contact cards | ❌ | Contact-card content is not collected |
| The logged-in account | ❌ | Prevented explicitly |

The CSV contains **resolved phone numbers only**. Unresolved WhatsApp LIDs are tracked as a count in the dashboard and terminal logs; they are never written as if they were real phone numbers.

---

## 🧭 How the workflow works

```text
Start app
   │
   ├── Start the local dashboard/status server
   │
   ├── Load or create the Baileys auth session
   │
   ├── Show the current pairing QR in the browser
   │
   ├── Wait for the initial history/bootstrap synchronization
   │      └── Buffer only identifiers and contact metadata
   │
   ├── Resolve PN/LID mappings
   │
   ├── Write the sorted CSV
   │
   ├── Send the CSV to the logged-in WhatsApp account once
   │
   └── Continue collecting live direct-chat updates
```

The app does not write a new partial CSV before the history barrier completes. A completed `RECENT` or bootstrap sync is accepted when Baileys also supplies history data. If the wait expires or no complete history payload arrives, the app enters an explicit `partial_history` state, writes available data, continues live collection, and does not send the CSV as a completed full-history export. A fresh login may be required for a guaranteed full-history pass.

---

## 🚀 Quick start

### Requirements

- Node.js **20 or newer**
- npm
- A WhatsApp account that you own or are authorized to use
- A phone with WhatsApp for scanning the QR code

### Install

```bash
cd /home/mark/Projects/whatsapp-contact-collector
npm install
```

### Start locally

```bash
cd /home/mark/Projects/whatsapp-contact-collector
npm start
```

Open the dashboard on the same computer:

```text
http://127.0.0.1:3000/
```

The QR code will appear on the dashboard when WhatsApp emits a pairing QR. The terminal no longer prints the QR by default.

To also print the QR in the terminal:

```bash
WHATSAPP_TERMINAL_QR=1 npm start
```

---

## 🌐 Web dashboard and network binding

The dashboard defaults to loopback:

```text
WHATSAPP_STATUS_HOST=127.0.0.1
WHATSAPP_STATUS_PORT=3000
```

### Run on a private network

```bash
cd /home/mark/Projects/whatsapp-contact-collector

WHATSAPP_STATUS_HOST=0.0.0.0 \
WHATSAPP_STATUS_PORT=3000 \
WHATSAPP_STATUS_TOKEN='use-a-long-random-token' \
npm start
```

Open it from another device using the server computer’s LAN address:

```text
http://SERVER_IP:3000/?token=use-a-long-random-token
```

### Routes

| Route | Purpose |
|---|---|
| `/` | HTML dashboard with summary, QR, and download button |
| `/health` | JSON runtime status |
| `/qr.png` | Current QR code as a PNG image |
| `/qr` | Alias for `/qr.png` |
| `/download` | Download the current CSV as an attachment |
| `/csv` | Alias for `/download` |

The QR is generated locally by the `qrcode` package. No external QR service is used.

### Protect the dashboard

When binding to anything other than loopback, set a token:

```bash
WHATSAPP_STATUS_TOKEN='a-long-random-secret'
```

The token protects the dashboard, health response, QR image, and CSV download. The browser dashboard automatically carries the token from the page URL to its API requests.

> **Security warning:** The CSV contains phone numbers and contact names. Do not expose the dashboard to the public internet without a firewall, private network, VPN, and a strong status token.

---

## 📊 CSV format

The generated file is:

```text
/home/mark/Projects/whatsapp-contact-collector/exports/direct-chat-phone-numbers.csv
```

Example schema:

```csv
phone_number,saved_contact,name
15550000001,true,Alice
15550000002,false,
15550000003,true,"Doe, Jane"
```

| Column | Meaning |
|---|---|
| `phone_number` | Resolved, digits-only WhatsApp phone number |
| `saved_contact` | `true` when WhatsApp supplied a saved-contact name |
| `name` | Contact name supplied by WhatsApp; CSV-escaped when necessary |

Rows are sorted numerically by `phone_number`. The writer uses an atomic temporary-file rename and restricts new files to owner-only permissions on supported systems.

### Saved-contact limitation

`saved_contact=true` means WhatsApp supplied a non-empty saved-contact name for that direct-chat identity. Baileys does not expose a perfectly reliable read-only query for the phone’s exact address book. Therefore, `false` means “no saved-contact name metadata was supplied”; it is not an absolute proof that a number is absent from the phone.

---

## 📤 Self-message delivery

After the initial history barrier completes and the CSV is flushed, the app sends the CSV once to the logged-in WhatsApp account using the account JID (`sock.user.id`).

The message is sent as a document named:

```text
direct-chat-phone-numbers.csv
```

The dashboard displays:

```text
CSV sent to self: Yes
```

The self-message is sent once per connected session. If sending fails, the error is exposed in the status response and the app attempts delivery again when a connection is available.

> The self-message contains sensitive phone numbers and names. Make sure sending it to your own account is appropriate for your privacy and security requirements.

---

## ⏱️ History wait timeout

The default maximum wait for the initial history phase is 30 seconds. You can adjust it when a large device history needs more time:

```bash
WHATSAPP_HISTORY_WAIT_TIMEOUT_MS=60000 npm start
```

If the timeout is reached, the dashboard shows `partial_history`; the app does not claim that the CSV is a complete full-history export and does not send it as the completed self-message.

---

## 🧹 Session reset and switching WhatsApp accounts

Baileys credentials and signal keys are stored in:

```text
/home/mark/Projects/whatsapp-contact-collector/auth
```

By default, when the WhatsApp socket closes, the app:

1. Deletes the entire `auth` directory.
2. Resets the history-sync barrier.
3. Resets the one-time self-message state.
4. Starts a fresh session.
5. Makes a new QR code available in the dashboard.

This behavior is enabled because it allows the app to link a different WhatsApp account without manually deleting session files.

### Keep the session on disconnect

To preserve the auth directory and allow normal reconnection to the same account:

```bash
WHATSAPP_CLEAR_AUTH_ON_DISCONNECT=0 npm start
```

> Automatic auth deletion is irreversible. Intentional shutdown with `Ctrl+C`/`SIGTERM` does not delete the session, but an actual socket close does when the default setting is enabled.

The CSV is not deleted automatically when auth is cleared. To keep separate account results, archive it before linking another account:

```bash
cd /home/mark/Projects/whatsapp-contact-collector
mv exports/direct-chat-phone-numbers.csv \
   exports/direct-chat-phone-numbers.previous.csv
```

To switch immediately without waiting for a socket disconnect, stop the process and move the auth directory aside:

```bash
mv auth "auth.backup.$(date +%Y%m%d-%H%M%S)"
npm start
```

---

## 🗂️ Project layout

```text
/home/mark/Projects/whatsapp-contact-collector/
├── src/
│   ├── index.js                    # App lifecycle, sync gate, self-message
│   ├── phone-number-collector.js   # JID resolution, metadata, CSV persistence
│   ├── history-sync-buffer.js      # Two-phase identifier-only sync buffer
│   ├── status-server.js            # Dashboard, QR, health, download routes
│   ├── jid.js                      # JID classification helpers
│   ├── timestamp.js                # Legacy timestamp helper
│   └── message-filter.js            # Legacy message-type helper
├── test/
│   └── phone-number-collector.test.js
├── auth/                           # Generated Baileys session; ignored
├── exports/                        # Generated CSV; ignored
├── package.json
└── README.md
```

Sensitive/generated directories are ignored by Git through `/home/mark/Projects/whatsapp-contact-collector/.gitignore`.

---

## 🧪 Testing

Run the automated test suite:

```bash
cd /home/mark/Projects/whatsapp-contact-collector
npm test
```

The tests use synthetic JIDs and temporary directories. They do not connect to WhatsApp and do not modify the real auth session or export.

Coverage includes:

- Direct PN collection
- Group/status/newsletter exclusion
- Message-text and contact-card exclusion
- Delayed LID resolution
- Alternate-JID resolution
- Own-account exclusion
- Saved-contact metadata and CSV escaping
- Numeric sorting and CSV migration
- Two-phase history buffering
- Dashboard, QR, download, and token routes

Optional syntax check:

```bash
for file in /home/mark/Projects/whatsapp-contact-collector/src/*.js; do
  node --check "$file" || exit 1
done
```

---

## ⚠️ History and privacy limitations

Baileys can process WhatsApp history synchronization events, but WhatsApp does not provide a supported API that guarantees every message ever associated with an account.

The following may be unavailable or incomplete:

- Deleted chats and deleted messages
- Expired or expired-media history
- History older than WhatsApp’s server-side retention
- Chats not included in the current device synchronization
- Sessions already marked as synchronized by Baileys
- Data unavailable because the primary phone is offline

The app requests a full initial synchronization and uses a bounded wait so an already-used session cannot block forever. If it cannot observe a complete history payload, it reports `partial_history` and recommends a fresh session. For a genuinely fresh device history pass, link a new session with the auth directory moved aside.

The collector does not intentionally persist message bodies, media, chat names, or message IDs. WhatsApp/Baileys may still provide message data to the connected process in memory as part of normal protocol handling.

Use this tool only for accounts and data you are authorized to access. Follow WhatsApp’s terms, applicable privacy laws, and any consent requirements in your jurisdiction. Do not use collected contact data for unsolicited messaging.

---

## 🛠️ Troubleshooting

### The page says `starting`

The HTTP dashboard starts before the WhatsApp socket finishes connecting. Wait for the terminal to report a successful connection, then refresh `/health`.

### The QR code is not visible

- Open `/`, not just `/health`.
- Confirm the app process is still running.
- Look for `A new WhatsApp QR code is available in the web dashboard.`
- If the QR is displayed but stale, refresh the page.
- Set `WHATSAPP_TERMINAL_QR=1` as a terminal fallback.

### The port is already in use

Choose another port:

```bash
WHATSAPP_STATUS_PORT=3010 npm start
```

### The history status never completes

The app should enter `partial_history` after the wait timeout. If you need a guaranteed full-history pass, move the auth directory aside and perform a fresh QR login:

```bash
cd /home/mark/Projects/whatsapp-contact-collector
mv auth "auth.backup.$(date +%Y%m%d-%H%M%S)"
npm start
```

### The CSV self-message was not sent

Check `lastError` in:

```text
http://127.0.0.1:3000/health
```

Also verify that the account JID is available, the CSV exists, and WhatsApp permits sending a document to your own account.

### The CSV contains old numbers after switching accounts

Auth deletion does not delete the CSV. Move the old export aside before collecting the new account if you need separate results.

---

## 📄 License

This project is provided under the ISC license.

## 🙏 Acknowledgements

- [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys) for the WhatsApp Web protocol implementation
- [qrcode](https://github.com/soldair/node-qrcode) for browser-compatible QR images
- [qrcode-terminal](https://github.com/patrik-heuer/qrcode-terminal) for optional terminal QR output
