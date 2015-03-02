function ValidKeysFormatter(options) {
    if (!options || !options.keys || !Array.isArray(options.keys)) {
        throw new TypeError('Invalid keys sent in options for ValidKeysFormatter');
    }
    this.keys = options.keys;
}
ValidKeysFormatter.prototype.format = function(msg) {
    if (typeof msg !== 'object') {
        throw new TypeError('Invalid object sent to ValidKeysFormatter');
    }
    var message = msg,
        i;
    if (typeof msg.toObject === 'function') {
        message = msg.toObject();
    }
    if (message.constructor && message.constructor !== Object) {
        throw new TypeError('Invalid object sent to ValidKeysFormatter: ' + message.constructor);
    }
    for (i = 0; i < this.keys.length; i++) {
        if (!message.hasOwnProperty(this.keys[i]) || message[this.keys[i]] === 'undefined') {
            throw new Error('Message is missing required key: ' + this.keys[i]);
        }
    }
    return message;
};
module.exports = ValidKeysFormatter;
