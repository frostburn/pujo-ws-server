import {WebSocketServer} from 'ws';

const wss = new WebSocketServer({port: 3003});

wss.on('connection', ws => {
  ws.on('error', console.error);

  ws.on('message', data => {
    console.log('received: %s', data);
  });

  ws.send('something');
});
