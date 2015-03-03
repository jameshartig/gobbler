var JSONMessage = require('../messages/json');

function JSONParseFormatter() {}
JSONParseFormatter.prototype.format = function(msg) {
    var message;
    if (msg instanceof Buffer) {
        message = msg.toString();
    } else {
        message = msg;
    }
    return JSONMessage.getInstance(module).overwrite(message);
};
module.exports = JSONParseFormatter;
