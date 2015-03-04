var BaseObjectMessage = global.BaseObjectMessage,
    _date = new Date();

function TSISO8601(options) {
    this.key = (options && options.key) || 'timestamp';
}
TSISO8601.prototype.format = function(msg, messageOptions) {
    var message = BaseObjectMessage.getMessage(msg);
    //todo: detect if its already in ISO8601 format
    if (message.has(this.key)) {
        //todo: determine if its in milliseconds or not
        _date.setTime(message.get(this.key));
        message.set('timestamp', _date.toISOString());
    }
    return message.toMessage();
};
module.exports = TSISO8601;