var JSONMessage = require('../messages/json');

function defaultHelper(rules, obj, overwrite) {
    if (typeof obj !== 'object' || !rules) {
        return false;
    }
    var changed = false,
        key, newVal;
    for (key in rules) {
        if (!rules.hasOwnProperty(key)) {
            continue;
        }
        newVal = rules[key];
        //check for nested rules
        if (typeof newVal === 'object') {
            changed = defaultHelper(newVal, obj[key], overwrite) || changed;
            continue;
        }
        //if the old key is not null, ignore
        if (obj.hasOwnProperty(key) && obj[key] != null) {
            continue;
        }
        changed = true;
        obj[key] = newVal;
    }
    return changed;
}

function DefaultKeysFormatter(options) {
    this.rules = (options && options.rules);
    if (!this.rules) {
        throw new TypeError('Invalid rules sent to DefaultKeysFormatter');
    }
}
DefaultKeysFormatter.prototype.format = function(msg, messageOptions) {
    var obj = msg,
        typeBefore = 'Object',
        result;
    if (msg instanceof JSONMessage) {
        typeBefore = 'JSONMessage';
        obj = msg.toObject();
    }
    if (obj.constructor && obj.constructor !== Object) {
        throw new TypeError('Invalid object sent to DefaultKeysFormatter: ' + obj.constructor);
    }
    if (!defaultHelper(this.rules, obj)) {
        return msg;
    }
    switch (typeBefore) {
        case 'JSONMessage':
            result = msg.overwrite().extend(obj);
            break;
        case 'Object':
            result = obj;
            break;
        default:
            throw new Error('Invalid object received after renaming in DefaultKeysFormatter: ' + typeBefore);
            break;
    }
    return result;
};
module.exports = DefaultKeysFormatter;