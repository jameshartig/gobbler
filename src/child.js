var util = require('util'),
    reload = require('require-reload')(require),
    EntryPool = require('entrypool'),
    log = require('./log.js'),
    WriterHandler = reload('./writerHandler.js'),
    defaultLimits = {
        persistantConns: 10,
        messages: 100,
        messagesTimeframe: 60
    },
    idleTimeout = 5 * 1000,
    messageOptions = {},
    _RATE_LIMITED_ = "rate_limited\n",
    _INVALID_PAYLOAD_ = "invalid_payload\n";

function Child(oldChild) {
    WriterHandler.call(this, oldChild);
    this.isParent = false;
    this.isChild = true;

    if (oldChild !== undefined) {
        this.started = oldChild.started;
        this.config = oldChild.config;
        this.server = oldChild.server;
        this.setupServerListeners();
        this.connectionsPerIP = oldChild.connectionsPerIP;
        this.messagesPerIP = oldChild.messagesPerIP;
        this.maxConnectionsAllowed = oldChild.maxConnectionsAllowed;
        this.pool = oldChild.pool;
        this.formatters = oldChild.formatters;
        this.maxMessagesAllowed = oldChild.maxMessagesAllowed;
        this.maxMessagesTimeframe = oldChild.maxMessagesTimeframe;
        this.clientLogLevel = oldChild.clientLogLevel || 0;
        clearInterval(oldChild.gc);
        this.startGCInterval();
    } else {
        this.server = new (reload('portluck')).Server();
        this.server.timeout = idleTimeout;
        this.connectionsPerIP = {};
        this.messagesPerIP = {};
        this.role = '';
        this.clientLogLevel = 0;
    }
}
util.inherits(Child, WriterHandler);
Child.prototype.call = function(context, oldChild) {
    Child.prototype.constructor.call(context, oldChild);
};

Child.prototype.start = function() {
    if (this.started) {
        return;
    }
    if (!this.config) {
        throw new Error('Cannot start child without a config');
    }
    this.started = true;
    this.setupServerListeners();
    this.createPool();
    this.startWriters();
};
Child.prototype.createPool = function(initialSize) {
    if (this.pool) {
        return;
    }
    var size = initialSize || 500;
    this.pool = new EntryPool(size, Math.max(this.maxConnectionsAllowed, this.maxMessagesAllowed));
    this.startGCInterval();
};
Child.prototype.startGCInterval = function() {
    if (this.gc) {
        clearInterval(this.gc);
    }
    //loop and garbage collect old message counts
    this.gc = setInterval(this.runGC.bind(this), 60 * 1000);
};
Child.prototype.setMaxConnectionsAllowed = function(newValue) {
    newValue = Number(newValue);
    if (!newValue || newValue < 1 || newValue > this.maxConnectionsAllowed) {
        return false;
    }
    this.maxConnectionsAllowed = newValue;
    return true;
};
Child.prototype.setMaxMessagesAllowed = function(newValue) {
    newValue = Number(newValue);
    if (!newValue || newValue < 1 || newValue > this.maxMessagesAllowed) {
        return false;
    }
    this.maxMessagesAllowed = newValue;
    return true;
};
Child.prototype.setMaxMessagesTimeframe = function(newValue) {
    newValue = Number(newValue);
    if (!newValue || newValue < 1 || newValue > this.maxMessagesTimeframe) {
        return false;
    }
    this.maxMessagesTimeframe = newValue * 60;
    return true;
};
Child.prototype.setRole = function(role) {
    this.role = role;
    if (role) {
        messageOptions.role = role;
    } else {
        delete messageOptions.role;
    }
    return true;
};
Child.prototype.setClientLogLevel = function(level) {
    this.clientLogLevel = Number(level) || 0;
    return true;
};
Child.prototype.flushTrackedConnections = function() {
    for (var ip in this.connectionsPerIP) {
        this.pool.put(this.connectionsPerIP[ip]);
    }
    this.connectionsPerIP = {};
};
Child.prototype.flushTrackedMessages = function() {
    for (var ip in this.messagesPerIP) {
        this.pool.put(this.messagesPerIP[ip]);
    }
    this.messagesPerIP = {};
};
Child.prototype.setupServerListeners = function() {
    this.server.removeAllListeners('clientConnect').on('clientConnect', this.onClientConnect.bind(this));
    this.server.removeAllListeners('clientDisconnect').on('clientDisconnect', this.onClientDisconnect.bind(this));
    this.server.removeAllListeners('message').on('message', this.onClientMessage.bind(this));
    this.server.removeAllListeners('error').on('error', this.onServerError.bind(this));
};
Child.prototype.onClientConnect = function(socket) {
    var ip = socket.remoteAddress,
        now = Date.now();
    //node removes the ip when it disconnects which means we can't get the ip after close
    socket._remoteAddress = ip;
    socket._tsConnected = now;
    if (this.connectionsPerIP[ip] === undefined) {
        this.connectionsPerIP[ip] = this.pool.get();
    } else {
        if (EntryPool.numEntries(this.connectionsPerIP[ip]) >= this.maxConnectionsAllowed) {
            socket.end();
            return;
        }
    }
    //remove any entries from more than 5 minutes ago
    EntryPool.addEntry(this.connectionsPerIP[ip], now);
};
Child.prototype.onClientDisconnect = function(socket) {
    var ip = socket._remoteAddress,
        now = Date.now();
    if (this.connectionsPerIP[ip] !== undefined) {
        if (EntryPool.removeEntry(this.connectionsPerIP[ip], socket._tsConnected)) {
            this.pool.put(this.connectionsPerIP[ip]);
            delete this.connectionsPerIP[ip];
        }
    }
    if (this.messagesPerIP[ip] !== undefined) {
        if (EntryPool.cleanupEntries(this.messagesPerIP[ip], now - this.maxMessagesTimeframe)) {
            this.pool.put(this.messagesPerIP[ip]);
            delete this.messagesPerIP[ip];
        }
    }
};
Child.prototype.onClientMessage = function(message, socket, writer) {
    var ip = socket._remoteAddress,
        now = Date.now(),
        err;
    if (this.messagesPerIP[ip] === undefined) {
        this.messagesPerIP[ip] = this.pool.get();
    }
    if (EntryPool.numEntries(this.messagesPerIP[ip]) >= this.maxMessagesAllowed) {
        log('dropping message from', ip);
        if (this.clientLogLevel > 1) {
            writer.write(_RATE_LIMITED_);
        }
        return;
    }
    //remove any entries
    EntryPool.addEntry(this.messagesPerIP[ip], now);
    messageOptions.ip = ip;
    messageOptions.timestamp = now;
    err = this.writeMessage(message, messageOptions);
    if (!err || this.clientLogLevel < 1) {
        return;
    }
    if (this.clientLogLevel > 1) {
        writer.write(err.message + "\n");
    } else {
        writer.write(_INVALID_PAYLOAD_);
    }
};
Child.prototype.runGC = function() {
    var cleanupIfBefore = Date.now() - this.maxMessagesTimeframe;
    for (var ip in this.messagesPerIP) {
        if (EntryPool.cleanupEntries(this.messagesPerIP[ip], cleanupIfBefore)) {
            this.pool.put(this.messagesPerIP[ip]);
            delete this.messagesPerIP[ip];
        }
    }
};
Child.prototype.onServerError = function(error) {
    log('Error listening to port!', error);
};
Child.prototype.onServerHandle = function(handle) {
    var server = this.server;
    if (server.listening) {
        log('Cannot set the handle again for a server');
        return;
    }
    var obj = {},
        err = handle.getsockname(obj);
    //via https://github.com/joyent/node/issues/2721 (and well actually via net.js:1173
    if (this.config && this.config.port && err === 0 && obj.port != this.config.port) {
        throw new Error('Server port is already in use ' + this.config.port, 'EADDRINUSE');
    }
    server.listening = true;
    server.listen(handle, function() {
        process.send('b');
    });
};
Child.prototype.reportConnectionCount = function() {
    if (!this.server || !this.server.listening) {
        process.send('e' + 0);
        return;
    }
    this.server.getConnections(function(err, count) {
        if (err) {
            process.send('e' + err.message);
            return;
        }
        process.send('e' + count);
    });
};
Child.prototype.setConfig = function(config) {
    if (!config) {
        throw new TypeError('Invalid config passed to Child.setConfig');
    }
    var formatters, name;
    this.config = config;
    if (this.role !== config.role) {
        this.setRole(config.role);
    }
    if (config.writers) {
        if (!Array.isArray(config.writers)) {
            throw new TypeError('Invalid config.writers passed to Child.setConfig');
        }
        this.setWriters(config.writers);
        if (this.started) {
            this.startWriters();
        }
    }
    if (config.formatters) {
        if (!Array.isArray(config.formatters)) {
            throw new TypeError('Invalid config.formatters passed to Child.setConfig');
        }
        //clear this out to prevent any key changes from leaving properties around
        messageOptions = {};
        this.setFormatters(config.formatters);
    }

    if (!config.limits) {
        config.limits = {};
    }
    for (name in defaultLimits) {
        if (defaultLimits.hasOwnProperty(name) && !config.limits[name]) {
            config.limits[name] = defaultLimits[name];
        }
    }
    if (!this.setMaxConnectionsAllowed(config.limits.persistantConns)) {
        throw new Error('Cannot set limit of persistantConns. ' + config.limits.persistantConns + ' is either higher than the current value or less than 1');
    }
    if (!this.setMaxMessagesAllowed(config.limits.messages)) {
        throw new Error('Cannot set limit of messages. ' + config.limits.messages + ' is either higher than the current value or less than 1');
    }
    if (!this.setMaxMessagesTimeframe(config.limits.messagesTimeframe)) {
        throw new Error('Cannot set limit of messagesTimeframe. ' + config.limits.messagesTimeframe + ' is either higher than the current value or less than 1');
    }
    if (config.clientLogLevel !== undefined) {
        this.setClientLogLevel(config.clientLogLevel);
    }
};
Child.prototype.handleParentMessage = function(message, handle) {
    var config;
    switch (message[0]) {
        case 'a': //response to ping with the server handle
            config = message.substr(1);
            log('Child received config', config);
            config = JSON.parse(config);
            this.setConfig(config);
            this.onServerHandle(handle);
            this.start();
            break;
        case 'e': //asking for our connection count
            this.reportConnectionCount();
            break;
        case 'f': //new config!
            try {
                config = message.substr(1);
                log('Child received config', config);
                config = JSON.parse(config);
                this.setConfig(config);
                process.send('fok');
            } catch (e) {
                process.send('f' + e.message);
            }
            break;
    }
};

module.exports = Child;
