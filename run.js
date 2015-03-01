#!/usr/bin/env node
var log = require('./src/log.js'),
    Parent = require('./src/parent.js'),
    ctrl = require('daemonctrl'),
    currentParent = new Parent(),
    config, sender;

function onExit(error) {
    currentParent.stop();
    ctrl.end();
    if (error) {
        throw e;
    }
    process.exit();
}
process.on('exit', onExit);
process.on('SIGTERM', onExit);
process.on('SIGINT', onExit);

//we gotta first strip the command otherwise flags will complain
ctrl.strip();
currentParent.loadConfig();
ctrl.socketOptions({path: currentParent.config.controlsock});
if (!currentParent.config.controlsock) {
    currentParent.start();
    return;
}
sender = ctrl.send();
if (!sender) {
    log('Starting parent');
    currentParent.start();
    return;
}
sender.pipe(process.stdout);
