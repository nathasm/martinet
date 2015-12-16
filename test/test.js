'use strict';
var expect = require('expect.js');

var Martinet = require('../lib/martinet');
var _ = require('lodash');
var fs = require('fs');


describe('martinet tests', function() {

  var martinet;
  var worker;

  after(function(done) {
    fs.unlinkSync(process.cwd() + '/' + martinet.options.db.options.storage);
    done();
  });

  beforeEach(function() {
    martinet = new Martinet();
    worker = new Martinet.Worker();
  });

  afterEach(function() {
    martinet.close();
    worker.close();
  });

  it('should execute a simple task', function(done) {
    worker.on('add', function(taskId, data, cb) {
      var sum = _.reduce(data.numbers, function(memo, num) { return memo + num; }, 0);
      expect(sum).to.be(21);
      cb(null, sum);
    });

    martinet.onComplete(function(task) {
      done();
    });

    // We add the timeout for martinet to finish creating the sql database
    setTimeout(function() {
      martinet.execute({
        worker: 'username',
        name: 'add',
        descriptions: 'add some numbers'
      }, {
        numbers: [1, 2, 3, 4, 5, 6]
      });
    }, 100);
  });

  it('should execute another task', function(done) {
    worker.on('subtract', function(taskId, data, cb) {
      var sum = _.reduce(data.numbers, function(memo, num) { return memo - num; }, 0);
      expect(sum).to.be(-21);
      cb(null, sum);
    });

    martinet.onComplete(function(task) {
      done();
    });

    martinet.execute({
      worker: 'subtract_user',
      name: 'subtract',
      descriptions: 'add some numbers'
    }, {
      numbers: [1, 2, 3, 4, 5, 6]
    });
  });

  // TODO We should really try setting the progress from the worker instead of doing it from
  // martinet
  it('should be able to update progress', function(done) {
    worker.on('progress', function(taskId, data, cb) {
      cb();
    });

    martinet.onComplete(function(task) {
      martinet.setProgress(task.id, 0.5).then(function() {
        martinet.taskStatus({ worker: 'progress_user' }).then(function(data) {
          expect(data[0].progress).to.equal(0.5);
          done();
        });
      });
    });

    martinet.execute({
      worker: 'progress_user',
      name: 'progress',
      descriptions: 'set progress'
    }, {
      progress: 0.5
    });
  });

  it('should be able to handle an error', function(done) {
    martinet.onError(function(taskId) {
      martinet.taskStatus({ worker: 'error_user' }).then(function(data) {
        expect(data[0].error).to.equal(true);
        done();
      });
    });

    martinet.execute({
      worker: 'error_user',
      name: 'undefined_handler',
      descriptions: 'No handler is defined for undefined_handler'
    }, {});
  });

  it('should handle multiple workers', function(done) {
    var responses = {
      count: 0,
      sleep_user: false,
      new_sleep_user: false
    };
    var newWorker = new Martinet.Worker();
    var sleep = function(taskId, data, cb) {
      setTimeout(cb, data.timeout);
    };

    worker.on('sleep', sleep);
    newWorker.on('sleep', sleep);

    martinet.onComplete(function(task) {
      responses.count += 1;
      responses[task.worker] = true;
      if(responses.count === 2 && responses.sleep_user && responses.new_sleep_user) {
        done();
      }
    });

    setTimeout(function() {
      martinet.execute({
        worker: 'sleep_user',
        name: 'sleep',
        descriptions: 'add some numbers'
      }, {
        timeout: 500
      });
      martinet.execute({
        worker: 'new_sleep_user',
        name: 'sleep',
        descriptions: 'add some numbers'
      }, {
        timeout: 100
      });
    }, 500);
  });

  describe('taskStatus', function() {
    it('should return status for all tasks in the database', function() {
      return martinet.taskStatus().then(function(data) {
        expect(data.length).to.be(6);
        expect(data[0].id).to.equal(1);
        expect(data[0].worker).to.equal('username');
        expect(data[0].name).to.equal('add');
        expect(data[0].complete).to.equal(true);
        expect(data[0].error).to.equal(false);
        expect(data[0].progress).to.equal(1);
      });
    });

    it('should return status for a known user', function() {
      return martinet.taskStatus({ worker: 'username' }).then(function(data) {
        expect(data.length).to.be(1);
        expect(data[0].id).to.equal(1);
        expect(data[0].worker).to.equal('username');
        expect(data[0].name).to.equal('add');
        expect(data[0].complete).to.equal(true);
        expect(data[0].error).to.equal(false);
        expect(data[0].progress).to.equal(1);
      });
    });

    it('should return no status for an unknown user', function() {
      return martinet.taskStatus({ worker: 'foo' }).then(function(data) {
        expect(data.length).to.be(0);
      });
    });
  });

  describe('taskLog', function() {
    it('should get the task log', function() {
      return martinet.taskLog().then(function(data) {
        expect(data.length).to.be(1);
        expect(data[0].TaskId).to.be(4);
        expect(/.*undefined_handler.*/.test(data[0].content)).to.be(true);
      });
    });

    it('should get the task log given query parameters', function() {
      return martinet.taskLog({ TaskId: 4 }).then(function(data) {
        expect(data.length).to.be(1);
        expect(data[0].TaskId).to.be(4);
        expect(/.*undefined_handler.*/.test(data[0].content)).to.be(true);
      });
    });

    it('should not get the task log given bad query parameters', function() {
      return martinet.taskLog({ TaskId: 0 }).then(function(data) {
        expect(data.length).to.be(0);
      });
    });
  });
});
