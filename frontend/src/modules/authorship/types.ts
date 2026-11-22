/** Os campos seguem o JSON da API. */
export type Author = {
  id: number; nome: string; tipo: "literatura" | "didatico"; livrosNoAcervo: number;
  /** UC26: /api/autores/:id/foto?v=..., ou null se o autor não tem foto. */
  fotoUrl: string | null;
};
