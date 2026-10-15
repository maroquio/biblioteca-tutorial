export type Event = { readonly nome: string };

export type Listener<E extends Event> = (event: E) => void;

export class EventBus {
  private readonly listeners = new Map<string, Listener<never>[]>();

  subscribe<E extends Event>(nome: E["nome"], listener: Listener<E>): void {
    const atuais = this.listeners.get(nome) ?? [];

    this.listeners.set(nome, [...atuais, listener]);
  }

  publish<E extends Event>(event: E): void {
    for (const listener of this.listeners.get(event.nome) ?? []) {
      (listener as Listener<E>)(event);
    }
  }
}
