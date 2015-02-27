var events = require('events'),
    util = require('util'),
    net = require('net'),
    //for anything that is NOT internal require's you should use reload(moduleName) so it gets hot-reloaded
    reload = require('require-reload')(require);

function TCPSocketWriter(oldWriter) {
    events.EventEmitter.call(this);
    this.connected = false;

    //copy over any state to this new TCPSocketWriter
    if (oldWriter !== undefined) {
        this.connectOptions = oldWriter.connectOptions;
        //we are purposefully not copying over any socket connections since we will just re-make them in start
        //you can choose to do whatever you want though in your own writer
    }
}
util.inherits(TCPSocketWriter, events.EventEmitter);

TCPSocketWriter.prototype.setConfig = function(config) {
    if (!config) {
        throw new TypeError('Invalid config passed to TCPSocketWriter.setConfig');
    }
    if (config.host && config.port) {
        this.connectOptions = {host: config.host, port: config.port};
        if (config.bindIP) {
            this.connectOptions.localAddress = config.bindIP;
        }
    } else if (config.path) {
        this.connectOptions = {path: config.path};
    } else {
        throw new TypeError('Missing one of ip/port or path in TCPSocketWriter.setConfig');
    }
};
TCPSocketWriter.prototype.start = function(fromChild) {
    if (!this.connectOptions) {
        throw new Error('Cannot start unless TCPSocketWriter.setConfig was called first in TCPSocketWriter.start');
    }
    if (!fromChild || this.connected) {
        return;
    }
    var oldSocket = this.socket;
    this.socket = net.createConnection(this.connectOptions);
    //todo: pass this in settings
    this.socket.setTimeout(10 * 1000);
    this.socket.on('connect', this.onConnect.bind(this, this.socket));
    this.socket.on('timeout', this.onTimeout.bind(this, this.socket));
    this.socket.on('end', this.onEnd.bind(this, this.socket));
    this.socket.on('close', this.onEnd.bind(this, this.socket));
    this.socket.on('drain', this.onDrain.bind(this, this.socket));
    this.socket.on('error', this.onError.bind(this, this.socket));
    if (oldSocket) {
        oldSocket.end();
    }
};
TCPSocketWriter.prototype.onConnect = function(socket) {
    if (this.socket !== socket) return;
    this.connected = true;
    this.socket._drained = true;
    this.socket.setNoDelay(true);
    this.socket.setTimeout(0);
    this.socket.resume(); //set to flowing mode but don't care about getting any of the data
    this.emit('connect');
};
TCPSocketWriter.prototype.onTimeout = function(socket) {
    //any socket that times out we want to destroy, even if its not our current one
    if (socket) {
        socket.destroy();
    }
};
TCPSocketWriter.prototype.onEnd = function(socket) {
    if (this.socket !== socket) return;
    this.connected = false;
    this.emit('disconnect');
};
//note: if you don't listen for error then node will throw
TCPSocketWriter.prototype.onError = function(socket, error) {
    if (this.socket !== socket) return;
    this.emit('error', error);
};
TCPSocketWriter.prototype.onDrain = function(socket) {
    if (this.socket !== socket) return;
    this.socket._drained = true;
    this.emit('drain');
};
TCPSocketWriter.prototype.write = function(message) {
    if (!this.socket || !this.socket._drained || !this.socket.writable) {
        return false;
    }
    //if write returns false that means that it couldn't flush it immediately so set that we're not drained
    if (!this.socket.write(new Buffer(message))) {
        this.socket._drained = false;
    }
    return true;
};
TCPSocketWriter.prototype.stop = function() {
    this.connected = false;
    if (this.socket) {
        this.socket.end();
    }
};
module.exports = TCPSocketWriter;
