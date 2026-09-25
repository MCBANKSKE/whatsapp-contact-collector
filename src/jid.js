function resolveJid(jid, alternateJid = undefined) {
    if (!jid) {
        return {
            type: 'unknown',
            phoneNumber: null,
            jid: null,
        };
    }

    // WhatsApp Status
    if (jid === 'status@broadcast') {
        return {
            type: 'status',
            phoneNumber: null,
            jid,
        };
    }

    // WhatsApp groups
    if (jid.endsWith('@g.us')) {
        return {
            type: 'group',
            phoneNumber: null,
            jid,
        };
    }

    // Standard phone-number JID
    if (jid.endsWith('@s.whatsapp.net')) {
        const phoneNumber = jid.split('@')[0];

        return {
            type: 'individual',
            phoneNumber,
            jid,
        };
    }

    // Linked ID (LID)
    if (jid.endsWith('@lid')) {
        if (alternateJid?.endsWith('@s.whatsapp.net')) {
            const phoneNumber = alternateJid.split('@')[0];

            return {
                type: 'individual',
                phoneNumber,
                jid,
                alternateJid,
            };
        }

        return {
            type: 'lid',
            phoneNumber: null,
            jid,
            alternateJid,
        };
    }

    return {
        type: 'unknown',
        phoneNumber: null,
        jid,
    };
}

module.exports = {
    resolveJid,
};