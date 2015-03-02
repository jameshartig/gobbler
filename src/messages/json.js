var _parent = this;
function JSONMessage(string) {
    if (string instanceof Buffer) {
        this.string = string.toString();
    } else {
        this.string = string || '';
    }
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
JSONMessage.prototype.toString = function() {
    if (this._invalidString) {
        this.string = JSON.stringify(this.obj);
    }
    return this.string;
};
JSONMessage.prototype.toObject = function() {
    return this.obj;
};

module.exports = JSONMessage;
