var reload = require('require-reload')(require),
    EntryPool = require('entrypool'),
    maxConnectionsAllowed = 3, //max concurrent connections per IP
    maxMessagesAllowed = 5, //max messages allowed per timeframe
    maxMessagesTimeframe = 60 * 1000,
    idleTimeout = 5 * 1000;

function Child(oldChild) {
    if (oldChild !== undefined) {
        this.server = oldChild.server;
        this.setupServerListeners();
        this.connectionsPerIP = oldChild.connectionsPerIP;
        this.messagesPerIP = oldChild.messagesPerIP;
        this.maxConnectionsAllowed = oldChild.maxConnectionsAllowed;
        this.pool = oldChild.pool;
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
        clearInterval(oldChild.gc);
        this.startGCInterval();
    }
}
Child.prototype.start = function() {
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
Child.prototype.handleParentMessage = function(message, handle) {
    switch (message[0]) {
        case 'a': //response to ping with the server handle
            this.onServerHandle(handle);
            break;
        case 'e': //asking for our connection count
            this.reportConnectionCount();
            break;
    }
};

module.exports = Child;