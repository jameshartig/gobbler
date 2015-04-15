var util = require('util'),
    reload = require('require-reload')(require),
    EntryPool = require('entrypool'),
    log = require('./log.js'),
    WriterHandler = reload('./writerHandler.js'),
    defaultLimits = {
        persistantConns: 10,
        messages: 100,
        messagesTimeframe: 60, //in seconds
        logs: 25, //reset every 5 minutes
        initialPoolSize: 100
    },
    idleTimeout = 15 * 1000,
    logRateLimitTimeframe = 5 * 60 * 1000,
    connectionLimitReset = 12 * 60 * 60 * 1000, //automatically GC connections from limits after 12 hours
    messageLogCharacterLimit = 250,
    messageOptions = {},
    _RATE_LIMITED_ = 'rate_limited\n',
    _INVALID_PAYLOAD_ = 'invalid_payload\n',
    arraySocketErrResponse = new Array(2);
arraySocketErrResponse[1] = '\n';

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
        this.rateLimitLogsPerIP = oldChild.rateLimitLogsPerIP;
        this.maxConnectionsAllowed = oldChild.maxConnectionsAllowed;
        this.maxMessagesAllowed = oldChild.maxMessagesAllowed;
        this.maxMessagesTimeframe = oldChild.maxMessagesTimeframe;
        this.maxLogsAllowed = oldChild.maxLogsAllowed;
        this.disableClientLimits = oldChild.disableClientLimits;
        this.pool = oldChild.pool;
        this.formatters = oldChild.formatters;
        this.clientLogLevel = oldChild.clientLogLevel || 0;
        if (oldChild.gc) {
            this.gc = oldChild.gc;
            this.startGCInterval();
        }
    } else {
        this.connectionsPerIP = {};
        delete this.connectionsPerIP.a; //don't let V8 try to make a hidden class
        this.messagesPerIP = {};
        delete this.messagesPerIP.a; //don't let V8 try to make a hidden class
        this.rateLimitLogsPerIP = {};
        delete this.rateLimitLogsPerIP.a; //don't let V8 try to make a hidden class
        this.role = '';
        this.clientLogLevel = 0;
        this.pool = null;
        this.disableClientLimits = false;
        this.gc = null;
        this.maxMessagesAllowed = 100;
        this.maxMessagesTimeframe = 60 * 1000;
        this.maxConnectionsAllowed = 10;
        this.maxLogsAllowed = 10;
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
Child.prototype.stop = function() {
    if (!this.started) {
        return;
    }
    this.stopWriters();
};
Child.prototype.createPool = function(initialSize) {
    if (this.pool || this.disableClientLimits) {
        return;
    }
    //add one to maxLogsAllowed since we log when they hit maxLogsAllowed
    var size = initialSize,
        arraySize = Math.max(this.maxConnectionsAllowed, this.maxMessagesAllowed, this.maxLogsAllowed + 1);
    if ((!size || size < 1) && this.config != null) {
        size = this.config.limits.initialPoolSize;
    }
    this.pool = new EntryPool(Math.max(10, size), arraySize);
    this.startGCInterval();
};
Child.prototype.startGCInterval = function() {
    if (this.gc) {
        clearInterval(this.gc);
    }
    //loop and garbage collect old message counts
    this.gc = setInterval(this.runGC.bind(this), 60 * 1000);
};

Child.prototype.checkDisablePool = function() {
    if (this.maxConnectionsAllowed === 0 && this.maxMessagesAllowed === 0) {
        this.disableClientLimits = true;
        this.flushTrackedConnections();
        this.flushTrackedMessages();
        this.flushLogRateLimits();
        this.pool = null;
    } else {
        this.disableClientLimits = false;
        if (this.started) {
            this.createPool();
        }
    }
};
Child.prototype.setMaxConnectionsAllowed = function(newValue) {
    newValue = Number(newValue);
    if (isNaN(newValue) || newValue < 0 || newValue > this.maxConnectionsAllowed) {
        return false;
    }
    if (newValue > 9999) {
        throw new Error('persistantConns is too large. Try something smaller than 10k');
    }
    this.maxConnectionsAllowed = newValue;
    this.checkDisablePool();
    return true;
};
Child.prototype.setMaxMessagesAllowed = function(newValue) {
    newValue = Number(newValue);
    if (isNaN(newValue) || newValue < 0 || newValue > this.maxMessagesAllowed) {
        return false;
    }
    if (newValue > 99999) {
        throw new Error('persistantConns is too large. Try something smaller than 100k');
    }
    this.maxMessagesAllowed = newValue;
    this.checkDisablePool();
    return true;
};
Child.prototype.setMaxMessagesTimeframe = function(newValue) {
    newValue = Number(newValue);
    if (!newValue || newValue < 0 || newValue > this.maxMessagesTimeframe) {
        return false;
    }
    this.maxMessagesTimeframe = newValue * 1000;
    return true;
};
Child.prototype.setMaxLogsAllowed = function(newValue) {
    newValue = Number(newValue);
    if (!newValue || newValue < 0 || newValue > this.maxLogsAllowed) {
        return false;
    }
    this.maxLogsAllowed = newValue;
    return true;
};
Child.prototype.setRole = function(role) {
    this.role = role;
    if (!role) {
        delete messageOptions.role;
    }
    return true;
};
Child.prototype.setClientLogLevel = function(level) {
    this.clientLogLevel = Number(level) || 0;
    return true;
};
Child.prototype.flushTrackedConnections = function() {
    if (this.pool !== null) {
        for (var ip in this.connectionsPerIP) {
            this.pool.put(this.connectionsPerIP[ip]);
        }
    }
    this.connectionsPerIP = {};
};
Child.prototype.flushTrackedMessages = function() {
    if (this.pool !== null) {
        for (var ip in this.messagesPerIP) {
            this.pool.put(this.messagesPerIP[ip]);
        }
    }
    this.messagesPerIP = {};
};
Child.prototype.flushLogRateLimits = function() {
    if (this.pool !== null) {
        for (var ip in this.rateLimitLogsPerIP) {
            this.pool.put(this.rateLimitLogsPerIP[ip]);
        }
    }
    this.rateLimitLogsPerIP = {};
};
Child.prototype.setupServerListeners = function() {
    if (!this.server) {
        return;
    }
    this.server.removeAllListeners('clientConnect').on('clientConnect', this.onClientConnect.bind(this));
    this.server.removeAllListeners('clientDisconnect').on('clientDisconnect', this.onClientDisconnect.bind(this));
    this.server.removeAllListeners('clientError').on('clientError', this.onClientError.bind(this));
    this.server.removeAllListeners('message').on('message', this.onClientMessage.bind(this));
    this.server.removeAllListeners('error').on('error', this.onServerError.bind(this));
};
Child.prototype.logIPRateLimitExceeded = function(logMessage, ip, sentMessage, cachedNow) {
    if (this.disableClientLimits) {
        return;
    }
    var now = cachedNow || Date.now(),
        numEntries = 0,
        limitArr = this.rateLimitLogsPerIP[ip];
    if (limitArr === undefined) {
        limitArr = this.rateLimitLogsPerIP[ip] = this.pool.get();
    } else {
        numEntries = EntryPool.numEntries(limitArr);
        if (numEntries > this.maxLogsAllowed) {
            return;
        }
        if (numEntries === this.maxLogsAllowed) {
            logMessage = 'Silently dropping messages/connections for 5 minutes';
            sentMessage = '';
        }
    }
    EntryPool.addEntry(limitArr, now);

    if (!sentMessage) {
        log(logMessage, ip);
    } else {
        //only print the first x chars to prevent a dos attack by sending huge strings
        log(logMessage, 'IP:', ip, 'Message:', (sentMessage.toString()).substr(0, messageLogCharacterLimit));
    }
};
Child.prototype.onClientConnect = function(writer, socket) {
    var ip = socket.remoteAddress,
        now = Date.now(),
        numEntries = 0,
        limitArr;
    //node removes the ip when it disconnects which means we can't get the ip after close
    socket._remoteAddress = ip;
    socket._tsConnected = now;
    if (!this.disableClientLimits) {
        limitArr = this.connectionsPerIP[ip];
        if (limitArr === undefined) {
            limitArr = this.connectionsPerIP[ip] = this.pool.get();
        } else {
            numEntries = EntryPool.numEntries(limitArr);
            if (numEntries >= this.maxConnectionsAllowed) {
                this.logIPRateLimitExceeded('conn_drop from', ip, '', now);
                socket.end();
                return;
            }
        }
        EntryPool.addEntry(limitArr, now);
    }
};
Child.prototype.onClientDisconnect = function(socket) {
    var ip = socket.remoteAddress || socket._remoteAddress,
        now = Date.now();
    if (this.connectionsPerIP[ip] !== undefined) {
        if (EntryPool.removeEntry(this.connectionsPerIP[ip], socket._tsConnected)) {
            if (this.pool !== null) {
                this.pool.put(this.connectionsPerIP[ip]);
            }
            delete this.connectionsPerIP[ip];
        }
    }
    if (this.messagesPerIP[ip] !== undefined) {
        if (EntryPool.cleanupEntries(this.messagesPerIP[ip], now - this.maxMessagesTimeframe) === 0) {
            if (this.pool !== null) {
                this.pool.put(this.messagesPerIP[ip]);
            }
            delete this.messagesPerIP[ip];
        }
    }
    if (this.rateLimitLogsPerIP[ip] !== undefined) {
        if (EntryPool.cleanupEntries(this.rateLimitLogsPerIP[ip], now - logRateLimitTimeframe) === 0) {
            if (this.pool !== null) {
                this.pool.put(this.rateLimitLogsPerIP[ip]);
            }
            delete this.rateLimitLogsPerIP[ip];
        }
    }
};
Child.prototype.onClientMessage = function(message, writer, socket) {
    var ip = socket.remoteAddress || socket._remoteAddress,
        now = Date.now(),
        numEntries = 0,
        err, additionalWriters, limitArr;
    if (!this.disableClientLimits) {
        limitArr = this.messagesPerIP[ip];
        if (limitArr === undefined) {
            limitArr = this.messagesPerIP[ip] = this.pool.get();
        }
        //theoretically we should be doing a cleanupEntries here but we let the GC take care of cleaning up
        numEntries = EntryPool.numEntries(limitArr);
        if (numEntries >= this.maxMessagesAllowed) {
            this.logIPRateLimitExceeded('msg_drop from', ip, message, now);
            if (this.clientLogLevel > 1) {
                writer.write(_RATE_LIMITED_);
            }
            return;
        }
        //remove any entries
        EntryPool.addEntry(limitArr, now);
    }
    messageOptions.ip = ip;
    messageOptions.timestamp = now;
    messageOptions.role = this.role;
    if (this.clientLogLevel > 2) {
        additionalWriters = [writer];
    }
    err = this.writeMessage(message, messageOptions, additionalWriters);
    if (err) {
        this.logIPRateLimitExceeded(err, ip, message, now);
        if (this.clientLogLevel > 1) {
            arraySocketErrResponse[1] = err;
            writer.write(arraySocketErrResponse.join(''));
        } else if (this.clientLogLevel > 0) {
            writer.write(_INVALID_PAYLOAD_);
        }
    }
};
Child.prototype.onClientError = function(error) {
    //ignore common reset errors
    if (error === 'ECONNRESET' || ((error instanceof Error) && error.code === 'ECONNRESET')) {
        return;
    }
    log('Error from client', error);
};
Child.prototype.runGC = function() {
    var now = Date.now(),
        cleanupIfBefore = now - this.maxMessagesTimeframe,
        ip;
    for (ip in this.messagesPerIP) {
        if (EntryPool.cleanupEntries(this.messagesPerIP[ip], cleanupIfBefore) === 0) {
            if (this.pool !== null) {
                this.pool.put(this.messagesPerIP[ip]);
            }
            delete this.messagesPerIP[ip];
        }
    }
    cleanupIfBefore = now - logRateLimitTimeframe;
    for (ip in this.rateLimitLogsPerIP) {
        if (EntryPool.cleanupEntries(this.rateLimitLogsPerIP[ip], cleanupIfBefore) === 0) {
            if (this.pool !== null) {
                this.pool.put(this.rateLimitLogsPerIP[ip]);
            }
            delete this.rateLimitLogsPerIP[ip];
        }
    }
    cleanupIfBefore = now - connectionLimitReset;
    for (ip in this.connectionsPerIP) {
        if (EntryPool.cleanupEntries(this.connectionsPerIP[ip], cleanupIfBefore) === 0) {
            if (this.pool !== null) {
                this.pool.put(this.connectionsPerIP[ip]);
            }
            delete this.connectionsPerIP[ip];
        }
    }
};
Child.prototype.onServerError = function(error) {
    log('Error listening to port!', error);
    process.exit();
};
Child.prototype.onServerHandle = function(handle) {
    var server = this.server,
        obj, err;
    if (server && server.listening) {
        log('Cannot set the handle again for a server');
        return;
    }
    if (!server) {
        if (!this.config) {
            throw new Error('Cannot start portluck server without a config');
        }
        server = new (reload('portluck')).Server(this.config.portluck);
        if (!this.config.portluck || this.config.portluck.timeout === undefined) {
            server.timeout = idleTimeout;
        }
        this.server = server;
        this.setupServerListeners();
    }
    //must sent an empty object to getsockname to get result on
    obj = {};
    err = handle.getsockname(obj);
    //via https://github.com/joyent/node/issues/2721 (and well actually via net.js:1173)
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
        if (defaultLimits.hasOwnProperty(name) && !config.limits.hasOwnProperty(name)) {
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
    if (!this.setMaxLogsAllowed(config.limits.logs)) {
        throw new Error('Cannot set limit of logs. ' + config.limits.logs + ' is either higher than the current value or less than 1');
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
