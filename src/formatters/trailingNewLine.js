var JSONMessage = global.JSONMessage,
    _LF_ = "\n",
    _LF_BUF_ = new Buffer(_LF_);

function TrailingNewLineFormatter() {}
TrailingNewLineFormatter.prototype.format = function(msg) {
    var message = msg;
    if (message instanceof Buffer) {
        message = Buffer.concat([msg, _LF_BUF_], msg.length + 1);
    } else if (message instanceof JSONMessage) {
        message.append(_LF_);
    } else {
        if (typeof message !== 'string') {
            if (typeof message.toString !== 'function') {
                throw new TypeError('Invalid message received in TrailingNewLineFormatter. Must be Buffer, JSONMessage, String');
            }
            message = message.toString();
        }
        message += _LF_;
    }
    return message;
};
module.exports = TrailingNewLineFormatter;
