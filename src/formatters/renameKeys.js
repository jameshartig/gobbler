var BaseObjectMessage = require('../messages/base');

function renameHelper(rules, obj, overwrite/*, origObj*/) {
    if (typeof obj !== 'object' || !rules) {
        return false;
    }
    var changed = false,
        origObj = arguments[3] || obj,
        origKey, newKey, val, dest;
    for (origKey in rules) {
        if (!rules.hasOwnProperty(origKey)) {
            continue;
        }
        dest = obj;
        newKey = rules[origKey];
        //check for nested rules
        if (typeof newKey === 'object') {
            changed = renameHelper(newKey, obj[origKey], overwrite, origObj) || changed;
            continue;
        }
        if (newKey[0] === '[' && newKey[newKey.length - 1] === ']') {
            newKey = newKey.substring(1, newKey.length - 1);
            dest = origObj;
        }
        //make sure the old key exists
        if (!obj.hasOwnProperty(origKey) || obj[origKey] === undefined) {
            continue;
        }
        val = obj[origKey];
        delete obj[origKey];
        changed = true;
        if (!overwrite && dest[newKey] !== undefined) {
            continue;
        }
        dest[newKey] = val;
    }
    return changed;
}

function RenameKeysFormatter(options) {
    this.rules = (options && options.rules);
    if (!this.rules) {
        throw new TypeError('Invalid rules sent to RenameKeysFormatter');
    }
    this.overwrite = options.overwrite || false;
}
RenameKeysFormatter.prototype.format = function(msg, messageOptions) {
    var obj = BaseObjectMessage.getMessage(msg),
        rawObject = obj.toObject();
    if (!renameHelper(this.rules, rawObject)) {
        return msg;
    }
    obj.overwrite(rawObject);
    return obj.toMessage();
};
module.exports = RenameKeysFormatter;