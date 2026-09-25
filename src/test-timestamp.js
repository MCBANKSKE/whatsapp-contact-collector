const { getMessageTimestamp } = require('./timestamp');

const tests = [
    {
        messageTimestamp: 1790329688,
    },
    {
        messageTimestamp: 1790329689,
    },
    {
        messageTimestamp: undefined,
    },
    {
        messageTimestamp: null,
    },
];

for (const message of tests) {
    const timestamp = getMessageTimestamp(message);

    console.log('\nInput:', message.messageTimestamp);
    console.log('Date object:', timestamp);
    console.log(
        'ISO:',
        timestamp ? timestamp.toISOString() : null
    );
}