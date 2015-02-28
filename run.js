#!/usr/bin/env node
var log = require('./src/log.js'),
    Parent = require('./src/parent.js'),
    ctrl = require('daemonctrl'),
    currentParent = new Parent(),
    config, sender;

//we gotta first strip the command otherwise flags will complain
ctrl.strip();
currentParent.loadConfig();
ctrl.socketOptions({path: currentParent.config.controlsock});
if (!currentParent.config.controlsock) {
    currentParent.start();
}
sender = ctrl.send();
if (!sender) {
    currentParent.start();
    return;
}
sender.pipe(process.stdout);
