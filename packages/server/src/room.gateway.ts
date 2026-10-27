import { Inject } from '@nestjs/common';
import { Ack, ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { deepFreeze, gameEntityIdSchema } from '@nomad-city-online/game-core';
import type { GamePlayerView, GameState } from '@nomad-city-online/game-core';
import { RoomService } from './room-service.js';
import type { RoomReadResult, RoomSubmitResult, TrustedRoomCommitResult } from './room-service.js';
import type { RoomPrincipal, RoomSnapshot } from './room-state.js';
import { RoomQueue } from './room-queue.js';
import { SessionService } from './sessions.js';
import { RoomDirectory, roomListRequestSchema } from './room-directory.js';
import type { RoomListResult } from './room-directory.js';
import { LobbyService } from './lobby-service.js';
import { lobbyCommandSchema, lobbyCreateSchema, lobbyIdSchema, lobbyJoinSchema, lobbyListSchema } from './lobby-state.js';
import type { LobbyListResult, LobbyResult, LobbyView } from './lobby-state.js';
import type { EntryOptionsResult } from './entry-options.js';
import type { RoundSetupOptionsResult } from './round-setup-options.js';
import type { ActionOptionsResult } from './action-options.js';
import type { AutomaticProgress } from './automatic-lifecycle.js';
import { ROOM_SOCKET_OPTIONS, SOCKET_PROTOCOL_VERSION, socketAuthSchema, socketCommandSchema, socketRoomSchema, socketEmptySchema } from './socket-protocol.js';
import type { RoomSocketOptions, SessionInfo, SessionLogoutResult, SocketFailure } from './socket-protocol.js';

type Connection = { token: string; userId: string; expiresAt: number; rooms: Map<string, number>; lobbies: Map<string, number>; timer?: ReturnType<typeof setTimeout> };
const failure = (code: SocketFailure['error']['code']): SocketFailure => deepFreeze({ status: 'unavailable', error: { code } });
@WebSocketGateway({ namespace: '/game' })
export class RoomGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly pending = new WeakMap<Socket, Connection>();
  private readonly connections = new Map<Socket, Connection>();
  private readonly queue = new RoomQueue();
  constructor(@Inject(RoomService) private readonly rooms: RoomService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RoomDirectory) private readonly directory: RoomDirectory,
    @Inject(LobbyService) private readonly lobbies: LobbyService,
    @Inject(ROOM_SOCKET_OPTIONS) private readonly options: RoomSocketOptions) {}
  get connectionCount(): number { return this.connections.size; }
  afterInit(server: Namespace): void {
    server.use(async (socket, next) => {
      const auth = socketAuthSchema.safeParse(socket.handshake.auth);
      if (!this.options.allowedOrigins.includes(socket.handshake.headers.origin ?? '')) return next(new Error('ORIGIN_REJECTED'));
      if (!auth.success) return next(new Error('AUTH_REQUIRED'));
      try {
        const session = await this.sessions.resolve(auth.data.sessionToken);
        if (!session) return next(new Error('AUTH_REQUIRED'));
        this.pending.set(socket, { token: auth.data.sessionToken, userId: session.userId, expiresAt: session.expiresAt, rooms: new Map(), lobbies: new Map() });
        next();
      } catch { next(new Error('AUTH_UNAVAILABLE')); }
    });
  }
  handleConnection(socket: Socket): void {
    const record = this.pending.get(socket); this.pending.delete(socket);
    if (!record) { socket.disconnect(true); return; }
    this.connections.set(socket, record);
    record.timer = setTimeout(() => this.invalidate(socket, 'AUTH_REQUIRED'), Math.max(0, record.expiresAt - this.sessions.now()));
    record.timer.unref();
  }
  handleDisconnect(socket: Socket): void {
    const record = this.connections.get(socket);
    if (record?.timer) clearTimeout(record.timer);
    this.connections.delete(socket); this.pending.delete(socket);
  }
  private invalidate(socket: Socket, code: 'AUTH_REQUIRED' | 'AUTH_UNAVAILABLE'): SocketFailure {
    socket.emit('session:invalidated', { protocolVersion: SOCKET_PROTOCOL_VERSION, code });
    socket.disconnect(true); this.handleDisconnect(socket); return failure(code);
  }
  private async authenticate(socket: Socket): Promise<{ authenticatedUserId: string } | SocketFailure> {
    const record = this.connections.get(socket);
    if (!record || !socket.connected) return failure('AUTH_REQUIRED');
    try {
      const session = await this.sessions.resolve(record.token);
      if (this.connections.get(socket) !== record || !socket.connected) return failure('AUTH_REQUIRED');
      if (!session || session.userId !== record.userId) return this.invalidate(socket, 'AUTH_REQUIRED');
      return { authenticatedUserId: session.userId };
    } catch { return this.invalidate(socket, 'AUTH_UNAVAILABLE'); }
  }
  @SubscribeMessage('session:current')
  async currentSession(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<SessionInfo | SocketFailure> {
    if (!socketEmptySchema.safeParse(payload).success) return failure('INVALID_MESSAGE');
    const principal = await this.authenticate(socket); if ('status' in principal) return principal;
    return deepFreeze({ status: 'authenticated', protocolVersion: SOCKET_PROTOCOL_VERSION,
      userId: principal.authenticatedUserId, expiresAt: this.connections.get(socket)!.expiresAt });
  }
  @SubscribeMessage('room:list')
  async listRooms(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<RoomListResult | SocketFailure> {
    if (!roomListRequestSchema.safeParse(payload).success) return failure('INVALID_MESSAGE');
    try {
      const principal = await this.authenticate(socket); if ('status' in principal) return principal;
      const result = await this.directory.list(principal, payload);
      // A revoke/expiry during a slow directory query must not disclose the completed result.
      const current = await this.authenticate(socket); if ('status' in current) return current;
      return result;
    } catch { return failure('SERVER_UNAVAILABLE'); }
  }
  @SubscribeMessage('session:logout')
  async logout(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown,
    @Ack() ack?: (result: SessionLogoutResult | SocketFailure) => void): Promise<void> {
    const respond = (result: SessionLogoutResult | SocketFailure) => { if (typeof ack === 'function') ack(result); };
    if (!socketEmptySchema.safeParse(payload).success) { respond(failure('INVALID_MESSAGE')); return; }
    const principal = await this.authenticate(socket); if ('status' in principal) { respond(principal); return; }
    const record = this.connections.get(socket)!;
    try { await this.sessions.revoke(record.token); }
    catch { respond(failure('AUTH_UNAVAILABLE')); return; }
    // SQL deletion is confirmed first. Send the acknowledgement before disconnecting this credential's tabs.
    respond(deepFreeze({ status: 'logged-out', protocolVersion: SOCKET_PROTOCOL_VERSION }));
    for (const [peer, connection] of this.connections) if (connection.token === record.token) this.invalidate(peer, 'AUTH_REQUIRED');
  }
  private deliver(socket: Socket, roomId: string, view: GamePlayerView, automatic?: AutomaticProgress): void {
    const record = this.connections.get(socket), version = record?.rooms.get(roomId);
    if (!record || !socket.connected || version === undefined || view.public.stateVersion <= version) return;
    if (record.expiresAt <= this.sessions.now()) { this.invalidate(socket, 'AUTH_REQUIRED'); return; }
    record.rooms.set(roomId, view.public.stateVersion);
    socket.emit('room:state', { protocolVersion: SOCKET_PROTOCOL_VERSION, roomId, view, ...(automatic ? { automatic } : {}) });
  }
  private deliverLobby(socket: Socket, view: LobbyView): void {
    const record = this.connections.get(socket), version = record?.lobbies.get(view.lobbyId);
    if (!record || !socket.connected || version === undefined || view.version <= version) return;
    if (record.expiresAt <= this.sessions.now()) { this.invalidate(socket, 'AUTH_REQUIRED'); return; }
    record.lobbies.set(view.lobbyId, view.version);
    socket.emit('lobby:state', { protocolVersion: SOCKET_PROTOCOL_VERSION, lobbyId: view.lobbyId, view });
  }
  private async publishLobby(lobbyId: string): Promise<void> {
    await Promise.allSettled([...this.connections.keys()].map(async socket => {
      const record = this.connections.get(socket); if (!record?.lobbies.has(lobbyId)) return;
      const principal = await this.authenticate(socket); if ('status' in principal) return;
      const result = await this.lobbies.read(lobbyId, principal);
      const current = await this.authenticate(socket); if ('status' in current) return;
      if ('view' in result) this.deliverLobby(socket, result.view);
      else { record.lobbies.delete(lobbyId); socket.emit('lobby:unavailable', { lobbyId, error: result.status === 'unavailable' ? result.error : { code: 'LOBBY_UNAVAILABLE' } }); }
    }));
  }
  private async lobbyOperation(socket: Socket, work: (principal: RoomPrincipal) => Promise<LobbyResult>): Promise<LobbyResult | SocketFailure> {
    try {
      const principal = await this.authenticate(socket); if ('status' in principal) return principal;
      const result = await work(principal);
      if (result.status === 'joined' || result.status === 'updated' || result.status === 'left') {
        await this.publishLobby('view' in result ? result.view.lobbyId : result.lobbyId);
      }
      const current = await this.authenticate(socket); return 'status' in current ? current : result;
    } catch { return failure('SERVER_UNAVAILABLE'); }
  }
  @SubscribeMessage('lobby:create')
  async createLobby(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<LobbyResult | SocketFailure> {
    if (!lobbyCreateSchema.safeParse(payload).success) return failure('INVALID_MESSAGE');
    return this.lobbyOperation(socket, principal => this.lobbies.create(principal, payload));
  }
  @SubscribeMessage('lobby:join')
  async joinLobby(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<LobbyResult | SocketFailure> {
    const checked = lobbyJoinSchema.safeParse(payload); if (!checked.success) return failure('INVALID_MESSAGE');
    return this.queue.run(checked.data.lobbyId, () => this.lobbyOperation(socket, principal => this.lobbies.join(principal, payload)));
  }
  @SubscribeMessage('lobby:command')
  async lobbyCommand(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<LobbyResult | SocketFailure> {
    const checked = lobbyCommandSchema.safeParse(payload); if (!checked.success) return failure('INVALID_MESSAGE');
    return this.queue.run(checked.data.lobbyId, () => this.lobbyOperation(socket, principal => this.lobbies.command(principal, payload)));
  }
  @SubscribeMessage('lobby:list')
  async listLobbies(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<LobbyListResult | SocketFailure> {
    if (!lobbyListSchema.safeParse(payload).success) return failure('INVALID_MESSAGE');
    try {
      const principal = await this.authenticate(socket); if ('status' in principal) return principal;
      const result = await this.lobbies.list(principal, payload), current = await this.authenticate(socket);
      return 'status' in current ? current : result;
    } catch { return failure('SERVER_UNAVAILABLE'); }
  }
  @SubscribeMessage('lobby:subscribe')
  async subscribeLobby(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<LobbyResult | SocketFailure> {
    const checked = lobbyIdSchema.safeParse(payload); if (!checked.success) return failure('INVALID_MESSAGE');
    return this.queue.run(checked.data.lobbyId, async () => {
      try {
        const principal = await this.authenticate(socket); if ('status' in principal) return principal;
        const record = this.connections.get(socket)!;
        if (!record.lobbies.has(checked.data.lobbyId) && record.lobbies.size >= 8) return failure('SUBSCRIPTION_LIMIT');
        const result = await this.lobbies.read(checked.data.lobbyId, principal);
        const current = await this.authenticate(socket); if ('status' in current) return current;
        if ('view' in result) {
          if (!record.lobbies.has(checked.data.lobbyId)) record.lobbies.set(checked.data.lobbyId, -1);
          this.deliverLobby(socket, result.view);
        }
        return result;
      } catch { return failure('SERVER_UNAVAILABLE'); }
    });
  }
  @SubscribeMessage('lobby:unsubscribe')
  async unsubscribeLobby(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown) {
    const checked = lobbyIdSchema.safeParse(payload); if (!checked.success) return failure('INVALID_MESSAGE');
    return this.queue.run(checked.data.lobbyId, async () => {
      const principal = await this.authenticate(socket); if ('status' in principal) return principal;
      this.connections.get(socket)?.lobbies.delete(checked.data.lobbyId);
      return deepFreeze({ status: 'unsubscribed' as const, lobbyId: checked.data.lobbyId });
    });
  }
  /** Called under the gateway room queue, only after a committed write or an explicit authenticated read. */
  private async publish(roomId: string): Promise<void> {
    const targets = [...this.connections.keys()];
    const results = await Promise.allSettled(targets.map(async socket => {
      const record = this.connections.get(socket); if (!record?.rooms.has(roomId)) return;
      const principal = await this.authenticate(socket); if ('status' in principal) return;
      const result = await this.rooms.readCommittedView(roomId, principal);
      if (result.status === 'ready') {
        const current = await this.authenticate(socket);
        if (!('status' in current)) this.deliver(socket, roomId, result.view, result.automatic);
      }
      else { record.rooms.delete(roomId); socket.emit('room:unavailable', { roomId, error: result.error }); }
    }));
    for (const [index, result] of results.entries()) if (result.status === 'rejected') {
      const socket = targets[index]!; this.connections.get(socket)?.rooms.delete(roomId);
      socket.emit('room:unavailable', { roomId, error: { code: 'SERVER_UNAVAILABLE' } });
    }
  }
  @SubscribeMessage('room:subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<RoomReadResult | SocketFailure> {
    const checked = socketRoomSchema.safeParse(payload); if (!checked.success) return failure('INVALID_MESSAGE');
    return this.queue.run(checked.data.roomId, async () => {
      try {
        const principal = await this.authenticate(socket); if ('status' in principal) return principal;
        const record = this.connections.get(socket)!;
        if (!record.rooms.has(checked.data.roomId) && record.rooms.size >= 8) return failure('SUBSCRIPTION_LIMIT');
        const result = await this.rooms.readView(checked.data.roomId, principal);
        const current = await this.authenticate(socket); if ('status' in current) return current;
        if (result.status === 'ready' && this.connections.get(socket) === record) {
          if (!record.rooms.has(checked.data.roomId)) record.rooms.set(checked.data.roomId, -1);
          this.deliver(socket, checked.data.roomId, result.view, result.automatic);
        }
        if (result.automatic) {
          await this.publish(checked.data.roomId);
          const last = await this.authenticate(socket); if ('status' in last) return last;
        }
        return result;
      } catch { return failure('SERVER_UNAVAILABLE'); }
    });
  }
  @SubscribeMessage('room:entry-options')
  async entryOptions(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<EntryOptionsResult | SocketFailure> {
    const checked = socketRoomSchema.safeParse(payload); if (!checked.success) return failure('INVALID_MESSAGE');
    return this.queue.run(checked.data.roomId, async () => {
      try {
        const principal = await this.authenticate(socket); if ('status' in principal) return principal;
        const result = await this.rooms.readEntryOptions(checked.data.roomId, principal);
        const current = await this.authenticate(socket); return 'status' in current ? current : result;
      } catch { return failure('SERVER_UNAVAILABLE'); }
    });
  }
  @SubscribeMessage('room:round-setup-options')
  async roundSetupOptions(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<RoundSetupOptionsResult | SocketFailure> {
    const checked = socketRoomSchema.safeParse(payload); if (!checked.success) return failure('INVALID_MESSAGE');
    return this.queue.run(checked.data.roomId, async () => {
      try {
        const principal = await this.authenticate(socket); if ('status' in principal) return principal;
        const result = await this.rooms.readRoundSetupOptions(checked.data.roomId, principal);
        const current = await this.authenticate(socket); return 'status' in current ? current : result;
      } catch { return failure('SERVER_UNAVAILABLE'); }
    });
  }
  // Read-only action candidates use the same room queue and authentication boundary as writes.
  @SubscribeMessage('room:action-options')
  async actionOptions(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<ActionOptionsResult | SocketFailure> {
    const checked = socketRoomSchema.safeParse(payload); if (!checked.success) return failure('INVALID_MESSAGE');
    return this.queue.run(checked.data.roomId, async () => {
      try {
        const principal = await this.authenticate(socket); if ('status' in principal) return principal;
        const result = await this.rooms.readActionOptions(checked.data.roomId, principal);
        const current = await this.authenticate(socket); return 'status' in current ? current : result;
      } catch { return failure('SERVER_UNAVAILABLE'); }
    });
  }
  @SubscribeMessage('room:command')
  async command(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown): Promise<RoomSubmitResult | SocketFailure> {
    const checked = socketCommandSchema.safeParse(payload); if (!checked.success) return failure('INVALID_MESSAGE');
    return this.queue.run(checked.data.roomId, async () => {
      try {
        const principal = await this.authenticate(socket); if ('status' in principal) return principal;
        const result = await this.rooms.submit(checked.data.roomId, principal, checked.data.request);
        if (result.status === 'committed' || result.automatic) await this.publish(checked.data.roomId);
        const current = await this.authenticate(socket); if ('status' in current) return current;
        return result;
      } catch { return failure('SERVER_UNAVAILABLE'); }
    });
  }
  @SubscribeMessage('room:unsubscribe')
  async unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown) {
    const checked = socketRoomSchema.safeParse(payload); if (!checked.success) return failure('INVALID_MESSAGE');
    return this.queue.run(checked.data.roomId, async () => {
      const principal = await this.authenticate(socket); if ('status' in principal) return principal;
      this.connections.get(socket)?.rooms.delete(checked.data.roomId);
      return deepFreeze({ status: 'unsubscribed' as const, roomId: checked.data.roomId });
    });
  }
  /** Internal only: persist a trusted stage transition, then refresh each authorized subscriber separately. */
  async commitTrustedTransition(roomId: string, expectedVersion: number, transition: (snapshot: RoomSnapshot) => GameState): Promise<TrustedRoomCommitResult> {
    gameEntityIdSchema.parse(roomId);
    return this.queue.run(roomId, async () => {
      const result = await this.rooms.commitTrustedTransition(roomId, expectedVersion, transition);
      if (result.status === 'committed') await this.publish(roomId);
      return result;
    });
  }
}
