import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { PostgresRoomStore } from './postgres-room-store.js';
import type { RoomSqlExecutor } from './postgres-room-store.js';
import type { RoomStore } from './room-state.js';
import { RoomService } from './room-service.js';

export const ROOM_STORE = Symbol('NCO_ROOM_STORE');
/** Host owns the Pool lifecycle and runs explicit migrations before serving requests. No listener here. */
export class RoomModule {
  static register(sql: RoomSqlExecutor): DynamicModule {
    return { module: RoomModule, providers: [
      { provide: ROOM_STORE, useValue: new PostgresRoomStore(sql) },
      { provide: RoomService, useFactory: (store: RoomStore) => new RoomService(store), inject: [ROOM_STORE] },
    ], exports: [RoomService] };
  }
}
Module({})(RoomModule);
