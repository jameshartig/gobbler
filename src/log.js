var dateFormat = require('dateFormat');
module.exports = function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(dateFormat(new Date(), "[d-mmm-yy HH:MM:ss]"));
    console.log.apply(console.log, args);
};
