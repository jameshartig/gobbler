var events = require('events'),
    util = require('util'),
    path = require('path'),
    crc32 = require('crc32'),
    reload = require('require-reload')(require),
    log = require('./log.js');
global.BaseObjectMessage = reload('./messages/base');
global.JSONMessage = reload('./messages/json');

function WriterHandler(oldHandler) {
    events.EventEmitter.call(this);
    if (oldHandler !== undefined) {
        this.writers = oldHandler.writers;
        this.formatters = oldHandler.formatters;
        //todo: what do we do about servers since we can't "restart" them
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
    log('Started writer', writer.logName);
};
WriterHandler.prototype.onWriterError = function(writer, error) {
    log('Error on writer', writer.logName, ':', error.message);
};
WriterHandler.prototype.stopWriters = function(otherWriters) {
    var writers = otherWriters || this.writers;
    for (var i = 0; i < writers.length; i++) {
        writers[i].stop(this);
        writers[i].removeAllListeners();
    }
};
WriterHandler.prototype.startWriters = function() {
    for (var i = 0; i < this.writers.length; i++) {
        this.setupWriterListeners(this.writers[i]);
        this.writers[i].start(this);
    }
};
WriterHandler.prototype.restartWriters = function() {
    this._reloadWriters(this.writers);
    this.startWriters();
};
WriterHandler.prototype._reloadWriters = function(writers) {
    var newWriters = [],
        writersByCRC = {},
        folder = path.dirname(__filename) + '/writers/',
        beforeWriters = this.writers,
        i, crc, filename, oldWriter, config, writer;
    for (i = 0; i < this.writers.length; i++) {
        writersByCRC[this.writers[i].configCRC] = this.writers[i];
    }
    global.BaseObjectMessage = reload('./messages/base');
    global.JSONMessage = reload('./messages/json');
    for (i = 0; i < writers.length; i++) {
        if (!writers[i].constructor || writers[i].constructor === Object) {
            config = writers[i];
            //todo: if duplicates we need to do something
            crc = crc32(JSON.stringify(config)) + writers[i].type;
        } else {
            crc = writers[i].configCRC;
            config = writers[i].config;
        }
        if (!config.type) {
            throw new TypeError('Invalid config specified. No type for writer ' + i);
        }
        oldWriter = writersByCRC[crc];
        delete writersByCRC[crc];

        filename = resolveFilename(folder, config.type);
        writer = new (reload(filename))(oldWriter);
        writer.type = config.type;
        writer.config = config;
        writer.configCRC = crc;
        writer.setConfig(config);
        newWriters.push(writer);
    }
    this.stopWriters(beforeWriters);
    return newWriters;
};
function resolveFilename(expectedPath, name) {
    if (expectedPath[expectedPath.length - 1] !== '/') {
        expectedPath += '/';
    }
    var filename;
    //check to see if they specified an absolute path
    if (name[0] === '/') {
        filename = name;
        reload.resolve(filename);
    } else {
        try {
            //try formatters/{type}
            filename = expectedPath + name;
            reload.resolve(filename);
        } catch (e) {
            //try relative to running folder
            filename = [process.cwd(), name].join('/');
            reload.resolve(filename);
        }
    }
    return filename;
}
WriterHandler.prototype.setFormatters = function(formatters) {
    var folder = path.dirname(__filename) + '/formatters/',
        i, type, filename, formatter, options;
    this.formatters = [];
    for (i = 0; i < formatters.length; i++) {
        if (typeof formatters[i] === 'string') {
            options = {type: formatters[i]};
        } else {
            options = formatters[i];
            if (!options.type) {
                throw new TypeError('Invalid config specified. No type for formatter ' + i);
            }
        }
        filename = resolveFilename(folder, options.type);
        formatter = new (reload(filename))(options);
        formatter.type = options.type;
        formatter.config = options;
        this.formatters.push(formatter);
    }
};
//does NOT start the writers, unless they were ALREADY started and the writer is a server
WriterHandler.prototype.setWriters = function(writers) {
    this.writers = this._reloadWriters(writers);
};
WriterHandler.prototype.writeMessage = function(msg, options, additionalWriters) {
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
            return new Error('formatting_error via ' + lastFormatter + ': ' + e.message, 'formatting_error');
        }
    }
    if (typeof message !== 'string' && !(message instanceof Buffer)) {
        if (typeof message.toMessage === 'function') {
            message = message.toMessage();
        }
        message = message.toString();
    }
    for (i = 0; i < this.writers.length; i++) {
        this.writers[i].write(message);
    }
    if (Array.isArray(additionalWriters)) {
        for (i = 0; i < additionalWriters.length; i++) {
            additionalWriters[i].write(message);
        }
    }
    return null;
};

module.exports = WriterHandler;
