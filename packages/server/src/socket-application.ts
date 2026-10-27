import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { DynamicModule, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server } from 'socket.io';
import type { ServerOptions } from 'socket.io';
import type { RoomSqlExecutor } from './postgres-room-store.js';
import { RoomModule } from './room.module.js';
import { RoomGateway } from './room.gateway.js';
import { SessionService } from './sessions.js';
import { RoomDirectory } from './room-directory.js';
import { LobbyService } from './lobby-service.js';
import { ROOM_SOCKET_OPTIONS, socketOptionsSchema } from './socket-protocol.js';
import type { RoomSocketOptions } from './socket-protocol.js';

export interface RoomSocketApplicationOptions extends RoomSocketOptions {
  readonly sql: RoomSqlExecutor;
  readonly sessionClock?: () => number;
}
class OriginIoAdapter extends IoAdapter {
  constructor(app: INestApplication, private readonly origins: readonly string[]) { super(app); }
  override createIOServer(port: number, options: Partial<ServerOptions> = {}): Server {
    const configured: Partial<ServerOptions> = { ...options, transports: ['websocket'], maxHttpBufferSize: 64 * 1024,
      cors: { origin: [...this.origins] },
      allowRequest: (request, callback) => callback(null, typeof request.headers.origin === 'string' && this.origins.includes(request.headers.origin)),
    };
    return this.httpServer && port === 0 ? new Server(this.httpServer, configured) : new Server(port, configured);
  }
}
export class RoomSocketModule {
  static register(input: RoomSocketApplicationOptions): DynamicModule {
    const options = socketOptionsSchema.parse({ allowedOrigins: input.allowedOrigins });
    return { module: RoomSocketModule, imports: [RoomModule.register(input.sql)], providers: [
      { provide: ROOM_SOCKET_OPTIONS, useValue: options },
      { provide: SessionService, useFactory: () => new SessionService(input.sql, input.sessionClock) },
      { provide: RoomDirectory, useFactory: () => new RoomDirectory(input.sql) },
      { provide: LobbyService, useFactory: () => new LobbyService(input.sql) },
      RoomGateway,
    ], exports: [SessionService, RoomDirectory, LobbyService, RoomGateway] };
  }
}
Module({})(RoomSocketModule);
/** No migration, account issuance or listening side effects. Host owns SQL, bind address and lifecycle. */
export async function createRoomSocketApplication(options: RoomSocketApplicationOptions): Promise<INestApplication> {
  const checked = socketOptionsSchema.parse({ allowedOrigins: options.allowedOrigins });
  const app = await NestFactory.create(RoomSocketModule.register(options), { logger: false });
  app.useWebSocketAdapter(new OriginIoAdapter(app, checked.allowedOrigins));
  await app.init();
  return app;
}
