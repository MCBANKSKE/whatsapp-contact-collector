const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    PhoneNumberCollector,
} = require('../src/phone-number-collector');
const { HistorySyncBuffer } = require('../src/history-sync-buffer');
const { createStatusServer } = require('../src/status-server');

function createCollector(t) {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'whatsapp-phone-collector-'),
    );
    const outputPath = path.join(directory, 'phone-numbers.csv');
    const collector = new PhoneNumberCollector(outputPath);

    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    return { collector, outputPath };
}

test('collects only direct chats and ignores message text', (t) => {
    const { collector, outputPath } = createCollector(t);

    collector.observeChats([
        { id: '15550000001@s.whatsapp.net' },
        { id: '120363000000000000@g.us' },
        { id: 'status@broadcast' },
        { id: '120363000000000001@newsletter' },
    ]);
    collector.observeMessages([
        {
            key: {
                remoteJid: '15550000002@s.whatsapp.net',
            },
            message: {
                conversation: 'Call 15550009999 for this number',
                contactMessage: { vcard: '15550008888' },
            },
        },
    ]);

    collector.flush();

    assert.deepEqual(collector.getPhoneNumbers(), [
        '15550000001',
        '15550000002',
    ]);
    assert.equal(
        fs.readFileSync(outputPath, 'utf8'),
        'phone_number,saved_contact,name\n15550000001,false,\n15550000002,false,\n',
    );
});

test('marks saved contacts and escapes contact names in CSV', (t) => {
    const { collector, outputPath } = createCollector(t);
    const phoneNumber = '15550000021';

    collector.observeContacts([
        { id: `${phoneNumber}@s.whatsapp.net`, name: 'Doe, Jane' },
    ]);
    collector.observeChats([{ id: `${phoneNumber}@s.whatsapp.net` }]);
    collector.flush();

    assert.equal(
        fs.readFileSync(outputPath, 'utf8'),
        'phone_number,saved_contact,name\n15550000021,true,"Doe, Jane"\n',
    );
});

test('resolves a direct LID when its mapping arrives later', (t) => {
    const { collector, outputPath } = createCollector(t);
    const lid = '123456789012345@lid';

    collector.observeChats([{ id: lid }]);
    collector.flush();

    assert.deepEqual(collector.getPhoneNumbers(), []);
    assert.equal(collector.getStats().pendingLids, 1);

    collector.observeLidMappings([
        { lid, pn: '15550000003@s.whatsapp.net' },
    ]);
    collector.flush();

    assert.deepEqual(collector.getPhoneNumbers(), ['15550000003']);
    assert.match(fs.readFileSync(outputPath, 'utf8'), /15550000003/);
});
test('resolves a direct LID from a message alternate JID', (t) => {
    const { collector } = createCollector(t);

    collector.observeMessages([
        {
            key: {
                remoteJid: '123456789012349@lid',
                remoteJidAlt: '15550000013@s.whatsapp.net',
            },
        },
    ]);
    collector.flush();

    assert.deepEqual(collector.getPhoneNumbers(), ['15550000013']);
});

test('excludes the logged-in account when it is identified by a LID', (t) => {
    const { collector } = createCollector(t);
    const ownLid = '123456789012350@lid';

    collector.setAccount({ id: ownLid });
    collector.observeChats([{ id: ownLid }]);
    collector.observeLidMappings([
        { lid: ownLid, pn: '15550000014@s.whatsapp.net' },
    ]);
    collector.flush();

    assert.deepEqual(collector.getPhoneNumbers(), []);
});



test('uses contact data only for an observed direct LID', (t) => {
    const { collector } = createCollector(t);
    const lid = '123456789012346@lid';

    collector.observeContacts([
        { id: lid, phoneNumber: '15550000004' },
    ]);
    collector.flush();

    assert.deepEqual(collector.getPhoneNumbers(), []);

    collector.observeChats([{ id: lid }]);
    collector.flush();

    assert.deepEqual(collector.getPhoneNumbers(), ['15550000004']);
});

test('does not collect the logged-in account itself', (t) => {
    const { collector } = createCollector(t);

    collector.setAccount({
        id: '15550000005@s.whatsapp.net',
        phoneNumber: '15550000005',
    });
    collector.observeChats([
        { id: '15550000005@s.whatsapp.net' },
        { id: '15550000006@s.whatsapp.net' },
    ]);
    collector.flush();

    assert.deepEqual(collector.getPhoneNumbers(), ['15550000006']);
});

test('deduplicates and merges an existing CSV', (t) => {
    const { outputPath } = createCollector(t);

    fs.writeFileSync(outputPath, 'phone_number\n15550000007\n');

    const collector = new PhoneNumberCollector(outputPath);
    collector.observeChats([
        { id: '15550000007@s.whatsapp.net' },
        { id: '15550000008@s.whatsapp.net' },
    ]);
    collector.flush();

    assert.deepEqual(collector.getPhoneNumbers(), [
        '15550000007',
        '15550000008',
    ]);
});

test('handles a history set with chats, messages, contacts, and mappings', (t) => {
    const { collector } = createCollector(t);
    const mappedLid = '123456789012347@lid';
    const contactLid = '123456789012348@lid';

    collector.observeHistorySet({
        chats: [
            { id: '15550000009@s.whatsapp.net' },
            { id: mappedLid },
            { id: contactLid },
        ],
        messages: [
            { key: { remoteJid: '15550000010@s.whatsapp.net' } },
        ],
        contacts: [
            { id: contactLid, phoneNumber: '15550000011' },
        ],
        lidPnMappings: [
            { lid: mappedLid, pn: '15550000012@s.whatsapp.net' },
        ],
    });
    collector.flush();

    assert.deepEqual(collector.getPhoneNumbers(), [
        '15550000009',
        '15550000010',
        '15550000011',
        '15550000012',
    ]);
});
test('buffers sync metadata until initial bootstrap completes', () => {
    const buffer = new HistorySyncBuffer(0);

    buffer.queueHistorySet({
        chats: [{ id: '15550000015@s.whatsapp.net', name: 'ignored' }],
        messages: [
            {
                key: {
                    remoteJid: '15550000016@s.whatsapp.net',
                    remoteJidAlt: '15550000017@s.whatsapp.net',
                },
                message: { conversation: 'message body must not be buffered' },
            },
        ],
        contacts: [
            {
                id: '123456789012351@lid',
                phoneNumber: '15550000018',
                name: 'ignored',
            },
        ],
        lidPnMappings: [
            {
                lid: '123456789012352@lid',
                pn: '15550000019@s.whatsapp.net',
                ignored: true,
            },
        ],
    });

    assert.equal(buffer.isReady(), false);
    assert.equal(buffer.markStatus(0, 'paused'), false);
    assert.equal(buffer.markStatus(0, 'complete'), true);
    assert.deepEqual(buffer.takePending(), {
        chats: [{ id: '15550000015@s.whatsapp.net' }],
        messages: [
            {
                key: {
                    remoteJid: '15550000016@s.whatsapp.net',
                    remoteJidAlt: '15550000017@s.whatsapp.net',
                },
            },
        ],
        contacts: [
            {
                id: '123456789012351@lid',
                lid: undefined,
                phoneNumber: '15550000018',
                name: 'ignored',
            },
        ],
        lidMappings: [
            {
                lid: '123456789012352@lid',
                pn: '15550000019@s.whatsapp.net',
            },
        ],
    });
    assert.equal(buffer.takePending(), null);
});



test('accepts a completed recent history sync when data was received', () => {
    const buffer = new HistorySyncBuffer(0);

    buffer.queueHistorySet({
        syncType: 1,
        chats: [{ id: '15550000023@s.whatsapp.net' }],
    });

    assert.equal(buffer.isReady(), false);
    assert.equal(buffer.markStatus(1, 'complete'), true);
    assert.equal(buffer.hasBufferedData(), true);
});

test('status server exposes a read-only health response', async (t) => {
    const service = createStatusServer({
        host: '127.0.0.1',
        port: 0,
        getStatus: () => ({ state: 'test', connected: false }),
    });

    t.after(() => service.stop());

    const address = await service.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        state: 'test',
        connected: false,
    });
});


test('status server serves the dashboard, QR image, and CSV download', async (t) => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'whatsapp-status-server-'),
    );
    const csvPath = path.join(directory, 'direct-chat-phone-numbers.csv');
    fs.writeFileSync(csvPath, 'phone_number,saved_contact,name\n15550000022,false,\n');

    const service = createStatusServer({
        host: '127.0.0.1',
        port: 0,
        getStatus: () => ({
            state: 'waiting_for_qr',
            qrAvailable: true,
            csvReady: true,
        }),
        getQrData: () => 'test-qr-data',
        getCsvPath: () => csvPath,
    });

    t.after(async () => {
        await service.stop();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const address = await service.start();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const home = await fetch(`${baseUrl}/`);
    const homeText = await home.text();
    const qr = await fetch(`${baseUrl}/qr.png`);
    const download = await fetch(`${baseUrl}/download`);

    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(homeText, /WhatsApp Contact Collector/);
    assert.match(homeText, /Download CSV/);
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get('content-type'), /image\/png/);
    assert.equal((await qr.arrayBuffer()).byteLength > 0, true);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.equal(await download.text(), 'phone_number,saved_contact,name\n15550000022,false,\n');
});

test('status server protects routes when a token is configured', async (t) => {
    const service = createStatusServer({
        host: '127.0.0.1',
        port: 0,
        accessToken: 'test-token',
        getStatus: () => ({ state: 'test' }),
    });

    t.after(() => service.stop());

    const address = await service.start();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const denied = await fetch(`${baseUrl}/health`);
    const allowed = await fetch(`${baseUrl}/health?token=test-token`);

    assert.equal(denied.status, 401);
    assert.equal(allowed.status, 200);
});


test('status server requests a phone-number pairing code', async (t) => {
    const service = createStatusServer({
        host: '127.0.0.1',
        port: 0,
        getStatus: () => ({ state: 'waiting_for_qr' }),
        requestPairingCode: async (phoneNumber) => {
            assert.equal(phoneNumber, '+1 555 000 0024');
            return 'ABCD-EFGH';
        },
    });

    t.after(() => service.stop());

    const address = await service.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/pairing-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: '+1 555 000 0024' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { code: 'ABCD-EFGH' });
});
