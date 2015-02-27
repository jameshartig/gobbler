var posix = require('posix'),
    log = require('./src/log.js'),
    reload = require('require-reload')(require),
    Child = reload('./src/child.js'),
    currentChild = new Child();

process.on('message', function(msg, handle) {
    currentChild.handleParentMessage(msg, handle);
});
process.on('SIGINT', function() {
    if (process.connected) {
        process.send('d');
    }
    process.exit();
});
process.on('SIGHUP', function() {
    console.log('heyyyyy');
    var status = 'unknown';
    try {
        Child = reload('./src/child.js');
        currentChild = new Child(currentChild);
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

//tell the parent we're started
process.send('a');
