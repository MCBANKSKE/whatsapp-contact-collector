const { resolveJid } = require('./jid');

const tests = [
    {
        jid: '254712345678@s.whatsapp.net',
    },
    {
        jid: '120363123456789@g.us',
    },
    {
        jid: 'status@broadcast',
    },
    {
        jid: '74552478564506@lid',
        alternateJid: '255755206822@s.whatsapp.net',
    },
    {
        jid: '74552478564506@lid',
    },
];

for (const test of tests) {
    console.log('\nInput:');
    console.log(test);

    console.log('Result:');
    console.log(resolveJid(test.jid, test.alternateJid));
}
