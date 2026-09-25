const fs = require('node:fs');
const path = require('node:path');
const { resolveJid } = require('./jid');

const PN_SUFFIX = '@s.whatsapp.net';
const LID_SUFFIX = '@lid';
const CSV_HEADER = 'phone_number,saved_contact,name';

function parseCsvLine(line) {
    const fields = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];

        if (character === '"') {
            if (quoted && line[index + 1] === '"') {
                field += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (character === ',' && !quoted) {
            fields.push(field);
            field = '';
        } else {
            field += character;
        }
    }

    fields.push(field);
    return fields;
}

function escapeCsv(value) {
    const text = String(value ?? '');

    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function normalizeContactName(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeJid(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    const separator = trimmed.indexOf('@');

    if (separator <= 0) {
        return null;
    }

    const user = trimmed.slice(0, separator).split(':')[0];
    const server = trimmed.slice(separator + 1).toLowerCase();

    if (!user || !server) {
        return null;
    }

    return `${user}@${server}`;
}

function normalizePhoneNumber(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
    }

    const user = String(value).trim().split('@', 1)[0].split(':', 1)[0];
    const phoneNumber = user.startsWith('+') ? user.slice(1) : user;

    return /^\d{7,15}$/.test(phoneNumber) ? phoneNumber : null;
}

function normalizeLid(value) {
    const normalized = normalizeJid(value);

    if (normalized) {
        return normalized.endsWith(LID_SUFFIX) ? normalized : null;
    }

    if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
    }

    const user = String(value).trim().split(':', 1)[0];

    return /^\d+$/.test(user) ? `${user}${LID_SUFFIX}` : null;
}

function resolveDirectPhoneNumber(
    jid,
    alternateJid,
    lidToPhone,
    contactPhoneNumbers,
) {
    const normalizedJid = normalizeJid(jid);

    if (!normalizedJid) {
        return null;
    }

    const jidInfo = resolveJid(
        normalizedJid,
        normalizeJid(alternateJid),
    );

    if (jidInfo.type === 'individual') {
        return normalizePhoneNumber(jidInfo.phoneNumber);
    }

    if (jidInfo.type !== 'lid') {
        return null;
    }

    return lidToPhone.get(normalizedJid)
        || contactPhoneNumbers.get(normalizedJid)
        || null;
}

class PhoneNumberCollector {
    constructor(outputPath) {
        this.outputPath = outputPath;
        this.phoneNumbers = new Set();
        this.phoneMetadata = new Map();
        this.contactProfiles = new Map();
        this.lidToPhone = new Map();
        this.contactPhoneNumbers = new Map();
        this.pendingLids = new Set();
        this.ownJids = new Set();
        this.ownPhoneNumbers = new Set();
        this.dirty = false;

        this.loadExisting();
    }

    loadExisting() {
        if (!fs.existsSync(this.outputPath)) {
            return;
        }

        const contents = fs.readFileSync(this.outputPath, 'utf8');
        const firstLine = contents.split(/\r?\n/, 1)[0] || '';

        if (firstLine.replace(/^\uFEFF/, '') !== CSV_HEADER) {
            this.dirty = true;
        }

        for (const line of contents.split(/\r?\n/)) {
            const fields = parseCsvLine(line.replace(/^\uFEFF/, ''));
            const phoneNumber = normalizePhoneNumber(fields[0]?.trim());

            if (!phoneNumber || fields[0].trim().toLowerCase() === 'phone_number') {
                continue;
            }

            this.phoneNumbers.add(phoneNumber);
            this.phoneMetadata.set(phoneNumber, {
                sourceJids: new Set(),
                savedContact: fields[1]?.toLowerCase() === 'true',
                name: fields[2] || '',
            });
        }
    }

    setAccount(contact = {}) {
        for (const value of [contact.id, contact.lid]) {
            const jid = normalizeJid(value);

            if (jid) {
                this.ownJids.add(jid);
            }
        }

        const ownPhoneNumber = normalizePhoneNumber(contact.phoneNumber);

        if (ownPhoneNumber) {
            this.ownPhoneNumbers.add(ownPhoneNumber);
        }

        for (const phoneNumber of this.phoneNumbers) {
            if (
                this.ownPhoneNumbers.has(phoneNumber)
                || this.ownJids.has(`${phoneNumber}${PN_SUFFIX}`)
            ) {
                this.phoneNumbers.delete(phoneNumber);
                this.phoneMetadata.delete(phoneNumber);
                this.dirty = true;
            }
        }

        this.resolvePendingLids();
    }

    observeHistorySet(event = {}) {
        this.observeLidMappings(event.lidPnMappings);
        this.observeContacts(event.contacts);
        this.observeChats(event.chats);
        this.observeMessages(event.messages);
    }

    observeLidMappings(mappings) {
        if (!Array.isArray(mappings)) {
            return;
        }

        for (const mapping of mappings) {
            const lid = normalizeLid(mapping?.lid);
            const phoneNumber = normalizePhoneNumber(mapping?.pn);

            if (lid && phoneNumber) {
                this.lidToPhone.set(lid, phoneNumber);

                if (this.ownJids.has(lid)) {
                    this.ownPhoneNumbers.add(phoneNumber);

                    if (this.phoneNumbers.delete(phoneNumber)) {
                        this.phoneMetadata.delete(phoneNumber);
                        this.dirty = true;
                    }
                }
            }
        }

        this.resolvePendingLids();
    }

    observeContacts(contacts) {
        if (!Array.isArray(contacts)) {
            return;
        }

        for (const contact of contacts) {
            const phoneNumber = normalizePhoneNumber(contact?.phoneNumber);
            const name = normalizeContactName(contact?.name);
            const profile = { savedContact: Boolean(name), name };
            const sourceJids = [];

            for (const value of [contact?.id, contact?.lid]) {
                const jid = normalizeJid(value);

                if (jid) {
                    this.contactProfiles.set(jid, profile);
                    sourceJids.push(jid);
                }

                const lid = normalizeLid(value);

                if (lid && phoneNumber) {
                    this.contactPhoneNumbers.set(lid, phoneNumber);
                }
            }

            if (phoneNumber) {
                const phoneJid = `${phoneNumber}${PN_SUFFIX}`;
                this.contactProfiles.set(phoneJid, profile);
                this.contactProfiles.set(phoneNumber, profile);
                sourceJids.push(phoneJid);
            }

            this.updateExistingProfiles(phoneNumber, sourceJids, profile);
        }

        this.resolvePendingLids();
    }

    getContactProfile(phoneNumber, sourceJids) {
        for (const sourceJid of sourceJids) {
            const profile = this.contactProfiles.get(sourceJid);

            if (profile?.savedContact) {
                return profile;
            }
        }

        return this.contactProfiles.get(phoneNumber) || null;
    }

    applyProfile(metadata, profile) {
        if (!profile?.savedContact) {
            return;
        }

        if (metadata.savedContact && metadata.name === profile.name) {
            return;
        }

        metadata.savedContact = true;
        metadata.name = profile.name;
        this.dirty = true;
    }

    updateExistingProfiles(phoneNumber, sourceJids, profile) {
        for (const [number, metadata] of this.phoneMetadata) {
            if (
                number === phoneNumber
                || sourceJids.some((sourceJid) => metadata.sourceJids.has(sourceJid))
            ) {
                this.applyProfile(metadata, profile);
            }
        }
    }

    observeChats(chats) {
        if (!Array.isArray(chats)) {
            return;
        }

        for (const chat of chats) {
            this.addJid(chat?.id);
        }
    }

    observeMessages(messages) {
        if (!Array.isArray(messages)) {
            return;
        }

        for (const message of messages) {
            const key = message?.key;

            if (key) {
                this.addJid(key.remoteJid || key.remoteJidAlt, key.remoteJidAlt);
            }
        }
    }

    addJid(jid, alternateJid) {
        const normalizedJid = normalizeJid(jid);

        if (!normalizedJid || this.ownJids.has(normalizedJid)) {
            return;
        }

        const phoneNumber = resolveDirectPhoneNumber(
            normalizedJid,
            alternateJid,
            this.lidToPhone,
            this.contactPhoneNumbers,
        );

        if (phoneNumber) {
            const sourceJids = [normalizedJid, normalizeJid(alternateJid)]
                .filter(Boolean);
            this.addPhoneNumber(phoneNumber, sourceJids);
            return;
        }

        if (normalizedJid.endsWith(LID_SUFFIX)) {
            this.pendingLids.add(normalizedJid);
        }
    }

    addPhoneNumber(phoneNumber, sourceJids = []) {
        if (
            this.ownPhoneNumbers.has(phoneNumber)
            || this.ownJids.has(`${phoneNumber}${PN_SUFFIX}`)
        ) {
            return;
        }

        let metadata = this.phoneMetadata.get(phoneNumber);

        if (!metadata) {
            metadata = {
                sourceJids: new Set(),
                savedContact: false,
                name: '',
            };
            this.phoneMetadata.set(phoneNumber, metadata);
            this.phoneNumbers.add(phoneNumber);
            this.dirty = true;
        }

        for (const sourceJid of sourceJids) {
            const normalizedSourceJid = normalizeJid(sourceJid);

            if (normalizedSourceJid) {
                metadata.sourceJids.add(normalizedSourceJid);
            }
        }

        this.applyProfile(
            metadata,
            this.getContactProfile(phoneNumber, metadata.sourceJids),
        );
    }

    resolvePendingLids() {
        for (const lid of this.pendingLids) {
            const phoneNumber = this.lidToPhone.get(lid)
                || this.contactPhoneNumbers.get(lid);

            if (phoneNumber) {
                if (!this.ownJids.has(lid)) {
                    this.addPhoneNumber(phoneNumber, [lid]);
                }

                this.pendingLids.delete(lid);
            }
        }
    }

    flush() {
        if (!this.dirty && fs.existsSync(this.outputPath)) {
            return false;
        }

        const outputPath = path.resolve(this.outputPath);
        const temporaryPath = `${outputPath}.${process.pid}.tmp`;
        const rows = this.getResolvedRecords();
        const contents = [
            CSV_HEADER,
            ...rows.map((record) => [
                record.phoneNumber,
                record.savedContact ? 'true' : 'false',
                escapeCsv(record.name),
            ].join(',')),
        ].join('\n') + '\n';

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        try {
            fs.writeFileSync(temporaryPath, contents, {
                encoding: 'utf8',
                mode: 0o600,
            });
            fs.renameSync(temporaryPath, outputPath);
        } finally {
            if (fs.existsSync(temporaryPath)) {
                fs.unlinkSync(temporaryPath);
            }
        }

        this.dirty = false;
        return true;
    }

    getPhoneNumbers() {
        return [...this.phoneNumbers].sort();
    }

    getResolvedRecords() {
        return [...this.phoneNumbers].sort((a, b) => Number(a) - Number(b)).map((phoneNumber) => {
            const metadata = this.phoneMetadata.get(phoneNumber);

            return {
                phoneNumber,
                savedContact: Boolean(metadata?.savedContact),
                name: metadata?.name || '',
            };
        });
    }

    getStats() {
        return {
            total: this.phoneNumbers.size,
            resolved: this.phoneNumbers.size,
            pendingLids: this.pendingLids.size,
        };
    }
}

module.exports = {
    PhoneNumberCollector,
    normalizeJid,
    normalizePhoneNumber,
    normalizeLid,
    resolveDirectPhoneNumber,
};
