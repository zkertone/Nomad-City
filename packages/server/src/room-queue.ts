/** Local scheduling only. PostgreSQL CAS remains necessary across service instances/processes. */
export class RoomQueue {
  private readonly tails = new Map<string, Promise<void>>();
  get pendingRoomCount(): number { return this.tails.size; }
  async run<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(roomId) ?? Promise.resolve();
    const current = previous.then(work);
    const tail = current.then(() => undefined, () => undefined);
    this.tails.set(roomId, tail);
    try { return await current; }
    finally { if (this.tails.get(roomId) === tail) this.tails.delete(roomId); }
  }
}
