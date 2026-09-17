export type LivroCatalogado = {
  readonly nome: "LivroCatalogado";
  readonly autorId: number;
  readonly numeroRegistro: string;
  readonly em: string;
};

export type LivroBaixado = {
  readonly nome: "LivroBaixado";
  readonly autorId: number;
  readonly numeroRegistro: string;
  readonly motivo: string;
  readonly em: string;
};

export type AcervoEvent = LivroCatalogado | LivroBaixado;

/** Port de saída: o módulo anuncia o que aconteceu e não sabe quem ouve. */
export interface EventPublisher {
  publish(event: AcervoEvent): void;
}