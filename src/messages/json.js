var BaseObjectMessage = require('./base'),
    _parent = this;
function JSONMessage(string) {
    if (string instanceof Buffer) {
        this.string = string.toString();
    } else {
        this.string = string || '';
    }
    this.stringAppend = '';
    this.obj = this.string ? JSON.parse(this.string) : {};
    this._invalidString = !this.string; //if string is falsey then _invalidString is true
}
JSONMessage.getInstance = function(parent) {
    parent = parent || _parent;
    //we want the instance to live on a per-file basis
    if (!parent._JSONMessageInstance) {
        parent._JSONMessageInstance = new JSONMessage();
    }
    return parent._JSONMessageInstance;
};
JSONMessage.prototype._type = 'JSONMessage';
JSONMessage.prototype.overwrite = function(obj) {
    if (typeof obj === 'string' || obj === undefined) {
        JSONMessage.prototype.constructor.call(this, obj);
        return this;
    }
    if (typeof obj.toObject === 'function') {
        obj = obj.toObject();
    }
    if (typeof obj !== 'object' || (obj.constructor && obj.constructor !== Object)) {
        if (obj instanceof Buffer) {
            JSONMessage.prototype.constructor.call(this, obj.toString());
            return this;
        }
        throw new TypeError('Invalid object sent to JSONMessage.overwrite: ' + obj.constructor);
    }
    this._invalidString = true;
    this.obj = obj;
    return this;
};
//extend the object with plain objects only
JSONMessage.prototype.extend = function(obj) {
    if (obj.toObject === 'function') {
        obj = obj.toObject();
    }
    if (typeof obj !== 'object' || (obj.constructor && obj.constructor !== Object)) {
        throw new TypeError('Invalid object sent to JSONMessage.extend: ' + obj.constructor);
    }
    this._invalidString = true;
    for (var key in obj) {
        if (obj.hasOwnProperty(key) && obj[key] !== undefined) {
            this.obj[key] = obj[key];
        }
    }
    return this;
};
JSONMessage.prototype.has = function(key) {
    return (this.obj.hasOwnProperty(key) && this.obj[key] !== undefined);
};
JSONMessage.prototype.unset = function(key) {
    if (this.has(key)) {
        this.obj[key] = undefined;
        this._invalidString = true;
    }
};
JSONMessage.prototype.get = function(key) {
    return this.obj[key];
};
JSONMessage.prototype.set = function(key, val) {
    if (this.obj[key] !== val) {
        this.obj[key] = val;
        this._invalidString = true;
    }
};
JSONMessage.prototype.append = function(toAppend, reset) {
    if (typeof toAppend !== 'string') {
        throw new TypeError('Invalid string sent to JSONMessage.append');
    }
    if (reset) {
        this.stringAppend = toAppend;
    } else {
        this.stringAppend += toAppend;
    }
};
JSONMessage.prototype.toString = function() {
    if (this._invalidString) {
        this.string = JSON.stringify(this.obj) + this.stringAppend;
    }
    return this.string;
};
JSONMessage.prototype.toObject = function() {
    return this.obj;
};
JSONMessage.prototype.toMessage = function() {
    //we are a valid message so return this
    return this;
};
JSONMessage.prototype.forEach = function(func) {
    for (var key in this.obj) {
        if (this.obj.hasOwnProperty(key) && this.obj[key] !== 'undefined') {
            func(this.obj[key], key, this);
        }
    }
};

module.exports = JSONMessage;
