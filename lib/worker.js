'use strict';

var debug = require('debug')('theme:martinet:worker');
var zmq = require('zmq');
var _ = require('lodash');
var frontPort = 'tcp://127.0.0.1:12345';
var backPort = 'tcp://127.0.0.1:12346';

function Worker(options) {
  if (!(this instanceof Worker)) {
    return new Worker(options);
  }

  // Used to register with the dealer to receive work requests on
  this.workerSocket = zmq.socket('rep');
  this.workerSocket.identity = 'worker' + process.pid;

  // Used to communicate status/updates to the dealer
  this.statusSocket = zmq.socket('push');
  this.statusSocket.identity = 'status' + process.pid;

  var defaults = {
    martinet_url: '127.0.0.1',
    // Port that the dealer/rep socket will use
    worker_port: '8009',
    // Port used to pass updates back to the dealer
    status_port: '18009'
  };

  this.options = _.defaults(options || {}, defaults);

  var workerConnection = 'tcp://' + this.options.martinet_url + ':' + this.options.worker_port;
  var statusConnection = 'tcp://' + this.options.martinet_url + ':' + this.options.status_port;

  debug('Starting rep socket on ' + workerConnection);
  this.workerSocket.connect(workerConnection);
  debug('Starting push socket on ' + statusConnection);
  this.statusSocket.connect(statusConnection);

  this.handlers = {};
  var self = this;

  this.workerSocket.on('message', function(data) {
    var msg;
    msg = JSON.parse(data.toString());
    debug('Worker [' + self.workerSocket.identity + '] : received work %j', msg);

    var handler = self.handlers[msg.name];
    if(handler) {
      self._handle(handler, msg);
      self.setProgress(msg.id, 0.01);
    } else {
      debug('Unable to handle [' + msg.name + '] no handler defined');
      self.setError(msg.id, 'Unable to handle [' + msg.name + '] no handler defined');
    }
  });
}

Worker.VERSION = require('../package.json').version;
module.exports = Worker;

Worker.prototype.on = function(name, f) {
  this.handlers[name] = f;
};


Worker.prototype.setComplete = function(taskId, data) {
  this.workerSocket.send(JSON.stringify({taskId: taskId, set: 'complete', result: data}));
};

Worker.prototype.setError = function(taskId, error) {
  this.workerSocket.send(JSON.stringify({taskId: taskId, set: 'error', error: error}));
};

Worker.prototype.setProgress = function(taskId, progress) {
  this.statusSocket.send(JSON.stringify({taskId: taskId, set: 'progress', progress: progress}));
};


Worker.prototype._handle = function(handler, task) {
  var self = this;
  handler(task.id, task.data, function(err, data) {
    if(err) {
      debug('Error handling task [' + task.id + '] with data [%j]: %j', task.data, err);
      return self.setError(task.id, err);
    }
    debug('Completed task [' + task.id + '] with data [%j]', data);
    self.setComplete(task.id, data);
  });
};

Worker.prototype.close = function() {
  this.workerSocket.close();
  this.statusSocket.close();
};
