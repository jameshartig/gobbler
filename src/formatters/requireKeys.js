var BaseObjectMessage = global.BaseObjectMessage;

function RequireKeysFormatter(options) {
    if (!options || !options.keys || !Array.isArray(options.keys)) {
        throw new TypeError('Invalid keys sent in options for ValidKeysFormatter');
    }
    this.keys = options.keys;
}
RequireKeysFormatter.prototype.format = function(msg) {
    var obj = BaseObjectMessage.getMessage(msg),
        i;
    for (i = 0; i < this.keys.length; i++) {
        if (!obj.has(this.keys[i])) {
            throw new Error('Message is missing required key: ' + this.keys[i]);
        }
    }
    return obj.toMessage();
};

module.exports = RequireKeysFormatter;
