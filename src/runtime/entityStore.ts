// Owns the runtime entity view boundary for persistent and transient entities.
// RuntimeWorld keeps the public Map fields for compatibility, while this store
// centralizes merged-list caching, cache invalidation, and narrow lookup helpers.
// Keep this class small: gameplay systems should query through it without moving
// collision, combat, or behavior ownership into this module.
import type { Entity } from "../project/schema";
import type { EntityId } from "../shared/types";

export class RuntimeEntityStore {
  readonly persistent = new Map<string, Entity>();
  readonly transient = new Map<string, Entity>();
  private allCache?: Entity[];

  all(): Entity[] {
    if (!this.allCache) this.allCache = [...this.persistent.values(), ...this.transient.values()];
    return this.allCache;
  }

  byId(entityId: EntityId | undefined): Entity | undefined {
    if (!entityId) return undefined;
    return this.persistent.get(entityId) || this.transient.get(entityId);
  }

  persistentValues(): IterableIterator<Entity> {
    return this.persistent.values();
  }

  transientValues(): IterableIterator<Entity> {
    return this.transient.values();
  }

  has(entityId: EntityId | string): boolean {
    return this.persistent.has(entityId) || this.transient.has(entityId);
  }

  setPersistent(entity: Entity): void {
    this.persistent.set(entity.id, entity);
    this.invalidate();
  }

  setTransient(entity: Entity): void {
    this.transient.set(entity.id, entity);
    this.invalidate();
  }

  deletePersistent(entityId: EntityId | string): boolean {
    const removed = this.persistent.delete(entityId);
    if (removed) this.invalidate();
    return removed;
  }

  deleteTransient(entityId: EntityId | string): boolean {
    const removed = this.transient.delete(entityId);
    if (removed) this.invalidate();
    return removed;
  }

  replaceTransients(entities: Iterable<Entity>): void {
    this.transient.clear();
    for (const entity of entities) this.transient.set(entity.id, entity);
    this.invalidate();
  }

  invalidate(): void {
    this.allCache = undefined;
  }
}
