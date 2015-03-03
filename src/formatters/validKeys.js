var BaseObjectMessage = require('../messages/base');

function ValidKeysFormatter(options) {
    if (!options || !options.keys || !Array.isArray(options.keys)) {
        throw new TypeError('Invalid keys sent in options for ValidKeysFormatter');
    }
    this.keys = {};
    for (var i = 0; i < options.keys.length; i++) {
        this.keys[options.keys[i]] = 1;
    }
    this.removeOthers = options.removeOthers || false;
}
ValidKeysFormatter.prototype.format = function(msg) {
    if (typeof msg !== 'object') {
        throw new TypeError('Invalid object sent to ValidKeysFormatter');
    }
    var obj = BaseObjectMessage.getMessage(msg),
        removeOthers = this.removeOthers,
        validKeys = this.keys,
        changed = false;
    obj.forEach(function(val, key, baseObj) {
        if (obj.hasOwnProperty(key) && validKeys[key] !== 1) {
            if (!removeOthers) {
                throw new Error('Message contains invalid key: ' + key);
            }
            changed = true;
            baseObj.unset(obj);
        }
    });
    if (!changed) {
        return msg;
    }
    return obj.toMessage();
};
module.exports = ValidKeysFormatter;
