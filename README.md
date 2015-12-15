# Martinet

Task management loosely based on [martinet](github.com/mathisonian/martinet)

Martinet is a database-backed, zeroMQ-based distributed task management system. It is persistent with respect to future and recurring tasks, so if your system goes down, those tasks will be unaffected. Martinet can use any [sequelize.js](github.com/sequelize/sequelize) compatible database as its backing database (SQLite is used by default).

Key differences between the original Martinet and this one is the following:

- Uses broker-dealer/response sockets to handle job distribution
- All workers must implement the same set of jobs, otherwise an error will be thrown that the
  handler was unable to handle the required task

## Installation

`npm install martinet`


## Usage

This library is divided into two parts: the `Martinet` object, which
handles dispatching and scheduling tasks, and the `Worker` object
which receives said tasks and defines the actions to take upon being
given certain tasks.

### Martinet


#### Setup

```javascript
var Martinet = require('martinet');

var martinet = new Martinet();

// The worker will register itself with the server letting the
// server know when it is ready for work
var worker = new Martinet.Worker();

```

#### Creating Tasks

##### Execute a task immediately

```javascript

martinet.execute({
    username: 'user', // Useful for tracking who ran what tasks
    name: 'task_name',
    description: 'Do a thing' // Used in the backend so it's easier to lookup tasks later
}, args);

// args JSON object of named arguments, so like
// {
//    thing_id: 1
// }
//
// this object gets serialized and passed to the Worker

```

##### Execute a task in the future

```javascript

martinet.schedule('in 20 minutes', {
    username: 'user',
    name: 'task_name',
    description: 'Do a thing in 20 minutes'
}, args);

```

##### Create a recurring task

```javascript

martinet.every('30 minutes', {
    username: 'user',
    name: 'task_name',
    description: 'Do a thing every half hour',
    run_at: 'midnight' // optional time to start the recurring task
}, args);

```

### Workers


#### Setup

```javascript

var MartinetWorker = require('martinet').Worker;

var worker = new MartinetWorker({
    martinet_url: '127.0.0.1', // URL for dealer socket
    worker_port: '8089', // Port for dealer socket
    status_port: '18089' // Port for worker status updates
});
```

#### Defining Tasks


```javascript

worker.on('task_name', function(taskId, data, callback) {
    // do a thing.
    // if it's successful, callback(),
    // if there's an error, callback(err)
});

```

## Options

### Martinet

#### Port

Custom port for martinet's pull socket to listen on.

```javascript
var Martinet = require('martinet');

var options = {
  martinet_url: '127.0.0.1', // URL for dealer socket, must match worker URL
  client_port: '8008', // Router port used for processing incoming requests
  worker_port: '8009', // Port used for the dealer socket, must match worker PORT
  status_port: '18009', // Port used to receive status from workers, must match worker PORT
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

var martinet = new Martinet(options);
```

#### DB

Connection information to the backing database. Uses [sequelize.js options](http://sequelizejs.com/docs/1.7.8/usage#options).

default is 

```javascript
var Martinet = require('martinet');

var options = {
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

var martinet = new Martinet(options);
```

but for example to use postgres:

```javascript
var Martinet = require('martinet');

var options = {
  db: {
    database: 'martinet-db',
    username: process.env.USER,
    password: null,
    options: {
      dialect: 'postgres',
      port: 5432,
      host: 'database.host'
      logging: false,
      omitNull: true
    },
    sync: true
  }
};

var martinet = new Martinet(options);
```

### Worker

#### Martinet URL

Connection string to connect to martinet. If worker is on the same machine as martinet, this should be 127.0.0.1 

#### Martinet PORT

The port to connect to martinet on. This should be the same port defined by the martinet object's port option.

### Status PORT

The port used to send status notifications back to the martinet server. This would include progress and error notificaitons.
