export type Event = { readonly nome: string };

export type Listener<E extends Event> = (event: E) => void;

/**
 * Barramento in-process: publicar um evento é uma chamada de função. Não há
 * fila, nem rede, nem broker — mas o ACOPLAMENTO já é o de mensageria: quem
 * publica não sabe quem escuta.
 */
export class EventBus {
  private readonly listeners = new Map<string, Listener<never>[]>();

  subscribe<E extends Event>(nome: E["nome"], listener: Listener<E>): void {
    const atuais = this.listeners.get(nome) ?? [];

    this.listeners.set(nome, [...atuais, listener as Listener<never>]);
  }

  publish<E extends Event>(event: E): void {
    for (const listener of this.listeners.get(event.nome) ?? []) {
      (listener as unknown as Listener<E>)(event);
    }
  }
}
