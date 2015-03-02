//DEPRECATED
function JSONFormatter() {}
JSONFormatter.prototype.format = function(msg, initalObj) {
    var message = msg,
        obj = initalObj || {};
    if (message instanceof Buffer) {
        message = message.toString();
    }
    obj.msg = message;
    message = JSON.stringify(obj);
    obj.msg = undefined;
    return message;
};
module.exports = JSONFormatter;
