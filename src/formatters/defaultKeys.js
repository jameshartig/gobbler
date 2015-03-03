var BaseObjectMessage = require('../messages/base');

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
    var obj = BaseObjectMessage.getMessage(msg),
        rawObject = obj.toObject();
        if (!defaultHelper(this.rules, rawObject)) {
            return msg;
        }
    obj.overwrite(rawObject);
    return obj.toMessage();
};

module.exports = DefaultKeysFormatter;
