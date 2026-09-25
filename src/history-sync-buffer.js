function copyChat(chat) {
    return { id: chat?.id };
}

function copyMessage(message) {
    const key = message?.key;

    if (!key) {
        return null;
    }

    return {
        key: {
            remoteJid: key.remoteJid,
            remoteJidAlt: key.remoteJidAlt,
        },
    };
}

function copyContact(contact) {
    return {
        id: contact?.id,
        lid: contact?.lid,
        phoneNumber: contact?.phoneNumber,
        name: contact?.name,
    };
}

function copyMapping(mapping) {
    return {
        lid: mapping?.lid,
        pn: mapping?.pn,
    };
}

function createPendingData() {
    return {
        chats: [],
        messages: [],
        contacts: [],
        lidMappings: [],
    };
}

class HistorySyncBuffer {
    constructor(initialBootstrapSyncType) {
        this.initialBootstrapSyncType = initialBootstrapSyncType;
        this.completeStatusSeen = false;
        this.historyDataSeen = false;
        this.ready = false;
        this.drained = false;
        this.pending = createPendingData();
    }

    isReady() {
        return this.ready;
    }

    queueHistorySet(event = {}) {
        if (
            Array.isArray(event.chats)
            || Array.isArray(event.messages)
            || Array.isArray(event.lidPnMappings)
        ) {
            this.historyDataSeen = true;
        }

        this.queueChats(event.chats);
        this.queueMessages(event.messages);
        this.queueContacts(event.contacts);
        this.queueLidMappings(event.lidPnMappings);
    }

    queueChats(chats) {
        if (!Array.isArray(chats)) {
            return;
        }

        this.pending.chats.push(...chats.map(copyChat));
    }

    queueMessages(messages) {
        if (!Array.isArray(messages)) {
            return;
        }

        this.pending.messages.push(
            ...messages.map(copyMessage).filter(Boolean),
        );
    }

    queueContacts(contacts) {
        if (!Array.isArray(contacts)) {
            return;
        }

        this.pending.contacts.push(...contacts.map(copyContact));
    }

    queueLidMappings(mappings) {
        if (!Array.isArray(mappings)) {
            return;
        }

        this.pending.lidMappings.push(...mappings.map(copyMapping));
    }

    hasCompletedStatus() {
        return this.completeStatusSeen;
    }

    hasBufferedData() {
        return this.historyDataSeen;
    }

    markStatus(syncType, status) {
        if (status === 'complete') {
            this.completeStatusSeen = true;
        }

        if (this.completeStatusSeen && this.historyDataSeen) {
            this.ready = true;
        }

        return this.ready;
    }

    forceReady() {
        this.ready = true;
        return true;
    }

    takePending() {
        if (!this.ready || this.drained) {
            return null;
        }

        this.drained = true;
        const pending = this.pending;
        this.pending = createPendingData();

        return pending;
    }
}

module.exports = {
    HistorySyncBuffer,
};
