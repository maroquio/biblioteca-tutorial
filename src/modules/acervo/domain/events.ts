export type LivroCatalogado = {
  readonly nome: "LivroCatalogado";
  readonly autorId: number;
  readonly numeroRegistro: string;
  readonly em: string;
};

export type AcervoEvent = LivroCatalogado;

export interface EventPublisher {
  publish(event: AcervoEvent): void;
}
