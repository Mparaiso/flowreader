/**
 * simple test server for feedpress
 */

var express, dir, app, commander, path, http, port;

express = require('express');
http = require('http');
path = require('path');
fs = require('fs');
stream=require('stream');
dir = /*process.argv[2] ||*/ process.cwd();
port = 4000;
app = express();
app.use(express.static(dir));
app.use(express.logger());

http.createServer(app).listen(port, function () {
    console.log('listening on port :'.concat(port));
});
