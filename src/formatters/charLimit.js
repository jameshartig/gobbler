function CharLimitFormatter(options) {
    this.limit = (options && options.limit) || 1024;
}
CharLimitFormatter.prototype.format = function(msg) {
    var message = msg;
    if (message instanceof Buffer) {
        if (message.length > this.limit) {
            message = message.slice(0, this.limit);
        }
    } else {
        if (message.length > this.limit) {
            message = message.substr(0, this.limit);
        }
    }
    return message;
};
module.exports = CharLimitFormatter;