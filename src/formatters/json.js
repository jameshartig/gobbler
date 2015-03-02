//DEPRECATED
function JSONFormatter() {}
JSONFormatter.prototype.format = function(msg, messageOptions) {
    var message = msg,
        obj = messageOptions || {};
    if (message instanceof Buffer) {
        message = message.toString();
    }
    obj.msg = message;
    message = JSON.stringify(obj);
    obj.msg = undefined;
    return message;
};
module.exports = JSONFormatter;
