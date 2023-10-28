import {ServerWebSocket} from 'bun';
import {ApplicationInfo} from 'pujo-puyo-core';
import {ServerMessage} from '../api';

export class Player {
  socket: ServerWebSocket<{socketId: number}>;
  name: string;
  verbose: boolean;
  eloRealtime: number;
  eloPausing: number;
  authUuid?: string;
  clientInfo?: ApplicationInfo;

  constructor(
    socket: ServerWebSocket<{socketId: number}>,
    name: string,
    verbose = false
  ) {
    this.socket = socket;
    this.name = name;
    this.verbose = verbose;
    this.eloPausing = 1000;
    this.eloRealtime = 1000;
  }

  send(message: ServerMessage) {
    if (this.verbose) {
      console.log('Sending', this.socket.data.socketId, ':', message);
    }
    this.socket.send(JSON.stringify(message));
  }
}
