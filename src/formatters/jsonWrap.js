var JSONMessage = require('../messages/json');

function JSONWrapFormatter(options) {
    this.key = (options && options.key) || 'msg';
}
JSONWrapFormatter.prototype.format = function(msg, initalObj) {
    var message = msg,
        obj = initalObj || {},
        result;
    if (message instanceof JSONMessage) {
        message = message.toObject();
    } else {
        if (message instanceof Buffer) {
            message = message.toString();
        }
    }
    obj[this.key] = message;
    console.log(obj);
    result = JSONMessage.getInstance(module).overwrite().extend(obj);
    obj[this.key] = undefined;
    return result;
};
module.exports = JSONWrapFormatter;
