var JSONMessage = require('../messages/json');

function JSONParseFormatter() {}
JSONParseFormatter.prototype.format = function(msg, initalObj) {
    return JSONMessage.getInstance(module).overwrite(msg);
};
module.exports = JSONParseFormatter;
