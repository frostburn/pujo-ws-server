import {ServerWebSocket} from 'bun';
import {ClientMessage, DatabaseMessage, DatabaseQuery} from '../api';

export class DatabaseSocket {
  socket: ServerWebSocket<{socketId: number}>;
  authorization: string;

  constructor(
    socket: ServerWebSocket<{socketId: number}>,
    authorization: string
  ) {
    this.socket = socket;
    this.authorization = authorization;
  }

  send(message: DatabaseQuery) {
    this.socket.send(JSON.stringify(message));
  }

  reject(content: ClientMessage | DatabaseMessage) {
    if (
      content.type === 'database:self' ||
      content.type === 'database:hello' ||
      content.type === 'database:user' ||
      content.type === 'database:replays' ||
      content.type === 'database:replay'
    ) {
      return content.authorization !== this.authorization;
    }
    return false;
  }
}
