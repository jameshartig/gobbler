var _parent = this;

function BaseObjectMessage(obj) {
    this.obj = obj || {};
}
BaseObjectMessage.getInstance = function(parent) {
    parent = parent || _parent;
    //we want the instance to live on a per-file basis
    if (!parent._RawObjectMessage) {
        parent._RawObjectMessage = new BaseObjectMessage();
    }
    return parent._RawObjectMessage;
};
BaseObjectMessage.prototype._type = 'BaseObjectMessage';
BaseObjectMessage.prototype.overwrite = function(obj) {
    if (obj === undefined) {
        BaseObjectMessage.prototype.constructor.call(this);
        return this;
    }
    if (typeof obj === 'string') {
        throw new Error('Unexpected string in BaseObjectMessage.overwrite');
    }
    if (typeof obj.toObject === 'function') {
        obj = obj.toObject();
    }
    this.obj = obj;
    return this;
};
//extend the object with plain objects only
BaseObjectMessage.prototype.extend = function(obj) {
    if (typeof obj.toObject === 'function') {
        obj = obj.toObject();
    }
    if (typeof obj !== 'object' || (obj.constructor && obj.constructor !== Object)) {
        throw new TypeError('Invalid object sent to BaseObjectMessage.extend: ' + obj.constructor);
    }
    for (var key in obj) {
        if (obj.hasOwnProperty(key) && obj[key] !== undefined) {
            this.obj[key] = obj[key];
        }
    }
    return this;
};
BaseObjectMessage.prototype.has = function(key) {
    return (this.obj.hasOwnProperty(key) && this.obj[key] !== undefined);
};
BaseObjectMessage.prototype.get = function(key) {
    return this.obj[key];
};
BaseObjectMessage.prototype.set = function(key, val) {
    this.obj[key] = val;
};
BaseObjectMessage.prototype.unset = function(key) {
    delete this.obj[key];
};
BaseObjectMessage.prototype.toString = function() {
    throw new Error('Cannot call toString on BaseObjectMessage.');
};
BaseObjectMessage.prototype.toObject = function() {
    return this.obj;
};
BaseObjectMessage.prototype.toMessage = function() {
    return this.obj;
};
BaseObjectMessage.prototype.forEach = function(func) {
    for (var key in this.obj) {
        if (this.obj.hasOwnProperty(key) && this.obj[key] !== 'undefined') {
            func(this.obj[key], key, this);
        }
    }
};

BaseObjectMessage.getMessage = function(msg) {
    if (msg === undefined) {
        throw new TypeError('Unexpected undefined passed to BaseObjectMessage.getMessage');
    }
    if (typeof msg !== 'object' || (msg.constructor && msg.constructor !== Object)) {
        if (typeof msg.toObject !== 'function') {
            throw new TypeError('Invalid object received in BaseObjectMessage.getMessage: ' + msg.constructor);
        }
        return msg;
    }
    return BaseObjectMessage.getInstance(module).overwrite(msg);
};

module.exports = BaseObjectMessage;
