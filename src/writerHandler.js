var events = require('events'),
    util = require('util'),
    reload = require('require-reload')(require),
    log = require('./log.js');

function WriterHandler(oldHandler) {
    events.EventEmitter.call(this);
    if (oldHandler !== undefined) {
        this.writers = oldHandler.writers;
        this.formatters = oldHandler.formatters;
        this.restartWriters();
    } else {
        this.writers = [];
        this.formatters = [];
    }
}
util.inherits(WriterHandler, events.EventEmitter);
WriterHandler.prototype.call = function(context, oldHandler) {
    WriterHandler.prototype.constructor.call(context, oldHandler);
};

WriterHandler.prototype.setupWriterListeners = function(writer) {
    writer.removeAllListeners('start').on('start', this.onWriterStart.bind(this, writer));
    writer.removeAllListeners('error').on('error', this.onWriterError.bind(this, writer));
};
WriterHandler.prototype.onWriterStart = function(writer) {
    log('Started tcp socket writer', writer.logName);
};
WriterHandler.prototype.onWriterError = function(writer, error) {
    log('Error on tcp socket writer', writer.logName, ':', error.message);
};
WriterHandler.prototype.stopWriters = function() {
    for (var i = 0; i < this.writers.length; i++) {
        this.writers[i].stop();
        this.writers[i].removeAllListeners();
    }
};
WriterHandler.prototype.startWriters = function() {
    for (var i = 0; i < this.writers.length; i++) {
        this.setupWriterListeners(this.writers[i]);
        this.writers[i].start(this);
    }
};
WriterHandler.prototype.restartWriters = function() {
    var i, writer, config;
    this.stopWriters();
    for (i = 0; i < this.writers.length; i++) {
        config = this.writers[i].config;
        writer = new (reload('./writers/' + config.type))();
        writer.config = config;
        writer.setConfig(config);
    }
    this.startWriters();
};
WriterHandler.prototype.setFormatters = function(formatters) {
    var i, formatter;
    this.formatters = [];
    for (i = 0; i < formatters.length; i++) {
        if (typeof formatters[i] === 'string') {
            formatter = new (reload('./formatters/' + formatters[i]))();
            formatter.type = formatters[i];
        } else {
            formatter = new (reload('./formatters/' + formatters[i].type))(formatters[i]);
            formatter.type = formatters[i].type;
        }
        this.formatters.push(formatter);
    }
};
//does NOT start the writers
WriterHandler.prototype.setWriters = function(writers) {
    var i, writer;
    this.stopWriters();
    this.writers = [];
    for (i = 0; i < writers.length; i++) {
        writer = new (reload('./writers/' + writers[i].type))();
        writer.config = writers[i];
        writer.setConfig(writers[i]);
        this.writers.push(writer);
    }
};
WriterHandler.prototype.writeMessage = function(msg, options) {
    var message = msg,
        lastFormatter = '?',
        i;
    if (this.formatters) {
        try {
            for (i = 0; i < this.formatters.length; i++) {
                lastFormatter = this.formatters[i].type;
                message = this.formatters[i].format(message, options);
            }
        } catch (e) {
            log('Error formatting message from', lastFormatter, ':', e.message);
            return;
        }
    }
    for (i = 0; i < this.writers.length; i++) {
        this.writers[i].write(message);
    }
};

module.exports = WriterHandler;
