var JSONMessage = require('../messages/json');

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
    var obj = msg,
        changed = false,
        typeBefore = 'Object',
        i;
    if (msg instanceof JSONMessage) {
        typeBefore = 'JSONMessage';
        obj = msg.toObject();
    }
    if (obj.constructor && obj.constructor !== Object) {
        throw new TypeError('Invalid object sent to ValidKeysFormatter: ' + obj.constructor);
    }
    for (var key in obj) {
        if (obj.hasOwnProperty(key) && this.keys[key] !== 1) {
            if (!this.removeOthers) {
                throw new Error('Message contains invalid key: ' + key);
            }
            changed = true;
            delete obj[key];
        }
    }
    if (!changed) {
        return obj;
    }
    switch (typeBefore) {
        case 'JSONMessage':
            obj = msg.overwrite().extend(obj);
            break;
        case 'Object':
            break;
        default:
            throw new Error('Invalid object received after renaming in ValidKeysFormatter: ' + typeBefore);
            break;
    }
    return obj;
};
module.exports = ValidKeysFormatter;
