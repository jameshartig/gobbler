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
    var obj = msg,
        i;
    if (typeof msg.toObject === 'function') {
        obj = msg.toObject();
    }
    if (obj.constructor && obj.constructor !== Object) {
        throw new TypeError('Invalid object sent to ValidKeysFormatter: ' + obj.constructor);
    }
    for (i = 0; i < this.keys.length; i++) {
        if (!obj.hasOwnProperty(this.keys[i]) || obj[this.keys[i]] === 'undefined') {
            throw new Error('Message is missing required key: ' + this.keys[i]);
        }
    }
    return msg;
};
module.exports = ValidKeysFormatter;
