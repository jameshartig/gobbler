var net = require('net'),
    fs = require('fs'),
    util = require('util'),
    path = require('path'),
    child_process = require('child-process-debug'),
    EntryPool = require('entrypool'),
    flags = require('flags'),
    dateFormat = require('dateformat'),
    log = require('./log.js'),
    ctrl = require('daemonctrl'),
    reload = require('require-reload')(require),
    numCPUs = require('os').cpus().length,
    isWindows = /^win/.test(process.platform),
    WriterHandler = reload('./writerHandler.js');

function cleanupListeners(pendingListeners, inMS) {
    if (!pendingListeners || !pendingListeners.length) {
        return;
    }
    var timeout = inMS !== undefined ? inMS : 5000;
    //remove the listeners if they happen to not have fired
    setTimeout(function() {
        pendingListeners.forEach(function(listener) {
            Function.prototype.call.apply(listener[0].removeListener, listener);
        });
    }, timeout);
}

function Parent() {
    WriterHandler.call(this);
    this.started = false;
    this.isParent = true;
    this.isChild = false;
    this.childrenByID = {};
}
util.inherits(Parent, WriterHandler);
Parent.prototype.call = function(context) {
    Parent.prototype.constructor.call(context);
};

Parent.prototype.parseFlags = function() {
    var f = flags;
    f.defineString('ip', '0.0.0.0', 'ip address to listen on');
    f.defineInteger('port', 80, 'port to listen on');
    f.defineInteger('children', numCPUs, 'number of children to start');
    f.defineString('role', '', 'the name of this gobbler instance');
    f.defineString('controlsock', isWindows ? '' : './control.sock', 'unix socket to listen to for reloading/restarting');
    f.defineString('config', './config.json', 'config file to load');
    //f.defineString('daemonize', 'no', 'should we daemonize? Cannot set this via config');
    //true: ignore unknown arguments
    f.parse(null, true);
    this.flags = f;
};
Parent.prototype.loadConfig = function() {
    if (!this.flags) {
        this.parseFlags();
    }
    this.config = {};
    var file = this.flags.get('config');
    if (file) {
        file = path.resolve(process.cwd(), file);
        if (fs.existsSync(file)) {
            this.config = reload(file);
            //todo: allow them to set daemon in the config
            delete this.config.daemonize;
        }
    }
    //overwrite any values in config with ones passed in
    for (var name in this.flags.FLAGS) {
        if (this.flags.FLAGS.hasOwnProperty(name) && (this.config[name] === undefined || this.flags.isSet(name))) {
            this.config[name] = this.flags.get(name);
        }
    }
    if (!this.config.writers && this.config.writer) {
        this.config.writers = [this.config.writer];
    }
    if (!this.config.formatters && this.config.formatter) {
        this.config.formatters = [this.config.formatter];
    }
    if (this.config.children < 1) {
        throw new Error('Invalid number of children');
    }
    if (this.config.writers) {
        if (!Array.isArray(this.config.writers)) {
            throw new TypeError('Invalid config.writers passed to Parent.loadConfig');
        }
        this.setWriters(this.config.writers);
        if (this.started) {
            this.startWriters();
        }
    }
};

Parent.prototype.spawnChild = function(responseSocket) {
    var now = Date.now(),
        childFilename = path.resolve(path.dirname(process.mainModule.filename), './startChild.js'),
        child;
    if (EntryPool.cleanupEntries(this.crashedTimes, (now - 5000)) === this.crashedTimes.length) {
        log('Children are crashing too quickly. Dying...');
        process.exit();
        return;
    }
    child = child_process.fork(childFilename);
    child_process.exitWithParent(child);
    this.childrenByID[child.pid] = child;
    child._id = child.pid;
    this.setupChildListeners(child);

    if (responseSocket) {
        this.eachChild(null, responseSocket, 'b');
    }
};
Parent.prototype.setupChildListeners = function(child) {
    child.removeAllListeners('message').on('message', this.onChildMessage.bind(this, child, process.stdout, null));
    child.removeAllListeners('disconnect').on('disconnect', this.onChildDisconnect.bind(this, child));
};
Parent.prototype.onChildMessage = function(child, responseSocket, waitingMessage, message) {
    var id = child._id,
        status, response;
    if (waitingMessage != null && message[0] !== waitingMessage) {
        return;
    }
    switch (message[0]) {
        case 'a': //initial ping which means i'm ready
            if (!this._ready) {
                child.send('a' + JSON.stringify(this.config), this.potluckHandle);
                child._ready = true;
            }
            break;
        case 'b': //server has started listening
            response = 'Child ' + id + ' is now listening!';
            break;
        case 'c': //status of reload
            status = message.substr(1);
            if (status === 'ok') {
                response = 'Child ' + id + ' has been reloaded!';
            } else {
                response = 'Child ' + id + ' failed to reload. Error: ' + status;
            }
            break;
        case 'd': //child shutdown
            delete this.childrenByID[id];
            response = 'Child ' + id + ' has been stopped!';
            break;
        case 'e': //connection count
            response = 'Child ' + id + ' connection count: ' + message.substr(1);
            break;
        case 'f': //response from new config
            status = message.substr(1);
            if (status === 'ok') {
                response = 'Child ' + id + ' reloaded config!';
            } else {
                response = 'Child ' + id + ' failed to reload config: ' + status;
            }
            break;
    }
    if (!response) {
        return;
    }
    responseSocket.write(dateFormat(new Date(), "[d-mmm-yy HH:MM:ss] ") + response + "\n");
    if (responseSocket._pendingResponses !== undefined) {
        responseSocket._pendingResponses--;
        if (responseSocket._pendingResponses === 0) {
            responseSocket._onLastPendingResponse();
        }
    }
};
Parent.prototype.onChildDisconnect = function(child) {
    var id = child._id;
    child.removeAllListeners();

    if (this.childrenByID[id]) {
        log('Child ' + id + ' disconnected. Restarting...');
        try {
            this.childrenByID[id].kill();
        } catch (e) {}
        delete this.childrenByID[id];
        EntryPool.addEntry(this.crashedTimes, Date.now());
        this.spawnChild();
    }
};
//waitingMessage is the char of the message you're waiting for
Parent.prototype.eachChild = function(cb, responseSocket, waitingMessage) {
    var pendingListeners = [],
        listener, child;
    for (var id in this.childrenByID) {
        if (!this.childrenByID.hasOwnProperty(id)) continue;
        child = this.childrenByID[id];
        if (responseSocket) {
            responseSocket._pendingResponses++;
            listener = [child, 'message', this.onChildMessage.bind(this, child, responseSocket, waitingMessage)];
            pendingListeners.push(listener);
            Function.prototype.call.apply(child.on, listener);
        }
        if (typeof cb === 'function') {
            cb(child);
        }
    }
    cleanupListeners(pendingListeners);
};
Parent.prototype.stopChildren = function(responseSocket) {
    var _this = this;
    this.eachChild(function(child) {
        delete _this.childrenByID[child._id];
        child.kill();
    }, responseSocket, 'd');
};
Parent.prototype.restartChildren = function(responseSocket) {
    this.stopChildren(responseSocket);
    for (var i = 0; i < this.config.children; i++) {
        this.spawnChild(responseSocket);
    }
};
Parent.prototype.reloadChildren = function(responseSocket) {
    this.eachChild(function(child) {
        child.kill('SIGHUP');
    }, responseSocket, 'c');
};
Parent.prototype.getChildrenConnectionCount = function(responseSocket) {
    this.eachChild(function(child) {
        child.send('e');
    }, responseSocket, 'e');
};
Parent.prototype.dispatchConfig = function(responseSocket) {
    var message = 'f' + JSON.stringify(this.config);
    this.eachChild(function(child) {
        child.send(message);
    }, responseSocket, 'f');
};

Parent.prototype.onControlCommand = function(command, commandArgs, socket) {
    //todo: we should use deferreds and chainloading instead of this
    socket._pendingResponses = 0;
    socket._onLastPendingResponse = function() {
        socket.end();
    };
    switch (command) {
        case 'reload':
            this.reloadChildren(socket);
            break;
        case 'restart':
            this.restartChildren(socket);
            break;
        case 'reloadconfig':
            try {
                this.loadConfig();
                this.dispatchConfig(socket);
            } catch (e) {
                socket.end('Failed to load new config: ' + e.message);
            }
            break;
        case 'status':
            if (this.role) {
                socket.write('Role: ' + this.role + "\n");
            }
            socket.write('Number of children: ' + (Object.keys(this.childrenByID)).length + "\n");
            this.getChildrenConnectionCount(socket);
            break;
        case 'shutdown':
        case 'exit':
            socket.write("Shutting down server...\n");
            this.stopChildren();
            process.nextTick(function() {
                process.exit();
            });
            break;
        default:
            socket.end('Invalid command "' + command + '"');
            break;
    }
};
Parent.prototype.stop = function() {
    this.stopChildren();
};

Parent.prototype.start = function() {
    var _this = this,
        controlSocket;
    this.started = true;

    if (!this.config) {
        this.loadConfig();
    } else {
        this.startWriters();
    }
    this.crashedTimes = new Array(Math.max(3, this.config.children));
    controlSocket = this.config.controlsock;
    if (!controlSocket) {
        this.startPotluckServer();
        return;
    }
    //if the file already exists we might already be running somewhere else
    fs.exists(controlSocket, function(exists) {
        if (!exists) {
            _this.startControlServer();
            return;
        }
        log(controlSocket + ' exists. Checking to see if instance is running');
        var conn = net.createConnection({path: controlSocket}, function() {
            log("An instance of gobbler is already running!\n");
            conn.end();
            process.exit();
        });
        conn.setTimeout(5000, function() {
            conn.destroy();
            log("Command socket already exists but node is dead.\n");
            fs.unlink(controlSocket, _this.startControlServer.bind(_this));
        });
        conn.on('error', function() {
            log("Command socket already exists but node is dead.\n");
            fs.unlink(controlSocket, _this.startControlServer.bind(_this));
        });
    });
};

Parent.prototype.startControlServer = function() {
    ctrl.listen(this.startPotluckServer.bind(this)).on('command', this.onControlCommand.bind(this));
};

Parent.prototype.startPotluckServer = function() {
    this.potluckHandle = net._createServerHandle(this.config.ip, this.config.port, 4);
    if (!(this.potluckHandle instanceof process.binding('tcp_wrap').TCP)) {
        log('Created invalid server handle! Maybe you can\'t listen on that port?');
        process.exit();
        return;
    }
    log('Started potluck server on ' + this.config.ip + ':' + this.config.port);
    //now actually start the initial children
    this.restartChildren();
};

module.exports = Parent;
