const MESSAGE_TYPES = new Set([
    'conversation',
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'stickerMessage',
    'contactMessage',
    'contactsArrayMessage',
    'locationMessage',
    'liveLocationMessage',
    'reactionMessage',
    'pollCreationMessage',
    'pollUpdateMessage',
]);

function isActualMessage(message) {
    if (!message?.message) {
        return false;
    }

    const messageTypes = Object.keys(message.message);

    return messageTypes.some((type) => MESSAGE_TYPES.has(type));
}

module.exports = {
    isActualMessage,
};