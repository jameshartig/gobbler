#!/usr/bin/env node
var log = require('./src/log.js'),
    Parent = require('./src/parent.js'),
    ctrl = require('daemonctrl'),
    currentParent = new Parent(),
    config, sender;

function onExit(error) {
    currentParent.stop();
    ctrl.end();
    if (error instanceof Error) {
        throw error;
    }
}
//since each of our children are going to be listening on all 3 of these raise the max listeners limit
process.setMaxListeners(32);
process.on('exit', onExit);
process.once('SIGTERM', process.exit.bind(process, 0));
process.once('SIGINT', process.exit.bind(process, 0));

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
