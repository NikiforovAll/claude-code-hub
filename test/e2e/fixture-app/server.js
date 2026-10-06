const path = require('node:path');
const express = require('express');

const app = express();
require(process.env.HUB_SDK_SERVER).mount(app);
app.use(express.static(path.join(__dirname, 'public')));
const server = app.listen(Number(process.env.PORT) || 0, process.env.HOST || '127.0.0.1', () => {
  console.log(`running at http://localhost:${server.address().port}`);
});
