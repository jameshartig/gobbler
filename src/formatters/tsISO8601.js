var JSONMessage = require('../messages/json'),
    _date = new Date();

function TSISO8601() {}
TSISO8601.prototype.format = function(msg, messageOptions) {
    var message = msg,
        tsISO;
    if (!messageOptions.timestamp) {
        throw new Error('Failed to get timestamp for ISO8601 from messageOptions');
    }
    _date.setTime(messageOptions.timestamp);
    tsISO = _date.toISOString();
    if (message instanceof JSONMessage) {
        if (message.has('timestamp')) {
            message = message.extend({timestamp: tsISO});
        }
    } else if (typeof message === 'object' && message.hasOwnProperty('timestamp')) {
        message.timestamp = tsISO;
    }
    if (typeof messageOptions === 'object' && messageOptions.timestamp !== undefined) {
        messageOptions.timestamp = tsISO;
    }
    return message;
};
module.exports = TSISO8601;