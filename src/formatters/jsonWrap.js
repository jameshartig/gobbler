var JSONMessage = require('../messages/json');

function JSONWrapFormatter(options) {
    this.key = (options && options.key) || 'msg';
    this.includeOpts = (options && options.includeOpts === false) ? false : true;
}
JSONWrapFormatter.prototype.format = function(msg, messageOptions) {
    var message = msg,
        obj = (this.includeOpts && messageOptions) || {},
        result;
    if (message instanceof JSONMessage) {
        message = message.toObject();
    } else {
        if (message instanceof Buffer) {
            message = message.toString();
        }
    }
    obj[this.key] = message;
    result = JSONMessage.getInstance(module).overwrite().extend(obj);
    obj[this.key] = undefined;
    return result;
};
module.exports = JSONWrapFormatter;
