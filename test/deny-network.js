// Preloaded by Node in the test process AND every inference worker.
const deny = () => { throw new Error('Network is forbidden in offline secret-scanner tests'); };
for (const protocol of ['http','https']) {
  const client = require(protocol);
  client.request = client.get = deny;
}
const net = require('net');
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
global.fetch = deny;
