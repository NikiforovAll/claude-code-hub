const path = require('node:path');
const express = require('express');
const { mount } = require('../../src/server');

const app = express();
mount(app);
app.use(express.static(path.join(__dirname, 'public')));
const server = app.listen(0, '127.0.0.1', () => process.send({ type: 'port', port: server.address().port }));
