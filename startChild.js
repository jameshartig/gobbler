var posix = require('posix'),
    dateFormat = require('dateFormat'),
    reload = require('require-reload')(require),
    Child = reload('./src/child.js'),
    currentChild = new Child();

function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(dateFormat(new Date(), "[d-mmm-yy HH:MM:ss]"));
    console.log.apply(console.log, args);
}

process.on('message', currentChild.handleParentMessage.bind(currentChild));
process.on('SIGINT', function() {
    if (process.connected) {
        process.send('d');
    }
    process.exit();
});
process.on('SIGHUP', function() {
    var status = 'unknown';
    try {
        Child = reload('./src/child.js');
        currentChild = new Child(currentChild);
        process.removeAllListeners('message').on('message', currentChild.handleParentMessage.bind(currentChild));
        currentChild.start();
        status = 'ok';
    } catch (e) {
        status = e.message;
    }
    process.send('c' + status);
});

//detect if the parent was kill9'd
setInterval(function() {
    var parentPID = posix.getppid();
    //technically ppid of 1 means parent died but if we get 0 that's bad too?
    if (!parentPID || parentPID === 1) {
        log('parent died');
        process.exit();
    }
}, 1000);

//todo: we might need to wait to do this until after we get the config from 'a'
currentChild.start();

//tell the parent we're started
process.send('a');
