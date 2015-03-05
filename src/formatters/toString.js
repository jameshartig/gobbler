function ToStringFormatter() {}
ToStringFormatter.prototype.format = function(msg) {
    var message = msg;

    if (typeof message !== 'string') {
        if (message instanceof Buffer) {
            message = message.toString();
        } else {
            message = message.toString();
        }
    }
    return message;
};
module.exports = ToStringFormatter;