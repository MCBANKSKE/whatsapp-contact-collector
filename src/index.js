const fs = require('node:fs');
const path = require('node:path');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    useMultiFileAuthState,
    DisconnectReason,
    proto,
} = require('@whiskeysockets/baileys');

const P = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const { PhoneNumberCollector } = require('./phone-number-collector');
const { HistorySyncBuffer } = require('./history-sync-buffer');
const { createStatusServer } = require('./status-server');

const rootDirectory = path.resolve(__dirname, '..');
const authDirectory = path.join(rootDirectory, 'auth');
const outputPath = path.join(
    rootDirectory,
    'exports',
    'direct-chat-phone-numbers.csv',
);
const logger = P({ level: 'silent' });
const collector = new PhoneNumberCollector(outputPath);
let historyBuffer = new HistorySyncBuffer(
    proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP,
);
const statusHost = process.env.WHATSAPP_STATUS_HOST || '127.0.0.1';
const statusPort = Number(process.env.WHATSAPP_STATUS_PORT || 3000);
const showTerminalQr = process.env.WHATSAPP_TERMINAL_QR === '1';
const clearAuthOnDisconnect =
    process.env.WHATSAPP_CLEAR_AUTH_ON_DISCONNECT !== '0';
const configuredHistoryWaitTimeout = Number(
    process.env.WHATSAPP_HISTORY_WAIT_TIMEOUT_MS || 30000,
);
const historyWaitTimeoutMs = Number.isFinite(configuredHistoryWaitTimeout)
    && configuredHistoryWaitTimeout > 0
    ? configuredHistoryWaitTimeout
    : 30000;
const runtimeStatus = {
    state: 'starting',
    connected: false,
    historySyncComplete: false,
    resolvedPhoneNumbers: 0,
    unresolvedLids: 0,
    selfMessageSent: false,
    lastError: null,
    updatedAt: new Date().toISOString(),
};

let activeSocket = null;
let statusServer = null;
let currentQr = null;
let reconnectTimer = null;
let shuttingDown = false;
let selfMessageSent = false;
let selfMessageInFlight = false;
let completionInProgress = false;
let pairingCodePending = false;
let historyFallbackTimer = null;

function updateRuntimeStatus(patch = {}) {
    Object.assign(runtimeStatus, patch, {
        updatedAt: new Date().toISOString(),
    });
}

function getRuntimeStatus() {
    return {
        ...runtimeStatus,
        qrAvailable: Boolean(currentQr),
        pairingCodePending,
        csvReady: fs.existsSync(outputPath),
    };
}

function updateCollectionStatus() {
    const { resolved, pendingLids } = collector.getStats();

    updateRuntimeStatus({
        resolvedPhoneNumbers: resolved,
        unresolvedLids: pendingLids,
    });
}

function formatStatusHost(host) {
    return host.includes(':') && !host.startsWith('[')
        ? `[${host}]`
        : host;
}

function normalizePairingPhoneNumber(value) {
    const phoneNumber = String(value || '').replace(/\D/g, '');

    if (!/^\d{7,15}$/.test(phoneNumber)) {
        throw new Error('Enter a full international phone number including country code.');
    }

    return phoneNumber;
}

async function requestPhonePairingCode(value) {
    if (!activeSocket || typeof activeSocket.requestPairingCode !== 'function') {
        throw new Error('WhatsApp socket is not ready yet. Wait for the QR or connection to start.');
    }

    if (activeSocket.authState?.creds?.registered) {
        throw new Error('Phone pairing is only available for a new, unregistered session.');
    }

    const phoneNumber = normalizePairingPhoneNumber(value);
    pairingCodePending = true;

    try {
        const code = await activeSocket.requestPairingCode(phoneNumber);
        updateRuntimeStatus({ lastError: null, state: 'waiting_for_pairing_code' });
        console.log('Phone-number pairing code requested through the web dashboard.');
        return code;
    } catch (error) {
        pairingCodePending = false;
        throw error;
    }
}

async function startStatusServer() {
    if (statusServer) {
        return;
    }

    try {
        statusServer = createStatusServer({
            host: statusHost,
            port: statusPort,
            getStatus: getRuntimeStatus,
            getQrData: () => currentQr,
            getCsvPath: () => outputPath,
            requestPairingCode: requestPhonePairingCode,
        });
        const address = await statusServer.start();
        const endpoint = `http://${formatStatusHost(statusHost)}:${address.port}`;

        updateRuntimeStatus({ webEndpoint: endpoint });
        console.log(`Status server listening at ${endpoint}`);

        if (statusHost === '0.0.0.0' || statusHost === '::') {
            console.warn(
                'The status server is listening on all interfaces; '
                + 'keep it behind a firewall or private network.',
            );
        }
    } catch (error) {
        updateRuntimeStatus({ lastError: error.message });
        console.error('Could not start the status server:', error.message);
    }
}

function flushCollector() {
    if (!historyBuffer.isReady()) {
        return false;
    }

    try {
        collector.flush();
        updateCollectionStatus();
        return true;
    } catch (error) {
        updateRuntimeStatus({ lastError: error.message });
        console.error('Could not write the phone-number CSV:', error.message);
        return false;
    }
}

function applyPendingHistory() {
    const pending = historyBuffer.takePending();

    if (!pending) {
        return;
    }

    collector.observeLidMappings(pending.lidMappings);
    collector.observeContacts(pending.contacts);
    collector.observeChats(pending.chats);
    collector.observeMessages(pending.messages);
}

function getSelfJid(sock) {
    if (sock.user?.id) {
        return sock.user.id;
    }

    const phoneNumber = sock.user?.phoneNumber
        ? String(sock.user.phoneNumber).replace(/\D/g, '')
        : '';

    return phoneNumber ? `${phoneNumber}@s.whatsapp.net` : null;
}

async function sendCsvToSelf(sock) {
    if (selfMessageSent || selfMessageInFlight) {
        return;
    }

    const selfJid = getSelfJid(sock);

    if (!selfJid) {
        updateRuntimeStatus({ lastError: 'Logged-in account JID is not available yet' });
        console.warn('CSV self-message deferred: logged-in account JID is not available yet.');
        return;
    }

    if (!fs.existsSync(outputPath)) {
        updateRuntimeStatus({ lastError: 'CSV file does not exist' });
        console.warn('CSV self-message deferred: output file does not exist.');
        return;
    }

    selfMessageInFlight = true;

    try {
        await sock.sendMessage(selfJid, {
            document: fs.readFileSync(outputPath),
            mimetype: 'text/csv',
            fileName: path.basename(outputPath),
            caption: 'Direct-chat phone-number collection completed after full history sync.',
        });
        selfMessageSent = true;
        updateRuntimeStatus({ selfMessageSent: true, lastError: null });
        console.log('Completed CSV sent to your own WhatsApp chat.');
    } catch (error) {
        updateRuntimeStatus({ lastError: error.message });
        console.error('Could not send the completed CSV to yourself:', error.message);
    } finally {
        selfMessageInFlight = false;
    }
}

async function completeHistorySync(sock, reason = 'complete') {
    if (!historyBuffer.isReady() || completionInProgress) {
        return;
    }

    clearHistoryFallback();
    const hasHistoryData = historyBuffer.hasBufferedData();
    const isFullHistoryComplete = reason === 'complete' && hasHistoryData;
    completionInProgress = true;

    try {
        collector.setAccount(sock.user);
        applyPendingHistory();

        if (!flushCollector()) {
            return;
        }

        updateRuntimeStatus({
            historySyncComplete: isFullHistoryComplete,
            state: isFullHistoryComplete ? 'collecting' : 'partial_history',
        });

        if (isFullHistoryComplete) {
            console.log(
                'History synchronization complete. '
                + 'Phone-number extraction is now enabled.',
            );
            printCollectionStats('Current collection');
            await sendCsvToSelf(sock);
        } else {
            console.warn(
                'History synchronization ended without a complete full-history '
                + 'payload. Live collection is enabled, but the CSV was not '
                + 'sent as a completed full-history export.',
            );
            printCollectionStats('Available collection');
        }
    } catch (error) {
        updateRuntimeStatus({ lastError: error.message });
        console.error('Could not finish history processing:', error.message);
    } finally {
        completionInProgress = false;
    }
}

function clearHistoryFallback() {
    if (historyFallbackTimer) {
        clearTimeout(historyFallbackTimer);
        historyFallbackTimer = null;
    }
}

function scheduleHistoryFallback(sock, delay = historyWaitTimeoutMs) {
    if (historyBuffer.isReady() || historyFallbackTimer) {
        return;
    }

    historyFallbackTimer = setTimeout(() => {
        historyFallbackTimer = null;

        if (!historyBuffer.isReady()) {
            historyBuffer.forceReady();
            console.warn(
                'History wait timed out; continuing with available data only. '
                + 'Use a fresh login for a guaranteed full-history pass.',
            );
            void completeHistorySync(sock, 'fallback');
        }
    }, delay);
    historyFallbackTimer.unref?.();
}

function resetSessionState() {
    clearHistoryFallback();
    historyBuffer = new HistorySyncBuffer(
        proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP,
    );
    currentQr = null;
    selfMessageSent = false;
    selfMessageInFlight = false;
    completionInProgress = false;
    pairingCodePending = false;
    updateRuntimeStatus({
        state: 'awaiting_qr',
        connected: false,
        historySyncComplete: false,
        selfMessageSent: false,
        lastError: null,
    });
    updateCollectionStatus();
}

function clearAuthSession() {
    if (!clearAuthOnDisconnect) {
        console.warn(
            'Automatic auth cleanup is disabled; the existing session '
            + 'will be reused on reconnect.',
        );
        return false;
    }

    try {
        fs.rmSync(authDirectory, { force: true, recursive: true });
        resetSessionState();
        console.warn(
            'WhatsApp disconnected; all session files were deleted. '
            + 'A fresh QR login will be created.',
        );
        return true;
    } catch (error) {
        updateRuntimeStatus({ lastError: error.message });
        console.error('Could not delete WhatsApp session files:', error.message);
        return false;
    }
}

function scheduleReconnect() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
    }

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startWhatsApp().catch(handleFatalError);
    }, 60000);
}

function prepareHistorySync(state) {
    if (historyBuffer.isReady() || !state.creds) {
        return;
    }

    if ((state.creds.accountSyncCounter || 0) > 0) {
        state.creds.accountSyncCounter = 0;
        console.warn(
            'The saved session was already synced; Baileys will wait '
            + 'for a history notification again for this connection '
            + '(the auth files are not deleted).',
        );
    }
}

function printCollectionStats(label) {
    const { resolved, pendingLids } = collector.getStats();

    console.log(
        `${label}: ${resolved} resolved direct-chat phone number(s), `
        + `${pendingLids} unresolved LID(s).`,
    );
}

function registerCollectorEvents(sock) {
    sock.ev.on('messaging-history.set', (event) => {
        if (historyBuffer.isReady()) {
            collector.observeHistorySet(event);
            flushCollector();
            return;
        }

        historyBuffer.queueHistorySet(event);

        if (historyBuffer.isReady()) {
            void completeHistorySync(sock);
        }
    });

    sock.ev.on('messaging-history.status', ({ syncType, status }) => {
        if (status === 'paused' && !historyBuffer.isReady()) {
            updateRuntimeStatus({ state: 'waiting_for_history' });
            console.warn(
                'History sync paused; waiting for a complete sync before '
                + 'extracting phone numbers.',
            );
        }

        if (
            status === 'complete'
            && historyBuffer.markStatus(syncType, status)
        ) {
            void completeHistorySync(sock);
        }

        console.log(`History sync status: ${status} (sync type: ${syncType}).`);
    });

    sock.ev.on('chats.upsert', (chats) => {
        if (historyBuffer.isReady()) {
            collector.observeChats(chats);
            flushCollector();
        } else {
            historyBuffer.queueChats(chats);
        }
    });

    sock.ev.on('messages.upsert', ({ messages }) => {
        if (historyBuffer.isReady()) {
            collector.observeMessages(messages);
            flushCollector();
        } else {
            historyBuffer.queueMessages(messages);
        }
    });

    sock.ev.on('contacts.upsert', (contacts) => {
        if (historyBuffer.isReady()) {
            collector.observeContacts(contacts);
            flushCollector();
        } else {
            historyBuffer.queueContacts(contacts);
        }
    });

    sock.ev.on('lid-mapping.update', (mapping) => {
        if (historyBuffer.isReady()) {
            collector.observeLidMappings([mapping]);
            flushCollector();
        } else {
            historyBuffer.queueLidMappings([mapping]);
        }
    });
}

async function startWhatsApp() {
    if (shuttingDown) {
        return;
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDirectory);

    if (shuttingDown) {
        return;
    }

    prepareHistorySync(state);

    const sock = makeWASocket({
        auth: state,
        logger,
        printQRInTerminal: false,
        syncFullHistory: true,
        shouldSyncHistoryMessage: () => true,
    });

    activeSocket = sock;
    sock.ev.on('creds.update', async (update) => {
        try {
            await saveCreds();
        } catch (error) {
            console.error('Could not save WhatsApp credentials:', error.message);
        }

        if (
            !historyBuffer.isReady()
            && (update.accountSyncCounter || 0) > 0
        ) {
            clearHistoryFallback();
            scheduleHistoryFallback(sock, 1000);
        }
    });
    registerCollectorEvents(sock);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQr = qr;
            updateRuntimeStatus({ state: 'waiting_for_qr' });

            if (showTerminalQr) {
                console.log('\nScan this QR code with WhatsApp:\n');
                qrcodeTerminal.generate(qr, { small: true });
            } else {
                console.log('A new WhatsApp QR code is available in the web dashboard.');
            }
        }

        if (connection === 'open') {
            currentQr = null;
            if (sock.authState?.creds?.registered) {
                pairingCodePending = false;
            }
            collector.setAccount(sock.user);
            updateRuntimeStatus({
                connected: true,
                state: historyBuffer.isReady() ? 'collecting' : 'waiting_for_history',
            });

            console.log('\n=================================');
            console.log(' WhatsApp connected successfully');
            console.log('=================================\n');

            scheduleHistoryFallback(sock);

            if (historyBuffer.isReady()) {
                flushCollector();
                printCollectionStats('Current collection');

                if (runtimeStatus.historySyncComplete) {
                    void sendCsvToSelf(sock);
                }
            } else {
                console.log(
                    'Waiting for initial device chat synchronization before '
                    + 'extracting phone numbers...',
                );
            }
        }

        if (connection !== 'close') {
            return;
        }

        currentQr = null;
        clearHistoryFallback();
        updateRuntimeStatus({ connected: false, state: 'reconnecting' });
        flushCollector();

        if (shuttingDown) {
            return;
        }

        if (pairingCodePending) {
            updateRuntimeStatus({ state: 'waiting_for_pairing_code' });
            console.log(
                'Phone pairing is in progress; preserving the session and '
                + 'reconnecting in 60 seconds.',
            );
            scheduleReconnect();
            return;
        }

        if (clearAuthSession()) {
            console.log('Starting a fresh WhatsApp session in 60 seconds.');
            scheduleReconnect();
            return;
        }

        const statusCode = lastDisconnect?.error?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
            updateRuntimeStatus({ connected: false, state: 'logged_out' });
            console.log('\nWhatsApp session logged out.');

            if (historyBuffer.isReady()) {
                printCollectionStats('Final collection');
            } else {
                console.warn(
                    'Initial history synchronization did not complete; '
                    + 'no new phone-number CSV was written.',
                );
            }

            return;
        }

        console.log('\nWhatsApp connection closed. Reconnecting in 60 seconds.');
        scheduleReconnect();
    });

    collector.setAccount(sock.user);
    flushCollector();
}

function handleFatalError(error) {
    updateRuntimeStatus({ state: 'error', lastError: error.message });
    console.error('Fatal error:', error);
    flushCollector();
}

async function shutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    pairingCodePending = false;
    updateRuntimeStatus({ connected: false, state: 'stopped' });

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    clearHistoryFallback();
    flushCollector();

    try {
        await activeSocket?.end();
    } catch (error) {
        console.error('Error while closing WhatsApp connection:', error.message);
    }

    await statusServer?.stop();

    console.log(`\n${signal}: collection stopped.`);

    if (historyBuffer.isReady()) {
        printCollectionStats('Final collection');
    } else {
        console.warn(
            'Initial history synchronization did not complete; '
            + 'no new phone-number CSV was written.',
        );
    }
}

function registerShutdownHandlers() {
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            void shutdown(signal);
        });
    }
}

if (require.main === module) {
    registerShutdownHandlers();
    void startStatusServer();
    startWhatsApp().catch(handleFatalError);
}

module.exports = {
    startWhatsApp,
};
