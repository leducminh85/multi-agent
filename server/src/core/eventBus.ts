import { EventEmitter } from 'node:events';

export type EventType =
  | 'agent.updated'
  | 'agent.deleted'
  | 'task.updated'
  | 'task.step'
  | 'task.stream'
  | 'mission.updated'
  | 'message.created'
  | 'activity.created'
  | 'usage.recorded'
  | 'alert.updated'
  | 'provider.updated'
  | 'file.updated'
  | 'knowledge.updated'
  | 'approval.updated'
  | 'project.updated'
  | 'system.updated';

export interface BusEvent<T = unknown> {
  type: EventType;
  payload: T;
  ts: string;
}

/**
 * In-process event bus. Every state change is published here; the WebSocket layer
 * fans events out to clients. The interface is intentionally small so it can be
 * backed by Redis pub/sub or NATS when the runtime is distributed across machines.
 */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish<T>(type: EventType, payload: T): void {
    const event: BusEvent<T> = { type, payload, ts: new Date().toISOString() };
    this.emitter.emit('event', event);
  }

  subscribe(handler: (e: BusEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }
}
