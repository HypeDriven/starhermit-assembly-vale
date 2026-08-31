/* Assembly Vale — authoritative server (Node, no external dependencies).
 * Serves the static distribution from this directory and exposes:
 *   GET  /api/v1/time  -> { time }            (server wall-clock, ms)
 *   WS   /ws           (upgrade; pings kept alive)
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var urlmod = require('url');

var PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
var ROOT = __dirname;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.opus': 'audio/ogg'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

var server = http.createServer(function (req, res) {
  var u = urlmod.parse(req.url);
  var p = decodeURIComponent(u.pathname || '/');

  if (p === '/' ) { send(res, 200, 'Assembly Vale', 'text/plain; charset=utf-8'); return; }
  if (p === '/api/v1/time') { send(res, 200, JSON.stringify({ time: Date.now() }), MIME['.json']); return; }

  // static files from the distribution root
  var fp = path.join(ROOT, p);
  fs.readFile(fp, function (err, data) {
    if (err) { send(res, 404, 'not found'); return; }
    var ext = path.extname(fp).toLowerCase();
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
});

server.listen(PORT);

module.exports = server;
