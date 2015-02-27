var util = require('util'),
    net = require('net'),
    log = require('../log.js'),
    //for anything that is NOT internal require's you should use reload(moduleName) so it gets hot-reloaded
    reload = require('require-reload')(require),
    BaseWriter = reload('./base.js'),
    noop = function(){};

function TCPSocketWriter() {
    BaseWriter.call(this);
    this.connected = false;
    this.pendingConnect = 0;
    this.reconnectWait = 1000; //default to reconnect in one second (set to -1 to disable)
    this.logName = 'unknown';
}
util.inherits(TCPSocketWriter, BaseWriter);
TCPSocketWriter.prototype.call = function(context) {
    TCPSocketWriter.prototype.constructor.call(context);
};

TCPSocketWriter.prototype.setConfig = function(config) {
    if (!config) {
        throw new TypeError('Invalid config passed to TCPSocketWriter.setConfig');
    }
    if (config.host && config.port) {
        this.connectOptions = {host: config.host, port: config.port};
        if (config.bindIP) {
            this.connectOptions.localAddress = config.bindIP;
        }
        this.logName = [config.host, config.port].join(':');
    } else if (config.path) {
        this.connectOptions = {path: config.path};
        this.logName = config.path;
    } else {
        throw new TypeError('Missing one of ip/port or path in TCPSocketWriter.setConfig');
    }
    if (config.reconnectWait != null) {
        this.reconnectWait = config.reconnectWait;
    }
};
TCPSocketWriter.prototype.start = function(owner) {
    if (!this.connectOptions) {
        throw new Error('Cannot start unless TCPSocketWriter.setConfig was called first in TCPSocketWriter.start');
    }
    if (this.connected) {
        return;
    }
    this.owner = owner;
    if (!owner.isChild) {
        this.stop();
        return;
    }
    var oldSocket = this.socket;

    this.connected = true;
    this.socket = net.createConnection(this.connectOptions);
    this.drained = false;
    //todo: pass this in settings
    //todo: does this actually timeout connecting??
    this.socket.setTimeout(10 * 1000);
    this.socket.on('connect', this.onConnect.bind(this, this.socket));
    this.socket.on('drain', this.onDrain.bind(this, this.socket));
    this.socket.on('error', this.onError.bind(this, this.socket));
    this.socket.once('timeout', this.onTimeout.bind(this, this.socket));
    this.socket.once('end', this.onEnd.bind(this, this.socket));
    this.socket.once('close', this.onEnd.bind(this, this.socket));
    if (oldSocket) {
        oldSocket.end();
    }
};
TCPSocketWriter.prototype.onConnect = function(socket) {
    if (this.socket !== socket) return;
    this.socket.setNoDelay(true);
    this.socket.setTimeout(0);
    this.socket.resume(); //set to flowing mode but don't care about getting any of the data
    this.drain();
    this.emit('start');
};
TCPSocketWriter.prototype.onTimeout = function(socket) {
    //any socket that times out we want to destroy, even if its not our current one
    socket.destroy();
    if (this.socket === socket) {
        log('Timeout on tcp socket', this.logName);
    }
};
TCPSocketWriter.prototype.onEnd = function(socket) {
    if (this.socket !== socket) return;
    if (this.pendingConnect) {
        clearTimeout(this.pendingConnect);
    }
    log('Disconnect on tcp socket', this.logName);
    this.clearSocket();
    if (this.reconnectWait < 0) {
        return;
    }
    this.pendingConnect = setTimeout(this.start.bind(this, this.owner), this.reconnectWait);
};
//note: if you don't listen for error then node will throw
TCPSocketWriter.prototype.onError = function(socket, error) {
    if (this.socket !== socket) return;
    this.emit('error', error);
};
TCPSocketWriter.prototype.onDrain = function(socket) {
    if (this.socket !== socket) return;
    this.drain();
};
TCPSocketWriter.prototype.write = function(message) {
    if (!this.socket || !this.drained || !this.socket.writable) {
        this.queue(message);
        return false;
    }
    //if write returns false that means that it couldn't flush it immediately so set that we're not drained
    if (!this.socket.write(message)) {
        this.drained = false;
    }
    return true;
};
TCPSocketWriter.prototype.clearSocket = function() {
    var socket = this.socket;
    this.connected = false;
    if (socket) {
        this.socket = null;
        socket.end();
        socket.removeAllListeners();
        socket.on('error', noop); //don't let it throw an error after we already destroyed it
    }
};
TCPSocketWriter.prototype.stop = function() {
    if (this.pendingConnect) {
        clearTimeout(this.pendingConnect);
    }
    this.clearSocket();
};
module.exports = TCPSocketWriter;
