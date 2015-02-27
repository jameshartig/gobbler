var net = require('net'),
    log = require('./src/log.js'),
    Parent = require('./src/parent.js'),
    command = (process.argv.slice(2)).slice(-1)[0], //get the last arg sent as long as its not the filename
    currentParent = new Parent(),
    config, signalConn, writer;

//if the last thing they sent was an option its not a command
if (typeof command !== 'string' || command.indexOf('-') === 0) {
    command = '';
} else {
    //remove the command so flags doesn't complain about an invalid argument
    process.argv.splice(-1, 1);
}

currentParent.loadConfig();

if (command && command !== 'start') {
    command = (command + '').trim();
    signalConn = net.createConnection({path: currentParent.config.controlsock}, function() {
        signalConn.end(command);
    });
    signalConn.setTimeout(5000, function() {
        log("Timed out waiting for response on command socket!\n");
        signalConn.destroy();
    });
    signalConn.on('error', function() {
        log("Error connecting to command socket!\n");
    });
    signalConn.pipe(process.stdout);
    signalConn.on('end', function() {
        process.stdout.write("\n");
    });
    return;
}

currentParent.start();
