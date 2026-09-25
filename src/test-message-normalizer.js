const { normalizeMessage } = require('./message-normalizer');

const tests = [
    {
        key: {
            remoteJid: '254712345678@s.whatsapp.net',
            remoteJidAlt: undefined,
            fromMe: false,
            participant: '',
            participantAlt: undefined,
            addressingMode: 'pn',
        },
        messageTimestamp: 1790329688,
    },

    {
        key: {
            remoteJid: '254798808796@s.whatsapp.net',
            remoteJidAlt: undefined,
            fromMe: true,
            participant: '',
            participantAlt: undefined,
            addressingMode: 'pn',
        },
        messageTimestamp: 1790329689,
    },

    {
        key: {
            remoteJid: 'status@broadcast',
            remoteJidAlt: '254703240441@s.whatsapp.net',
            fromMe: false,
            participant: '95164076937246@lid',
            participantAlt: undefined,
            addressingMode: 'lid',
        },
        messageTimestamp: 1790329410,
    },

    {
        key: {
            remoteJid: '120363123456789@g.us',
            remoteJidAlt: undefined,
            fromMe: false,
            participant: '254712345678@s.whatsapp.net',
            participantAlt: undefined,
            addressingMode: 'pn',
        },
        messageTimestamp: 1790329500,
    },
];

for (const message of tests) {
    console.log('\n==============================');
    console.log(normalizeMessage(message));
}