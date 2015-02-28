var events = require('events'),
    util = require('util'),
    RingBuffer = require('ringbufferjs'),
    //for anything that is NOT internal require's you should use reload(moduleName) so it gets hot-reloaded
    reload = require('require-reload')(require);


function BaseWriter(oldWriter) {
    events.EventEmitter.call(this);
    if (oldWriter) {
        oldWriter.stop();
    }
    this.started = false;
    this.queueLimit = 1000;
    this.drained = false;
    this.config = null;
}
util.inherits(BaseWriter, events.EventEmitter);
BaseWriter.prototype.call = function(context) {
    BaseWriter.prototype.constructor.call(context);
};

BaseWriter.prototype.createQueue = function() {
    this._queue = new RingBuffer(this.queueLimit);
};
BaseWriter.prototype.setConfig = function(config) {};
//owner has isChild/isParent
BaseWriter.prototype.start = function(owner) {};
BaseWriter.prototype.write = function(message) {
    //if you cannot send the message right now you should call queue and return false
    //returning true means the message was sent and NOT queued
    //note: net.Socket.write returning false does NOT mean it wasn't sent, do NOT queue on it returning false
    //should trigger start
    //should NOT throw
};
BaseWriter.prototype.queue = function(message) {
    this.drained = false;
    if (!this._queue) {
        this.createQueue();
    }
    this._queue.enq(message);
};
//call drain when you're ready to start receiving messages again
BaseWriter.prototype.drain = function() {
    this.drained = true;
    if (!this._queue) {
        return;
    }
    while (!this._queue.isEmpty()) {
        if (!this.write(this._queue.deq())) {
            break;
        }
    }
};
BaseWriter.prototype.stop = function(owner) {};
module.exports = BaseWriter;
