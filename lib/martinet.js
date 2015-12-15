'use strict';

var debug = require('debug')('theme:martinet:server');
var zmq  = require('zmq');
var _ = require('lodash');
var humanInterval = require('human-interval');
var Q = require('q');
var date = require('date.js');

var frontPort = 'tcp://127.0.0.1:12345';
var backPort = 'tcp://127.0.0.1:12346';

function Martinet(options) {
  if (!(this instanceof Martinet)) {
    return new Martinet(options);
  }
  // Socket for receiving requests from the client
  this.clientSocket = zmq.socket('router');
  this.clientSocket.identity = 'router' + process.pid;

  // Socket for receiving responses from the workers
  this.workerSocket = zmq.socket('dealer');
  this.workerSocket.identity = 'dealer' + process.pid;

  // Socket for receiving status updates from workers
  this.statusSocket = zmq.socket('pull');

  var defaults = {
    martinet_url: '127.0.0.1',
    client_port: '8008',
    worker_port: '8009',
    status_port: '18009',
    db: {
      database: 'martinet-db',
      username: process.env.USER,
      password: null,
      options: {
        dialect: 'sqlite',
        storage: 'martinet.db',
        logging: false,
        omitNull: true
      },
      sync: true
    }
  };

  this.options = _.defaults(options || {}, defaults);

  var workerConnection = 'tcp://' + this.options.martinet_url + ':' + this.options.worker_port;
  debug('Starting dealer socket on ' + workerConnection);
  this.workerSocket.bindSync(workerConnection);

  var clientConnection = 'tcp://' + this.options.martinet_url + ':' + this.options.client_port;
  debug('Starting router socket on ' + clientConnection);
  this.clientSocket.bindSync(clientConnection);

  var statusConnection = 'tcp://' + this.options.martinet_url + ':' + this.options.status_port;
  debug('Starting pull socket on ' + statusConnection);
  this.statusSocket.bindSync(statusConnection);

  var models = require('./models');
  this.models = models.setup(this.options.db);

  this.workers = {};
  var self = this;

  // Receiving a work request from the client and sending it off to an available worker
  this.clientSocket.on('message', function(data) {
    debug('Receiving message on client socket: %j', data);
    self.workerSocket.send(Array.prototype.slice.call(arguments));
  });

  // Receiving a status update from a worker
  this.statusSocket.on('message', function(data) {
    var msg = JSON.parse(data.toString());
    debug('Receiving message on status socket: %j', msg);

    if(msg.set === 'progress') {
      self.setProgress(msg.task, msg.progress);
    } else if(msg.set === 'error') {
      self.setError(msg.task, msg.error);
    }
  });

  // Workering notifying they are done with their task
  this.workerSocket.on('message', function(frame, data) {
    var msg = JSON.parse(data.toString());
    debug('Receiving response from [' + msg.task + '] with result [' + msg.result + ']');

    if(msg.set === 'complete') {
      self.setComplete(msg.task);
    }
  });

  this._start();
}


Martinet.VERSION = require('../package.json').version;
module.exports = Martinet;
module.exports.Worker = require('./worker');

Martinet.prototype.execute = function(taskObj, parameters, cb) {
  var self = this;

  // Create a task and then shoot it off
  var Task = this.models.Task;
  return Task.create(taskObj)
  .then(function(task) {
    debug('Dispatching task ' + task.id);
    self.workerSocket.send(['', JSON.stringify({id: task.id, name: task.name, data: parameters})]);
    if(cb) {
      cb(null, task.id);
    }
  }, function(err) {
    debug('Error creating task: ' + err);
    if(cb) {
      cb(err);
    }
  });
};


Martinet.prototype.schedule = function(when, taskObj, parameters, cb) {
  var self = this;
  var ScheduledTask = this.models.ScheduledTask;
  var TaskParameter = this.models.TaskParameter;

  return ScheduledTask.create(_.extend(taskObj, {
    run_at: (when instanceof Date) ? when : date(when).valueOf()
  }))
  .then(function(task) {
    _.each(parameters, function(value, key) {
      TaskParameter.create({
        name: key,
        value: JSON.stringify(value),
        ScheduledTaskId: task.id
      });
    });
    if(cb) {
      cb(null, task);
    }
  }, function(err) {
    debug('Unable to create ScheduledTask: ' + err);
  });
};

Martinet.prototype.every = function(interval, taskObj, parameters, cb) {
  var ScheduledTask = this.models.ScheduledTask;
  var TaskParameter = this.models.TaskParameter;

  return ScheduledTask.create(_.extend(taskObj, {
    interval: humanInterval(interval),
    is_recurring: true,
    run_at: (taskObj.run_at) ? date(taskObj.run_at).valueOf() : Date.now().valueOf()
  }))
  .then(function(task) {
    _.each(parameters, function(value, key) {
      TaskParameter.create({
        name: key,
        value: JSON.stringify(value),
        ScheduledTaskId: task.id
      });
    });
    if(cb) {
      cb(null, task);
    }
  }, function(err) {
    debug('Unable to created ScheduledTask: ' + err);
  });
};

Martinet.prototype.updateTask = function(taskId, parameters) {
  var TaskParameter = this.models.TaskParameter;

  _.each(parameters, function(val, key) {
    TaskParameter
    .find({
      where: {
        ScheduledTaskId: taskId,
        name: key
      }
    }).then(function(param) {
      param
      .updateAttributes({
        name: key,
        value: JSON.stringify(val)
      });
    }, function(err) {
      debug('Error finding task [' + taskId + ']: ' + err);
    });
  });
};

Martinet.prototype.revoke = function(taskId) {
  var TaskParameter = this.models.TaskParameter;
  var ScheduledTask = this.models.ScheduledTask;

  return Q.all([
    TaskParameter.destroy({
      ScheduledTaskId: taskId
    }),
    ScheduledTask.destroy({
      id: taskId
    })
  ]).spread(function() {
    debug('Successfully removed task ' + taskId);
  });
};


Martinet.prototype.setProgress = function(taskId, progress) {
  debug('Setting progress for task [' + taskId + '] with progress [' + 100*progress + '%]');
  var Task = this.models.Task;
  var self = this;

  return Task.find(taskId)
  .then(function(task) {
    return task.updateAttributes({
      progress: progress
    }).then(function() {
      if(self._onProgress) {
        self._onProgress(task.get());
      }
    }, function(err) {
      debug('Error updating task [' + taskId + '] with progress [' + progress + ']: ' + err);
    });
  }, function(err) {
    debug('Error unable to find taskId [' + taskId + ']: ' + err);
  });
};


Martinet.prototype.setError = function(taskId, error) {
  debug('Setting error for task [' + taskId + '] with error: ' + error);
  var Task = this.models.Task;
  var TaskLog = this.models.TaskLog;
  var self = this;

  return Task.find(taskId)
  .then(function(task) {
    return task.updateAttributes({error: true, error_message: error})
    .then(function() {
      return TaskLog.create({
        TaskId: taskId,
        content: error
      }).then(function() {
        if(self._onError) {
          self._onError(task.get());
        }
      }, function(err) {
        debug('Error updating creating TaskLog for [' + taskId + '] with error [' + error + ']: ' + err);
      });

    }, function(err) {
      debug('Error unable to set error flags for taskId [' + taskId + ']: ' + err);
    });
  }, function(err) {
    debug('Error unable to find taskId [' + taskId + ']: ' + err);
  });
};


Martinet.prototype.setComplete = function(taskId) {
  debug('Completing task [' + taskId + ']');
  var Task = this.models.Task;
  var self = this;
  return Task.find(taskId)
  .then(function(task) {
    return task.updateAttributes({
      complete: true,
      progress: 1.0
    }).then(function() {
      if(self._onComplete) {
        self._onComplete(task.get());
      }
    }, function(err) {
      debug('Error completing task [' + taskId + ']: ' + err);
    });
  }, function(err) {
    debug('Error unable to find taskId [' + taskId + ']: ' + err);
  });
};

Martinet.prototype.onComplete = function(f) {
  this._onComplete = f;
};

Martinet.prototype.onError = function(f) {
  this._onError = f;
};

Martinet.prototype.onProgress = function(f) {
  this._onProgress = f;
};


Martinet.prototype._stop = function() {
  clearInterval(this._scheduledInterval);
  this._scheduledInterval = undefined;
};

Martinet.prototype.taskStatus = function(opts) {
  debug('Getting task status given %j', opts);
  var Task = this.models.Task;
  var self = this;
  return Task.findAll({
    where: opts
  })
  .then(function(tasks) {
    return _.map(tasks, function(task) {
      return task.get();
    });
  });
};

Martinet.prototype.taskLog = function(opts) {
  debug('Getting task log given %j', opts);
  var TaskLog = this.models.TaskLog;
  var self = this;
  return TaskLog.findAll({
    where: opts
  })
  .then(function(logs) {
    return _.map(logs, function(log) {
      return log.get();
    });
  });
};


var _checkScheduledTasks = function() {
  var ScheduledTask = this.models.ScheduledTask;
  var self = this;

  return ScheduledTask.findAll({
    where: {
      run_at: {
        lte: Date.now().valueOf()
      }
    }
  }).then(function(scheduledTasks) {
    _.each(scheduledTasks, function(scheduledTask) {
      return Q.all([
        scheduledTask.createTask(),
        scheduledTask.getParameters()
      ]).spread(function(task, parameters) {
        var data = {};
        _.each(parameters, function(param) {
          data[param.name] = JSON.parse(param.value);
        });

        debug('Dispatching scheduled task [' + task.id + ']');
        self.workerSocket.send(JSON.stringify({id: task.id, name: task.name, data: data}));

        // if it was recurring, schedule it again, otherwise destroy it
        if(scheduledTask.is_recurring) {
          return scheduledTask.updateAttributes({
            run_at: Date.now().valueOf() + scheduledTask.interval
          });
        } else {
          return scheduledTask.destroy();
        }
      });
    });
  }, function(err) {
    debug('Unable to find all scheduled tasks: ' + err);
  });
};

// periodically watch scheduled tasks and see if they are overdue
Martinet.prototype._start = function() {
  this._scheduledInterval = setInterval(_checkScheduledTasks.bind(this), humanInterval('5 seconds'));
};

Martinet.prototype.close = function() {
  this.workerSocket.close();
  this.statusSocket.close();
  this.clientSocket.close();
};
