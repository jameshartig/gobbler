# gobbler #

Extremely flexible data reformatter using [portluck](https://www.npmjs.com/package/portluck). Can be 
used to flexibly record logs from various applications and reformat and record them in a central place.

Gobbler only handles passing data along and does not support displaying data, except for the built-in 
websocket writer. You must use another service, like Logstash/Kibana, to display the data. Gobbler will
handle all the reformatting and ratelimiting and forward the data to the other service.

Most configuration changes can be made without restarting and you can write your own writers/formatters
that work alongside the built-in ones.

## To Run ##
```
node run.js [options] start
```

## Command-line Options ##
```
node run.js --help
```

Command-line options override the config.json options.

## Configuration Options ##

See config.json.example for an example config.

### role ###

String that identifies the gobbler instance when using the `jsonWrap` writer.

### port ###

Port to listen on. Default is 80

### ip ###

IP to listen on. Default is 0.0.0.0

### writers ###

An array of writers to send the data to after formatting is complete. Data is buffered if and only if
ALL writers are disconnected.

### formatters ###

An array of formatters to rewrite/mangle the data before sending it to the writers. Each formatter is run
in the order specified in the config. If any formatter throws an exception the message is dropped and an
error is logged and/or sent to the client, depending on the `clientLogLevel`.

### limits ###

A hash of client rate limits. As of v0.1.0 the limits are only maintained PER child. This is intended to 
be fixed in a later version.

* persistentConns: limit of persistent connections allowed per IP. Any new connections will be dropped.
* messages: allowed number of messages per IP per `messagesTimeframe`
* messagesTimeframe: timeframe, in seconds, for `messages` limit
* logs: maximum number of generated logs allowed per IP per 5 minutes. Each formatter error or socket
error triggers a log message and this limit controls how much a single IP can flood the log.

### clientLogLevel ###

Controls how verbose you want to be with clients. Recommended production value is 0 and recommended dev 
value is 3.

0. Any formatter/writer errors result in no response from gobbler
1. Formatter/writer errors result in `invalid_payload\n` being sent to the client
2. In addition to 1, if a client is rate-limited they will receive `rate_limited\n`
3. Client will receive full error message and formatter/writer that threw the error

### portluck ###

Hash of options to pass to portluck when making the server. See portluck documentation.

### heapdump ###

If set to true, this enables the heapdump command to capture heapdumps from the children.

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

### connectioncount ###
Prints the persistent connection counts for each child. Can be used to send to a graphing service like
Zabbix.

### heapdump ###
Assuming heapdump was enabled in your config, this command will cause all the children to create a
heapdump. 


By [James Hartig](https://github.com/fastest963/)