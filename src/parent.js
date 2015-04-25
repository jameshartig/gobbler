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
    ChainLoading = require('chainloading'),
    reload = require('require-reload')(require),
    numCPUs = require('os').cpus().length,
    isWindows = /^win/.test(process.platform),
    WriterHandler = reload('./writerHandler.js');

function Parent() {
    WriterHandler.call(this);
    this.started = false;
    this.isParent = true;
    this.isChild = false;
    this.childrenByID = {};
    this.nextResponseID = 1;
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

Parent.prototype.spawnChild = function(responseSocket, num) {
    var now = Date.now(),
        childFilename = path.resolve(path.dirname(process.mainModule.filename), './startChild.js'),
        pid, child, onMessage;
    //todo: don't always record this
    if (EntryPool.cleanupEntries(this.crashedTimes, (now - 5000)) >= this.crashedTimes.length) {
        log('server_error Children are crashing too quickly. Dying...');
        process.exit();
        return new Promise(function(resolve, reject) {reject();});
    }
    child = child_process.fork(childFilename);
    child_process.exitWithParent(child);
    pid = child.pid;
    this.childrenByID[pid] = child;
    child._id = pid;
    child._num = num;
    this.setupChildListeners(child);

    return new Promise(function(resolve) {
        onMessage = function(message, child, response) {
            if (message[0] !== 'b' || child.pid !== pid) {
                return;
            }
            this.removeListener('childMessage', onMessage);
            if (responseSocket) {
                responseSocket.write(response + '\n');
            }
            resolve();
        }.bind(this);
        this.addListener('childMessage', onMessage);
    }.bind(this));
};
Parent.prototype.setupChildListeners = function(child) {
    function writeToLog(message, tag) {
        if (tag) {
            log(tag, message);
        } else {
            log(message);
        }
    }
    child.removeAllListeners('message').on('message', this.onChildMessage.bind(this, child, writeToLog));
    child.removeAllListeners('disconnect').on('disconnect', this.onChildDisconnect.bind(this, child));
    child.removeAllListeners('exit').on('exit', this.onChildDisconnect.bind(this, child));
};
Parent.prototype.onChildMessage = function(child, onResponse, message) {
    var id = child._id,
        status, response, tag, parts;
    if (!message) {
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
            tag = 'child_started';
            break;
        case 'c': //status of reload
            status = message.substr(1);
            if (status === 'ok') {
                response = 'Child ' + id + ' has been reloaded!';
                tag = 'child_reloaded';
            } else {
                response = 'Child ' + id + ' failed to reload. Error: ' + status;
                tag = 'child_error';
            }
            break;
        case 'd': //child shutdown
            response = 'Child ' + id + ' has been stopped!';
            tag = 'child_stopped';
            break;
        case 'f': //response from new config
            status = message.substr(1);
            if (status === 'ok') {
                response = 'Child ' + id + ' reloaded config!';
                tag = 'child_reloaded';
            } else {
                response = 'Child ' + id + ' failed to reload config: ' + status;
                tag = 'child_error';
            }
            break;
        case 'r': //response to request
            parts = message.substr(1).split('|');
            if (!parts[0]) {
                log('Invalid response to child request:', message);
                return;
            }
            //if there were any pipe chars in the rest of the response, put them back
            this.emit('response:' + parts[0], parts.slice(1).join('|'), child);
            break;
    }
    if (!response) {
        return;
    }
    this.emit('childMessage', message, child, response);
    onResponse(response, tag);
};
Parent.prototype.onChildDisconnect = function(child) {
    var id = child._id;
    child.removeAllListeners();

    if (this.childrenByID[id]) {
        log('child_disconnect Child ' + id + ' disconnected. Restarting...');
        //todo: emit here and fake a message so anything waiting for this child stops
        delete this.childrenByID[id];
        try {
            child.kill();
        } catch (e) {}
        EntryPool.addEntry(this.crashedTimes, Date.now());
        this.spawnChild(null, child._num);
    }
};

Parent.prototype.getNextResponseID = function() {
    var id = this.nextResponseID;
    this.nextResponseID++;
    if (this.nextResponseID >= 1024) {
        this.nextResponseID = 1;
    }
    this.removeAllListeners('response:' + id);
    return id;
};
Parent.prototype.eachChild = function(cb, responseCallback) {
    return new Promise(function(resolve) {
        var pendingChildren = [],
            responseID = this.getNextResponseID(),
            child, onResponse;

        onResponse = function(message, child) {
            var i = pendingChildren.indexOf(child._id);
            if (i !== -1) {
                pendingChildren.splice(i, 1);
            }
            if (message && responseCallback) {
                responseCallback(message, child);
            }
            if (pendingChildren.length === 0) {
                this.removeAllListeners('response:' + responseID);
                resolve();
            }
        }.bind(this);
        this.addListener('response:' + responseID, onResponse);

        for (var id in this.childrenByID) {
            if (!this.childrenByID.hasOwnProperty(id)) continue;
            child = this.childrenByID[id];
            pendingChildren.push(child._id);
            if (typeof cb === 'function') {
                cb(child, responseID);
            }
        }
    }.bind(this));
};
Parent.prototype.stopChildren = function(responseSocket) {
    return new Promise(function(resolve) {
        var pendingChildren = [],
            onMessage;
        onMessage = function(message, child, response) {
            if (message[0] !== 'd') {
                return;
            }
            var i = pendingChildren.indexOf(child._id);
            if (i !== -1) {
                pendingChildren.splice(i, 1);
            }
            if (responseSocket) {
                responseSocket.write(response + '\n');
            }
            if (pendingChildren.length === 0) {
                this.removeListener('childMessage', onMessage);
                resolve();
            }
        }.bind(this);
        this.addListener('childMessage', onMessage);

        this.eachChild(function(child) {
            pendingChildren.push(child._id);
            //delete first here so we don't try to make a new one when it dies
            delete this.childrenByID[child._id];
            child.kill();
        }.bind(this));

    }.bind(this));
};
Parent.prototype.restartChildren = function(responseSocket) {
    var chain = new ChainLoading();
    chain.push(this.stopChildren(responseSocket));
    for (var i = 0; i < this.config.children; i++) {
        chain.push(this.spawnChild(responseSocket, i));
    }
    return chain.promise();
};
Parent.prototype.reloadChildren = function(responseSocket) {
    return new Promise(function(resolve) {
        var pendingChildren = [],
            onMessage;
        onMessage = function(message, child, response) {
            if (message[0] !== 'c') {
                return;
            }
            var i = pendingChildren.indexOf(child._id);
            if (i !== -1) {
                pendingChildren.splice(i, 1);
            }
            if (responseSocket) {
                responseSocket.write(response + '\n');
            }
            if (pendingChildren.length === 0) {
                this.removeListener('childMessage', onMessage);
                resolve();
            }
        }.bind(this);
        this.addListener('childMessage', onMessage);

        this.eachChild(function(child) {
            pendingChildren.push(child._id);
            child.kill('SIGHUP');
        }.bind(this));

    }.bind(this));
};
Parent.prototype.dispatchConfig = function(responseSocket) {
    return new Promise(function(resolve) {
        var command = 'f' + JSON.stringify(this.config),
            pendingChildren = [],
            onMessage;
        onMessage = function(message, child, response) {
            if (message[0] !== 'f') {
                return;
            }
            var i = pendingChildren.indexOf(child._id);
            if (i !== -1) {
                pendingChildren.splice(i, 1);
            }
            if (responseSocket) {
                responseSocket.write(response + '\n');
            }
            if (pendingChildren.length === 0) {
                this.removeListener('childMessage', onMessage);
                resolve();
            }
        }.bind(this);
        this.addListener('childMessage', onMessage);

        this.eachChild(function(child) {
            pendingChildren.push(child._id);
            child.send(command);
        }.bind(this));

    }.bind(this));
};
Parent.prototype.getChildrenConnectionCount = function(responseSocket, raw) {
    return this.eachChild(function(child, respID) {
        child.send('r' + respID + '|connCount');
    }, function(message, child) {
        if (raw) {
            responseSocket.write('child' + child._num + ': ' + message + '\n');
        } else {
            responseSocket.write('Child ' + child._id + ' connection count: ' + message + '\n');
        }
    });
};

Parent.prototype.onControlCommand = function(command, commandArgs, socket) {
    if (!command) {
        return;
    }
    function endSocket() {
        socket.end();
    }
    switch (command.toLowerCase()) {
        case 'reload':
            this.reloadChildren(socket).then(endSocket, endSocket);
            break;
        case 'restart':
            this.restartChildren(socket).then(endSocket, endSocket);
            break;
        case 'reloadconfig':
            try {
                this.loadConfig();
                this.dispatchConfig(socket).then(endSocket, endSocket);
            } catch (e) {
                socket.end('Failed to load new config: ' + e.message);
            }
            break;
        case 'status':
            if (this.role) {
                socket.write('Role: ' + this.role + "\n");
            }
            socket.write('Number of children: ' + (Object.keys(this.childrenByID)).length + "\n");
            this.getChildrenConnectionCount(socket).then(endSocket, endSocket);
            break;
        case 'heapdump':
            this.eachChild(function(child, respID) {
                child.send('r' + respID + '|heapDump');
            }, function(message, child) {
                socket.write('Child ' + child._id + ' ' + message + '\n');
            }).then(endSocket, endSocket);
            break;
        case 'connectioncount':
            this.getChildrenConnectionCount(socket, true).then(endSocket, endSocket);
            break;
        case 'entrypoolsize':
            this.eachChild(function(child, respID) {
                child.send('r' + respID + '|entryPoolSize');
            }, function(message, child) {
                socket.write('child' + child._num + ': ' + message + '\n');
            }).then(endSocket, endSocket);
            break;
        case 'shutdown':
        case 'exit':
            socket.write("Shutting down server...\n");
            this.stopChildren().then(function() {
                endSocket();
                process.exit();
            }, endSocket);
            break;
        default:
            socket.end('Invalid command "' + command + '"');
            break;
    }
};
Parent.prototype.stop = function() {
    this.stopChildren();
    this.stopWriters();
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
            log("server_error An instance of gobbler is already running!\n");
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
    log('Started control server server on ' + this.config.controlsock);
};

Parent.prototype.startPotluckServer = function() {
    this.potluckHandle = net._createServerHandle(this.config.ip, this.config.port, 4);
    if (!(this.potluckHandle instanceof process.binding('tcp_wrap').TCP)) {
        log('server_error Created invalid server handle! Maybe you can\'t listen on that port?');
        process.exit();
        return;
    }
    log('server_started Started potluck server on ' + this.config.ip + ':' + this.config.port);
    //now actually start the initial children
    this.restartChildren();
};

module.exports = Parent;
