var util = require('util'),
    net = require('net'),
    log = require('../log.js'),
    ws = require('ws'),
    //for anything that is NOT internal require's you should use reload(moduleName) so it gets hot-reloaded
    reload = require('require-reload')(require),
    portluck = reload('portluck'),
    BaseWriter = reload('./base.js'),
    TCPSocketWriter = reload('./tcpSocket.js'),
    noop = function(){};

function WebsocketServerWriter(oldWriter) {
    BaseWriter.call(this);
    if (oldWriter) {
        this.owner = oldWriter.owner;
        this.internalServer = oldWriter.internalServer;
        this.wsServer = oldWriter.wsServer;
        this.serverOptions = oldWriter.serverOptions;
        this.wsClients = oldWriter.wsClients;
        this.internalPort = oldWriter.internalPort;
        this.logName = oldWriter.logName;
        this.restartWait = oldWriter.restartWait;
        this.socketWriter = oldWriter.socketWriter;
        if (this.socketWriter) {
            this.startSocket();
        }
    } else {
        this.connected = false;
        this.restartWait = 1000; //default to restart in one second (set to -1 to disable)
        this.logName = 'unknown';
        this.internalServer = null;
        this.wsServer = null;
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
};

WebsocketServerWriter.prototype.startWebsocketServer = function() {
    if (!this.serverOptions) {
        throw new Error('Cannot startWebsocketServer unless WebsocketServerWriter.setConfig was called first');
    }
    this.logName = 'ws://' + ([this.serverOptions.ip, this.serverOptions.port].join(':'));
    if (!this.wsServer) {
        this.wsClients = [];
        this.wsServer = new ws.Server({host: this.serverOptions.ip, port: this.serverOptions.port});
        this.wsServer.on('error', this.emitWSServerEvent.bind(this, this.wsServer, 'error'));
        log('Websocket server is listening on', [this.serverOptions.ip, this.serverOptions.port].join(':'));
        //todo: if this crashes we should try to restart it?
    }
    this.wsServer.removeAllListeners('connection').on('connection', function(ws) {
        var _this = this;
        this.wsClients.push(ws);
        //ignore any data we get
        ws.once('close', function() {
            var index = _this.wsClients.indexOf(ws);
            if (index > -1) {
                _this.wsClients.splice(index, 1);
            }
        });
    }.bind(this));
};
WebsocketServerWriter.prototype.emitWSServerEvent = function(server) {
    if (this.wsServer !== server) return;
    this.emit.apply(this, Array.prototype.slice.call(arguments, 1));
};
WebsocketServerWriter.prototype.startInternalServer = function() {
    if (!this.internalPort) {
        throw new Error('Cannot startInternalServer unless WebsocketServerWriter.setConfig was called first');
    }
    if (!this.internalServer) {
        this.internalServer = new portluck.Server();
        this.internalServer.timeout = 0;
        this.internalServer.on('message', this.broadcastMessage.bind(this));
        this.internalServer.on('error', this.emitInternalServerEvent.bind(this, this.internalServer, 'error'));
        this.internalServer.listen(this.internalPort, '127.0.0.1', function() {
            log('Internal server is listening on port', this.internalPort);
            this.emit('start');
        }.bind(this));
        //todo: if this crashes we should try to restart it? (just do that when we can autogenerate ports)
    }
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
            this.wsClients[i].send(message, {binary: false});
        } catch (e) {}
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
WebsocketServerWriter.prototype.stop = function(owner) {
    if (this.socketWriter) {
        this.socketWriter.stop(owner);
    }
};
module.exports = WebsocketServerWriter;
