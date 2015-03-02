var util = require('util'),
    net = require('net'),
    log = require('../log.js'),
    ws = require('ws'),
    RingBuffer = require('ringbufferjs'),
    //for anything that is NOT internal require's you should use reload(moduleName) so it gets hot-reloaded
    reload = require('require-reload')(require),
    portluck = reload('portluck'),
    BaseWriter = reload('./base.js'),
    TCPSocketWriter = reload('./tcpSocket.js'),
    noop = function(){};

//pulled from https://github.com/janogonzalez/ringbufferjs/pull/1
RingBuffer.prototype.peek = function(count) {
    if (this.isEmpty()) throw new Error('RingBuffer is empty');

    if (count === undefined) return this._elements[this._first];

    count = Math.min(count, this.size());
    var results = new Array(count);
    for (var i = this._first, c = 0; c < count; i++, c++) {
        if (i >= this.capacity()) i = 0; // Wrap around to the beginning
        results[c] = this._elements[i];
    }
    return results;
};

function WebsocketServerWriter(oldWriter) {
    BaseWriter.call(this);
    if (oldWriter) {
        this.owner = oldWriter.owner;
        this.internalServer = oldWriter.internalServer;
        //clear out the properties on the old writer so they don't get killed on reload on this writer
        oldWriter.internalServer = null;
        this.wsServer = oldWriter.wsServer;
        oldWriter.wsServer = null;
        this.wsClients = oldWriter.wsClients;
        oldWriter.wsClients = null;
        this.serverOptions = oldWriter.serverOptions;
        this.internalPort = oldWriter.internalPort;
        this.logName = oldWriter.logName;
        this.restartWait = oldWriter.restartWait;
        this.sendPrevious = oldWriter.sendPrevious;
        this.socketWriter = oldWriter.socketWriter;
        if (this.socketWriter) {
            this.startSocket();
        }
    } else {
        this.connected = false;
        this.restartWait = 1000; //default to restart in one second (set to -1 to disable)
        this.logName = 'unknown';
        this.sendPrevious = 0;
        this.previousMessages = null;
        this.internalServer = null;
        this.wsServer = null;
        this.wsClients = null;
        this.socketWriter = null;
    }
}
util.inherits(WebsocketServerWriter, BaseWriter);
WebsocketServerWriter.prototype.call = function(context) {
    WebsocketServerWriter.prototype.constructor.call(context);
};

WebsocketServerWriter.prototype.setConfig = function(config) {
    if (!config) {
        throw new TypeError('Invalid config passed to WebsocketServerWriter.setConfig');
    }
    if (config.port) {
        if (!config.ip) {
            config.ip = '0.0.0.0';
        }
        this.serverOptions = {ip: config.ip, port: config.port};
    } else {
        throw new TypeError('Missing port in WebsocketServerWriter.setConfig');
    }
    if (!config.internalPort) {
        //todo: autogenerate a port and send it to the children
        config.internalPort = Number(config.port) + 1;
    }
    this.internalPort = config.internalPort;
    if (config.restartWait != null) {
        this.restartWait = config.restartWait;
    }
    if (config.sendPrevious != null && config.sendPrevious !== this.sendPrevious) {
        this.sendPrevious = config.sendPrevious;
        if (this.sendPrevious > 0) {
            this.previousMessages = new RingBuffer(this.sendPrevious);
        } else {
            this.previousMessages = null;
        }
    }
};

WebsocketServerWriter.prototype.startWebsocketServer = function() {
    if (!this.serverOptions) {
        throw new Error('Cannot startWebsocketServer unless WebsocketServerWriter.setConfig was called first');
    }
    this.logName = 'ws://' + ([this.serverOptions.ip, this.serverOptions.port].join(':'));
    if (!this.wsServer) {
        this.wsClients = [];
        this.wsServer = new ws.Server({host: this.serverOptions.ip, port: this.serverOptions.port});
        log('Websocket server is listening on', [this.serverOptions.ip, this.serverOptions.port].join(':'));
        //todo: if this crashes we should try to restart it?
    }
    this.wsServer.removeAllListeners('error').on('error', this.onWSServerError.bind(this, this.wsServer));
    this.wsServer.removeAllListeners('connection').on('connection', this.onNewWSClient.bind(this, this.wsServer));
};
WebsocketServerWriter.prototype.onNewWSClient = function(server, client) {
    if (this.wsServer !== server) return;
    var _this = this;
    this.wsClients.push(client);
    //ignore any data we get
    client.once('close', function() {
        if (!_this.wsClients) return;

        var index = _this.wsClients.indexOf(client);
        if (index > -1) {
            _this.wsClients.splice(index, 1);
        }
    });
    this.sendPreviousMessages(client);
};
WebsocketServerWriter.prototype.sendPreviousMessages = function(client) {
    if (!this.previousMessages || this.previousMessages.isEmpty()) {
        return;
    }
    var msgs = this.previousMessages.peek(this.previousMessages.size()),
        i;
    //if ringbuffer.peek(1) returns only the first one and not an array, don't loop
    if (msgs instanceof Buffer) {
        client.send(msgs, {binary: false});
        return;
    }
    for (i = 0; i < msgs.length; i++) {
        client.send(msgs[i], {binary: false});
    }
};
WebsocketServerWriter.prototype.onWSServerError = function(server) {
    if (this.wsServer !== server) return;
    server.removeAllListeners();
    try {
        this.destroyWSClients();
        server.close();
    } catch (e) {
        log('Failed to close errored wsServer:', e.message);
    }
    this.wsServer = null;
    //todo: retry starting it
    this.emit('error');
};
WebsocketServerWriter.prototype.startInternalServer = function() {
    if (!this.internalPort) {
        throw new Error('Cannot startInternalServer unless WebsocketServerWriter.setConfig was called first');
    }
    if (!this.internalServer) {
        this.internalServer = new portluck.Server();
        this.internalServer.timeout = 0;
        this.internalServer.on('error', this.emitInternalServerEvent.bind(this, this.internalServer, 'error'));
        this.internalServer.listen(this.internalPort, '127.0.0.1', function() {
            log('Internal server is listening on port', this.internalPort);
            this.emit('start');
        }.bind(this));
        //todo: if this crashes we should try to restart it? (just do that when we can autogenerate ports)
    }
    this.internalServer.removeAllListeners('error').on('error', this.emitInternalServerEvent.bind(this, this.internalServer, 'error'));
    this.internalServer.removeAllListeners('message').on('message', this.broadcastMessage.bind(this));
};
WebsocketServerWriter.prototype.emitInternalServerEvent = function(server) {
    if (this.internalServer !== server) return;
    this.emit.apply(this, Array.prototype.slice.call(arguments, 1));
};
WebsocketServerWriter.prototype.start = function(owner) {
    this.owner = owner;
    if (owner.isParent) {
        this.startWebsocketServer();
        this.startInternalServer();
        return;
    }
    if (owner.isChild) {
        this.startSocket();
    }
};
WebsocketServerWriter.prototype.startSocket = function() {
    if (!this.internalPort) {
        throw new Error('Cannot startSocket unless WebsocketServerWriter.setConfig was called first');
    }
    var oldWriter = this.socketWriter,
        writer = new TCPSocketWriter(oldWriter);
    if (oldWriter) {
        oldWriter.removeAllListeners();
    }
    this.socketWriter = writer;
    writer.setConfig({host: '127.0.0.1', port: this.internalPort});
    writer.on('start', this.onSocketStart.bind(this, writer));
    writer.on('error', this.emitSocketEvent.bind(this, writer, 'error'));
    this.logName = writer.logName;
    writer.start(this.owner);
};
WebsocketServerWriter.prototype.onSocketStart = function(writer) {
    if (this.socketWriter !== writer) return;
    this.drain();
    this.emit('start');
};
WebsocketServerWriter.prototype.emitSocketEvent = function(writer) {
    if (this.socketWriter !== writer) return;
    this.emit.apply(this, Array.prototype.slice.call(arguments, 1));
};
WebsocketServerWriter.prototype.broadcastMessage = function(message) {
    if (!this.wsClients) {
        return;
    }
    for (var i = 0; i < this.wsClients.length; i++) {
        try {
            if (this.wsClients[i].readyState !== ws.OPEN) {
                this.wsClients.splice(i, 1);
                i--;
                continue;
            }
            this.wsClients[i].send(message, {binary: false});
        } catch (e) {
            log('Error writing to websocket client:', e.message);
        }
    }
    if (this.previousMessages) {
        this.previousMessages.enq(message);
    }
};
WebsocketServerWriter.prototype.write = function(message) {
    if (!this.socketWriter) {
        this.queue(message);
        return false;
    }
    this.socketWriter.write(message);
    return true;
};
WebsocketServerWriter.prototype.destroyWSClients = function(owner) {
    if (this.wsClients) {
        for (var i = 0; i < this.wsClients.length; i++) {
            try {
                this.wsClients.destroy();
            } catch (e) {}
        }
    }
};
WebsocketServerWriter.prototype.stop = function(owner) {
    if (this.socketWriter) {
        this.socketWriter.stop(owner);
    }
    if (this.internalServer) {
        this.internalServer.close();
    }
    if (this.wsServer) {
        this.destroyWSClients();
        this.wsServer.close();
    }
};
module.exports = WebsocketServerWriter;
