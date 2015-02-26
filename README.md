# gobbler #

Gobbles up data and sends it somewhere.

## To Run ##
```
node run.js [options] start
```

## Options ##
```
node run.js --help
```

## Commands ##
```
node run.js [options] [command]
```

### reload ###
Hot-reload all the children. Reload doesn't reload the actual server (potluck instance) itself.

### restart ###
Restart the children. This will sever any connections that they had open.

### shutdown ###
Shutdown the server.

### status ###
Get the status of the children.

By [James Hartig](https://github.com/fastest963/)