/** Livro é o catálogo; exemplar é a cópia física. Os campos seguem o JSON da API. */
export type Book = {
  id: number;
  isbn: string;
  titulo: string;
  autorId: number;
  autor: string;
  livrosDoAutor: number;
  dataCatalogacao: string;
  totalExemplares: number;
  exemplaresDisponiveis: number;
};

/** UC24: o livro e a distância cosseno até a consulta (0 = mesmo sentido). */
export type SemanticBook = Book & { distancia: number };

export type Copy = {
  id: number;
  livroId: number;
  numeroRegistro: string;
  localizacao: string;
  estadoConservacao: string;
  dataCatalogacao: string;
  situacao: "disponivel" | "reservado" | "emprestado";
  titulo: string;
  isbn: string;
};
