var events = require('events'),
    util = require('util'),
    reload = require('require-reload')(require),
    log = require('./log.js'),
    //don't use reload here since we actually the cached version for instanceof to work
    Child = require('./Child.js');

function WriterHandler() {
    events.EventEmitter.call(this);
}
util.inherits(WriterHandler, events.EventEmitter);

WriterHandler.prototype.setupWriterListeners = function() {
    this.writer.removeAllListeners('connect').on('connect', this.onWriterDrain.bind(this));
    this.writer.removeAllListeners('drain').on('drain', this.onWriterDrain.bind(this));
    this.writer.removeAllListeners('disconnect').on('disconnect', this.onWriterDisconnect.bind(this));
    this.writer.removeAllListeners('error').on('error', this.onWriterError.bind(this));
};
WriterHandler.prototype.onWriterDrain = function() {
    while (!this.buffer.isEmpty()) {
        if (!this.writer.write(this.buffer.deq())) {
            break;
        }
    }
};
WriterHandler.prototype.onWriterDisconnect = function() {
    if (this.pendingWriterConnect) {
        clearTimeout(this.pendingWriterConnect);
    }
    this.writer.stop();
    //wait 5 seconds before trying to reconnect
    this.pendingWriterConnect = setTimeout(this.writerStart.bind(this), 5000);
};
WriterHandler.prototype.onWriterError = function(err) {
    log('Writer error in child ' + err.message);
};
WriterHandler.prototype.writerStart = function() {
    if (!this.writer) {
        throw new Error("No writer to start in WriterHandler.writerStart");
    }
    this.setupWriterListeners();
    this.writer.start((this instanceof Child));
};
WriterHandler.prototype.replaceWriter = function() {
    if (this instanceof Child) {
        log('Creating new writer from child');
    } else {
        log('Creating new writer from parent');
    }
    if (this.writer) {
        this.writer.removeAllListeners();
        if (this.pendingWriterConnect) {
            clearTimeout(this.pendingWriterConnect);
            this.pendingWriterConnect = 0;
        }
        this.writer.stop();
    }
    this.writer = new (reload('./writers/' + this.config.writer.type))(this.writer);
    this.writer.setConfig(this.config.writer);
    this.writerStart();
};

module.exports = WriterHandler;
