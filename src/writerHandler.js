var events = require('events'),
    util = require('util'),
    path = require('path'),
    reload = require('require-reload')(require),
    log = require('./log.js'),
    crc32 = require('crc32');

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
WriterHandler.prototype.stopWriters = function() {
    for (var i = 0; i < this.writers.length; i++) {
        this.writers[i].stop(this);
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
    this.stopWriters();
    this._reloadWriters(this.writers);
    this.startWriters();
};
WriterHandler.prototype._reloadWriters = function(writers) {
    var newWriters = [],
        writersByCRC = {},
        folder = path.dirname(__filename) + '/writers/',
        i, crc, filename, oldWriter, config, writer;
    for (i = 0; i < this.writers.length; i++) {
        writersByCRC[this.writers[i].configCRC] = this.writers[i];
    }
    for (i = 0; i < writers.length; i++) {
        if (writers[i].constructor === Object) {
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
        //todo: we should be removing all the listeners as well on oldWriter
        writer = new (reload(filename))(oldWriter);
        writer.config = config;
        writer.configCRC = crc;
        writer.setConfig(config);
        newWriters.push(writer);
    }
    for (crc in writersByCRC) {
        writer = writersByCRC[crc];
        log('Destroying leftover writer', writer.config.type);
        writer.stop(this);
        //todo: we should be removing all the listeners as well on writer
    }
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
        i, type, filename, formatter;
    this.formatters = [];
    for (i = 0; i < formatters.length; i++) {
        if (typeof formatters[i] === 'string') {
            type = formatters[i];
        } else {
            type = formatters[i].type;
            if (!type) {
                throw new TypeError('Invalid config specified. No type for formatter ' + i);
            }
        }
        filename = resolveFilename(folder, type);
        formatter = new (reload(filename))();
        formatter.type = type;
        this.formatters.push(formatter);
    }
};
//does NOT start the writers, unless they were ALREADY started and the writer is a server
WriterHandler.prototype.setWriters = function(writers) {
    this.writers = this._reloadWriters(writers);
    //todo: cleanup writers that no longer exist...?
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
