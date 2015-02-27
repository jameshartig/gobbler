function JSONFilter() {}
JSONFilter.prototype.format = function(msg, initalObj) {
    var message = msg,
        obj = initalObj || {};
    if (message instanceof Buffer) {
        message = message.toString();
    }
    obj.msg = message;
    return JSON.stringify(obj);
};
module.exports = JSONFilter;
