var events = require('events'),
    util = require('util'),
    reload = require('require-reload')(require),
    EntryPool = require('entrypool'),
    RingBuffer = require('ringbufferjs'),
    maxConnectionsAllowed = 3, //max concurrent connections per IP
    maxMessagesAllowed = 5, //max messages allowed per timeframe
    maxMessagesTimeframe = 60 * 1000,
    idleTimeout = 5 * 1000,
    messageOptions = {};

function Child(oldChild) {
    events.EventEmitter.call(this);
    this.started = false;

    if (oldChild !== undefined) {
        this.started = oldChild.started;
        this.config = oldChild.config;
        this.server = oldChild.server;
        this.setupServerListeners();
        this.connectionsPerIP = oldChild.connectionsPerIP;
        this.messagesPerIP = oldChild.messagesPerIP;
        this.maxConnectionsAllowed = oldChild.maxConnectionsAllowed;
        this.pool = oldChild.pool;
        this.buffer = oldChild.buffer;
        this.formatters = oldChild.formatters;
        if (!this.setMaxConnectionsAllowed(maxConnectionsAllowed)) {
            console.log('Failed to set new maxConnectionsAllowed!', this.maxConnectionsAllowed, maxConnectionsAllowed);
        }
        this.maxMessagesAllowed = oldChild.maxMessagesAllowed;
        if (!this.setMaxMessagesAllowed(maxMessagesAllowed)) {
            console.log('Failed to set new maxMessagesAllowed!', this.maxMessagesAllowed, maxMessagesAllowed);
        }
        this.maxMessagesTimeframe = oldChild.maxMessagesTimeframe;
        if (!this.setMaxMessagesTimeframe(maxMessagesTimeframe)) {
            console.log('Failed to set new maxMessagesTimeframe!', this.maxMessagesTimeframe, maxMessagesTimeframe);
        }
        if (oldChild.writer) {
            this.replaceWriter();
        }
        clearInterval(oldChild.gc);
        this.startGCInterval();
    }
}
util.inherits(Child, events.EventEmitter);

Child.prototype.start = function() {
    if (this.started) {
        return;
    }
    var portluck = reload('portluck');
    this.server = new portluck.Server();
    this.server.timeout = idleTimeout;
    this.setupServerListeners();
    this.connectionsPerIP = {};
    this.messagesPerIP = {};
    this.maxConnectionsAllowed = maxConnectionsAllowed;
    this.maxMessagesAllowed = maxMessagesAllowed;
    this.maxMessagesTimeframe = maxMessagesTimeframe;
    this.pool = new EntryPool(500, Math.max(this.maxConnectionsAllowed, this.maxMessagesAllowed));
    this.role = '';
    this.started = true;
    this.buffer = new RingBuffer(100);
    this.startGCInterval();
    if (this.config && this.config.writer) {
        this.replaceWriter();
    }
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
Child.prototype.onClientMessage = function(message, socket) {
    var ip = socket._remoteAddress,
        now = Date.now();
    if (this.messagesPerIP[ip] === undefined) {
        this.messagesPerIP[ip] = this.pool.get();
    }
    if (EntryPool.numEntries(this.messagesPerIP[ip]) >= this.maxMessagesAllowed) {
        console.log('dropping message from', ip);
        return;
    }
    //remove any entries
    EntryPool.addEntry(this.messagesPerIP[ip], now);
    this.writeAndSend(message, ip, now);
};
Child.prototype.writeAndSend = function(msg, ip, timestamp) {
    var message = msg,
        lastFormatter, i;
    messageOptions.ip = ip;
    messageOptions.timestamp = timestamp;
    if (this.formatters) {
        try {
            for (i = 0; i < this.formatters.length; i++) {
                lastFormatter = this.formatters[i].type;
                message = this.formatters[i].format(message, messageOptions);
            }
        } catch (e) {
            console.log('Error formatting message from', lastFormatter, ':', e.message);
            return false;
        }
    }
    if (!this.writer || !this.writer.write(message)) {
        this.buffer.enq(message);
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
Child.prototype.onServerHandle = function(handle) {
    var server = this.server;
    if (server.listening) {
        console.log('Cannot set the handle again for a server');
        return;
    }
    server.listen(handle, function() {
        server.listening = true;
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
Child.prototype.setupWriterListeners = function() {
    this.writer.removeAllListeners('connect').on('connect', this.onWriterDrain.bind(this));
    this.writer.removeAllListeners('drain').on('drain', this.onWriterDrain.bind(this));
    this.writer.removeAllListeners('disconnect').on('disconnect', this.onWriterDisconnect.bind(this));
    this.writer.removeAllListeners('error').on('error', this.onWriterError.bind(this));
};
Child.prototype.onWriterDrain = function() {
    while (!this.buffer.isEmpty()) {
        if (!this.writer.write(this.buffer.deq())) {
            break;
        }
    }
};
Child.prototype.onWriterDisconnect = function() {
    if (this.pendingWriterConnect) {
        clearTimeout(this.pendingWriterConnect);
    }
    this.writer.stop();
    //wait 5 seconds before trying to reconnect
    this.pendingWriterConnect = setTimeout(this.writerStart.bind(this), 5000);
};
Child.prototype.onWriterError = function(err) {
    console.log('Writer error in child ' + err.message);
};
Child.prototype.writerStart = function() {
    if (!this.writer) {
        throw new Error("No writer to start in Child.writerStart");
    }
    //true since we're a child
    this.setupWriterListeners();
    this.writer.start(true);
};
Child.prototype.replaceWriter = function() {
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
Child.prototype.setConfig = function(config) {
    if (!config) {
        throw new TypeError('Invalid config passed to Child.setConfig');
    }
    var formatters, f;
    this.config = config;
    if (this.role !== config.role) {
        this.setRole(config.role);
    }
    if (config.writer && this.started) {
        this.replaceWriter();
    }
    if (config.formatters) {
        if (!Array.isArray(config.formatters)) {
            throw new TypeError('Invalid config.formatters passed to Child.setConfig');
        }
        formatters = [];
        config.formatters.forEach(function(formatter) {
            if (typeof formatter === 'string') {
                f = new (reload('./formatters/' + formatter))();
                f.type = formatter;
            } else {
                f = new (reload('./formatters/' + formatter.type))(formatter);
                f.type = formatter.type;
            }
            formatters.push(f);
        });
        this.formatters = formatters;
    }
};
Child.prototype.handleParentMessage = function(message, handle) {
    var config;
    switch (message[0]) {
        case 'a': //response to ping with the server handle
            config = JSON.parse(message.substr(1));
            this.setConfig(config);
            this.onServerHandle(handle);
            break;
        case 'e': //asking for our connection count
            this.reportConnectionCount();
            break;
        case 'f': //new config!
            try {
                config = JSON.parse(message.substr(1));
                this.setConfig(config);
                process.send('fok');
            } catch (e) {
                process.send('f' + e.message);
            }
            break;
    }
};

module.exports = Child;
