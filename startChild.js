var posix = require('posix'),
    reload = require('require-reload')(require),
    Child = reload('./src/child.js'),
    currentChild = new Child();

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
        status = 'ok';
    } catch (e) {
        status = e.message;
    }
    process.send('c' + status);
});

currentChild.start();

//detect if the parent was kill9'd
setInterval(function() {
    var parentPID = posix.getppid();
    //technically ppid of 1 means parent died but if we get 0 that's bad too?
    if (!parentPID || parentPID === 1) {
        console.log('parent died');
        process.exit();
    }
}, 1000);

//tell the parent we're started
process.send('a');