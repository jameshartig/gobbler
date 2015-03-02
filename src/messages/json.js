var _parent = this;
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
JSONMessage.prototype.overwrite = function(string) {
    JSONMessage.prototype.constructor.call(this, string);
    return this;
};
//extend the object with plain objects only
JSONMessage.prototype.extend = function(obj) {
    if (obj instanceof JSONMessage) {
        obj = obj.toObject();
    }
    if (typeof obj !== 'object' || (obj.constructor && obj.constructor !== Object)) {
        throw new TypeError('Invalid object sent to JSONMessage.extend');
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
JSONMessage.prototype.get = function(key) {
    return this.obj[key];
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

module.exports = JSONMessage;
