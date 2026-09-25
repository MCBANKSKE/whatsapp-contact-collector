const { resolveJid } = require('./jid');
const { getMessageTimestamp } = require('./timestamp');

function normalizeMessage(message) {
    if (!message?.key) {
        return null;
    }

    const {
        remoteJid,
        remoteJidAlt,
        fromMe,
        participant,
        participantAlt,
        addressingMode,
    } = message.key;

    const jidInfo = resolveJid(remoteJid, remoteJidAlt);

    const timestamp = getMessageTimestamp(message);

    return {
        type: jidInfo.type,
        phoneNumber: jidInfo.phoneNumber,
        jid: jidInfo.jid,
        alternateJid: jidInfo.alternateJid ?? null,

        fromMe: fromMe === true,

        participant: participant || null,
        participantAlt: participantAlt || null,

        addressingMode: addressingMode || null,

        timestamp,
    };
}

module.exports = {
    normalizeMessage,
};