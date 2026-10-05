import { createServer } from 'node:http';
import { app } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
createServer(app).listen(port, host, () => {
  console.log(`Passiton backend: http://${host}:${port}`);
});
