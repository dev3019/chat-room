require('dotenv').config({ path: '.env' });
const redis = require('redis');


const { RED_HOST, RED_PORT } = process.env;

const clientRds = new redis.createClient({
  socket: {
    host: RED_HOST,
    port: RED_PORT,
  },
})
const publisher = new redis.createClient({
  socket: {
    host: RED_HOST,
    port: RED_PORT,
  },
})

clientRds.connect();

publisher.connect();

clientRds.on('error', (error) => {
  console.log('Redis-error: ', error);
});

clientRds.on('ready', async() => {
  console.log('Redis client connected');

  clientRds
    .ping()
    .then((result) => console.log(`Redis server responded to ping: ${result}`))
    .catch((error) => console.error('Redis-Ping', error));
});
publisher.on('error', (error) => {
  console.log('Redis-error: ', error);
});

publisher.on('ready', async() => {
  console.log('Redis client connected');

  publisher
    .ping()
    .then((result) => console.log(`Redis server responded to ping: ${result}`))
    .catch((error) => console.error('Redis-Ping', error));
});
module.exports = {clientRds, publisher};