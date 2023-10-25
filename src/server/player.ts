import {ServerWebSocket} from 'bun';
import {ApplicationInfo} from 'pujo-puyo-core';
import {ServerMessage} from '../api';

export class Player {
  socket: ServerWebSocket<{socketId: number}>;
  name: string;
  eloRealtime: number;
  eloPausing: number;
  authUuid?: string;
  clientInfo?: ApplicationInfo;

  constructor(socket: ServerWebSocket<{socketId: number}>, name: string) {
    this.socket = socket;
    this.name = name;
    this.eloPausing = 1000;
    this.eloRealtime = 1000;
  }

  send(message: ServerMessage) {
    this.socket.send(JSON.stringify(message));
  }
}
