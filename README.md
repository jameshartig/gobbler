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
todo: document all the options

## Commands ##
```
node run.js [options] [command]
```

### reload ###
Hot-reload all the children. Reload doesn't reload the actual server (potluck instance) itself.

### reloadconfig ###
Hot-reload the config. If you added any new formatters or writers, calling this will set them up.

### restart ###
Restart the children. This will sever any connections that they had open.

### shutdown ###
Shutdown the server.

### status ###
Get the status of the children.

## Formatters ##
todo: need to write these docs

## Writers ##
todo: need to write these docs


By [James Hartig](https://github.com/fastest963/)