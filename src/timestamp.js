function getMessageTimestamp(message) {
    const timestamp = message?.messageTimestamp;

    if (timestamp === undefined || timestamp === null) {
        return null;
    }

    const seconds = Number(timestamp);

    if (!Number.isFinite(seconds) || seconds <= 0) {
        return null;
    }

    return new Date(seconds * 1000);
}

module.exports = {
    getMessageTimestamp,
};