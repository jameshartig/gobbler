var JSONMessage = require('../messages/json'),
    _date = new Date();

function TSISO8601(options) {
    this.key = (options && options.key) || 'timestamp';
}
TSISO8601.prototype.format = function(msg, messageOptions) {
    var message = msg,
        tsISO;
    //todo: detect if its already in ISO8601 format
    if (message instanceof JSONMessage) {
        if (message.has(this.key)) {
            _date.setTime(message.get(this.key));
            tsISO = _date.toISOString();
            message = message.extend({timestamp: tsISO});
        }
    } else if (typeof message === 'object' && message.hasOwnProperty(this.key)) {
        _date.setTime(message[this.key]);
        tsISO = _date.toISOString();
        message.timestamp = tsISO;
    }
    return message;
};
module.exports = TSISO8601;