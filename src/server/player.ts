import {ServerWebSocket} from 'bun';
import {ApplicationInfo} from 'pujo-puyo-core';
import {ServerMessage} from '../api';

export class Player {
  // System
  socket: ServerWebSocket<{socketId: number}>;
  // User-managed
  name: string;
  isBot: boolean;
  clientInfo?: ApplicationInfo;
  authUuid?: string;
  // Server-managed
  eloRealtime: number;
  eloPausing: number;
  // Logging
  verbose: boolean;

  constructor(
    socket: ServerWebSocket<{socketId: number}>,
    name: string,
    verbose = false
  ) {
    this.socket = socket;
    this.name = name;
    this.isBot = false;
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
