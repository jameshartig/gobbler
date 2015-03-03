var JSONMessage = require('../messages/json'),
    BaseObjectMessage = require('../messages/base');

function JSONWrapFormatter(options) {
    this.key = (options && options.key) || 'msg';
    this.includeOpts = (options && options.includeOpts === false) ? false : true;
}
JSONWrapFormatter.prototype.format = function(msg, messageOptions) {
    var message = msg,
        obj = (this.includeOpts && messageOptions) || {},
        result;
    if (message instanceof Buffer) {
        message = message.toString();
    } else if (typeof message !== 'string') {
        message = BaseObjectMessage.getMessage(message).toObject();
    }
    try {
        obj[this.key] = message;
        result = JSONMessage.getInstance(module).overwrite().extend(obj);
    } catch (e) {
        throw e;
    } finally {
        obj[this.key] = undefined;
    }
    return result;
};
module.exports = JSONWrapFormatter;
