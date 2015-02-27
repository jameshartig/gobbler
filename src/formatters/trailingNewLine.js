var _LF_ = new Buffer("\n");

function TrailingNewLineFormatter() {}
TrailingNewLineFormatter.prototype.format = function(msg) {
    var message = msg;
    if (message instanceof Buffer) {
        message = Buffer.concat([msg, _LF_], msg.length + 1);
    } else {
        message += "\n";
    }
    return message;
};
module.exports = TrailingNewLineFormatter;
