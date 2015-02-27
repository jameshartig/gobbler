var net = require('net'),
    fs = require('fs'),
    child_process = require('child-process-debug'),
    EntryPool = require('entrypool'),
    flags = require('flags'),
    dateFormat = require('dateFormat'),
    reload = require('require-reload')(require),
    numCPUs = require('os').cpus().length,
    isWindows = /^win/.test(process.platform),
    command = (process.argv.slice(2)).slice(-1)[0], //get the last arg sent as long as its not the filename
    childrenByID = {},
    config, serverHandle, crashedTimes, signalServer, signalConn;

function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(dateFormat(new Date(), "[d-mmm-yy HH:MM:ss]"));
    console.log.apply(console.log, args);
}

//if the last thing they sent was an option its not a command
if (typeof command !== 'string' || command.indexOf('-') === 0) {
    command = '';
} else {
    //remove the command so flags doesn't complain about an invalid argument
    process.argv.splice(-1, 1);
}

flags.defineString('ip', '0.0.0.0', 'ip address to listen on');
flags.defineInteger('port', 80, 'port to listen on');
flags.defineInteger('children', numCPUs, 'number of children to start');
flags.defineString('role', '', 'the name of this gobbler instance');
flags.defineString('commsock', isWindows ? '' : './comm.sock', 'unix socket to listen to for reloading/restarting');
flags.defineString('config', './config.json', 'config file to load');
//ignore unknown arguments
flags.parse(null, true);


function loadConfig() {
    config = {};
    if (flags.get('config') && fs.existsSync(flags.get('config'))) {
        config = reload(flags.get('config'));
    }

    //overwrite any values in config with ones passed in
    for (var name in flags.FLAGS) {
        if (flags.FLAGS.hasOwnProperty(name) && (config[name] === undefined || flags.isSet(name))) {
            config[name] = flags.get(name);
        }
    }
}
loadConfig();

if (command && command !== 'start') {
    command = (command + '').trim();
    signalConn = net.createConnection({path: config.commsock}, function() {
        signalConn.end(command);
    });
    signalConn.setTimeout(5000, function() {
        process.stdout.write("Timed out waiting for response on command socket!\n");
        signalConn.destroy();
    });
    signalConn.on('error', function() {
        process.stdout.write("Error connecting to command socket!\n");
    });
    signalConn.pipe(process.stdout);
    signalConn.on('end', function() {
        process.stdout.write("\n");
    });
    return;
}

//they didn't send a signalCommand so lets start up the server
if (config.children < 1) {
    throw new Error('Invalid number of children');
}
crashedTimes = new Array(config.children);

function onChildMessage(responseSocket, message) {
    var status, response;
    switch (message[0]) {
        case 'a': //initial ping which means i'm ready
            if (!this._ready) {
                this.send('a' + JSON.stringify(config), serverHandle);
                this._ready = true;
            }
            break;
        case 'b': //server has started listening
            response = 'Child ' + this._id + ' is now listening!';
            break;
        case 'c': //status of reload
            status = message.substr(1);
            if (status === 'ok') {
                response = 'Child ' + this._id + ' has been reloaded!';
            } else {
                response = 'Child ' + this._id + 'failed to reload. Error: ' + status;
            }
            break;
        case 'd': //child shutdown
            delete childrenByID[this._id];
            response = 'Child ' + this._id + ' has been stopped!';
            break;
        case 'e': //connection count
            response = 'Child ' + this._id + ' connection count: ' + message.substr(1);
            break;
        case 'f': //response from new config
            status = message.substr(1);
            if (status === 'ok') {
                response = 'Child ' + this._id + ' reloaded config!';
            } else {
                response = 'Child ' + this._id + ' failed to reload config:' + status;
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
}

function onChildDisconnect() {
    this.removeAllListeners();

    if (childrenByID[this._id]) {
        log('Child ' + this._id + ' disconnected. Restarting...');
        try {
            childrenByID[this._id].kill('SIGINT');
        } catch (e) {}
        delete childrenByID[this._id];
        EntryPool.addEntry(crashedTimes, Date.now());
        startChild();
    }
}

function startChild(responseSocket) {
    var now = Date.now(),
        pendingListners = [],
        listener, child;
    if (EntryPool.cleanupEntries(crashedTimes, (now - 5000)) >= config.children) {
        log('Children are crashing too quickly. Dying...');
        process.exit();
        return;
    }
    child = child_process.fork('./startChild.js');
    childrenByID[child.pid] = child;
    child._id = child.pid;
    child.on('message', onChildMessage.bind(child, process.stdout));
    child.on('disconnect', onChildDisconnect.bind(child));

    if (responseSocket) {
        //todo: this is just relying on the setTimeout at the bottom to remove the listeners
        responseSocket._pendingResponses++;
        listener = [child, 'message', onChildMessage.bind(child, responseSocket)];
        pendingListners.push(listener);
        Function.prototype.call.apply(child.on, listener);
    }
    if (pendingListners.length) {
        //remove the listeners if they happen to not have fired
        setTimeout(function() {
            pendingListners.forEach(function(listener) {
                Function.prototype.call.apply(listener[0].removeListener, listener);
            });
        }, 5000);
    }
}

function stopChildren(responseSocket) {
    var pendingListners = [],
        listener, child;
    for (var id in childrenByID) {
        child = childrenByID[id];
        delete childrenByID[id];
        if (responseSocket) {
            responseSocket._pendingResponses++;
            listener = [child, 'message', onChildMessage.bind(child, responseSocket)];
            pendingListners.push(listener);
            Function.prototype.call.apply(child.once, listener);
        }
        child.kill('SIGINT');
    }
    if (pendingListners.length) {
        //remove the listeners if they happen to not have fired
        setTimeout(function() {
            pendingListners.forEach(function(listener) {
                Function.prototype.call.apply(listener[0].removeListener, listener);
            });
        }, 5000);
    }
}

function restartChildren(responseSocket) {
    stopChildren(responseSocket);
    for (var i = 0; i < config.children; i++) {
        startChild(responseSocket);
    }
}

function reloadChildren(responseSocket) {
    var pendingListners = [],
        listener, child;
    for (var id in childrenByID) {
        child = childrenByID[id];
        if (responseSocket) {
            responseSocket._pendingResponses++;
            listener = [child, 'message', onChildMessage.bind(child, responseSocket)];
            pendingListners.push(listener);
            Function.prototype.call.apply(child.once, listener);
        }
        child.kill('SIGHUP');
    }
    if (pendingListners.length) {
        //remove the listeners if they happen to not have fired
        setTimeout(function() {
            pendingListners.forEach(function(listener) {
                Function.prototype.call.apply(listener[0].removeListener, listener);
            });
        }, 5000);
    }
}

function getChildrenConnectionCount(responseSocket) {
    var pendingListners = [],
        listener, child;
    for (var id in childrenByID) {
        child = childrenByID[id];
        if (responseSocket) {
            responseSocket._pendingResponses++;
            listener = [child, 'message', onChildMessage.bind(child, responseSocket)];
            pendingListners.push(listener);
            Function.prototype.call.apply(child.once, listener);
        }
        child.send('e');
    }
    if (pendingListners.length) {
        //remove the listeners if they happen to not have fired
        setTimeout(function() {
            pendingListners.forEach(function(listener) {
                Function.prototype.call.apply(listener[0].removeListener, listener);
            });
        }, 5000);
    }
}

function sendNewConfig(responseSocket) {
    var pendingListners = [],
        listener, child;
    for (var id in childrenByID) {
        child = childrenByID[id];
        if (responseSocket) {
            responseSocket._pendingResponses++;
            listener = [child, 'message', onChildMessage.bind(child, responseSocket)];
            pendingListners.push(listener);
            Function.prototype.call.apply(child.once, listener);
        }
        child.send('f' + JSON.stringify(config));
    }
    if (pendingListners.length) {
        //remove the listeners if they happen to not have fired
        setTimeout(function() {
            pendingListners.forEach(function(listener) {
                Function.prototype.call.apply(listener[0].removeListener, listener);
            });
        }, 5000);
    }
}

function onCommand(socket, command) {
    if (!socket.writable) {
        socket.end();
        return;
    }
    //todo: we should use deferreds and chainloading instead of this
    socket._pendingResponses = 0;
    socket._onLastPendingResponse = function() {
        socket.end();
    };
    switch (command) {
        case 'reload':
            reloadChildren(socket);
            break;
        case 'restart':
            restartChildren(socket);
            break;
        case 'reloadconfig':
            try {
                loadConfig();
                sendNewConfig(socket);
            } catch (e) {
                socket.end('Failed to load new config: ' + e.message);
            }
            break;
        case 'status':
            if (config.role) {
                socket.write('Role: ' + config.role + "\n");
            }
            socket.write('Number of children: ' + (Object.keys(childrenByID)).length + "\n");
            getChildrenConnectionCount(socket);
            break;
        case 'shutdown':
        case 'exit':
            socket.write("Shutting down server...\n");
            stopChildren();
            process.nextTick(function() {
                process.exit();
            });
            break;
        default:
            socket.end('Invalid command "' + command + '"');
            break;
    }
}

function startPotluckServer() {
    serverHandle = net._createServerHandle(config.ip, config.port, 4);
    if (!(serverHandle instanceof process.binding('tcp_wrap').TCP)) {
        log('Created invalid server handle! Maybe you can\'t listen on that port?');
        process.exit();
    }
    //now actually start the initial children
    restartChildren();
}

function startSignalServer() {
    signalServer = net.createServer({allowHalfOpen: true});
    signalServer.on('connection', function(socket) {
        var command = '';
        socket.setEncoding('utf8');
        socket.on('data', function(data) {
            command += data;
        });
        //once we get a FIN then we know the sending side is done sending data
        socket.on('end', function() {
            onCommand(socket, command);
        });
        socket.on('error', function(err) {
            log('Error on command socket: ' + err.message);
        });
    });
    signalServer.listen(config.commsock, startPotluckServer);
    //don't let this server stop us from dying
    signalServer.unref();

    process.on('exit', function() {
        signalServer.close();
    });
    process.on('SIGINT', function() {
        process.exit();
    });
}

if (config.commsock) {
    //if the file already exists we might already be running somewhere else
    fs.exists(config.commsock, function(exists) {
        if (!exists) {
            startSignalServer();
            return;
        }
        var conn = net.createConnection({path: config.commsock}, function() {
            process.stdout.write("An instance of gobbler is already running!\n");
            conn.end();
            process.exit();
        });
        conn.setTimeout(5000, function() {
            signalConn.destroy();
            process.stdout.write("Command socket already exists but node is dead.\n");
            fs.unlink(config.commsock, startSignalServer);
        });
        conn.on('error', function() {
            process.stdout.write("Command socket already exists but node is dead.\n");
            fs.unlink(config.commsock, startSignalServer);
        });
    });
} else {
    startPotluckServer();
}
