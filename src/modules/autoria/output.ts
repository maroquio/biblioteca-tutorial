import type { Autor } from "./domain/Autor";
import type { Obra } from "./domain/ConsultaDeAcervo";

export type AutorJson = {
  id: number;
  nome: string;
  tipo: string;
  orcid: string | null;
  livrosNoAcervo: number;
};

export type AutorComObrasJson = AutorJson & {
  obras: { titulo: string; isbn: string }[];
};

export function autorToJson(autor: Autor): AutorJson {
  return {
    id: autor.id!.value,
    nome: autor.nome,
    tipo: autor.tipo,
    orcid: autor.orcid?.value ?? null,
    livrosNoAcervo: autor.livrosNoAcervo,
  };
}

export function autorComObrasToJson(
  autor: Autor,
  obras: Obra[],
): AutorComObrasJson {
  return {
    ...autorToJson(autor),
    obras: obras.map((obra) => ({ titulo: obra.titulo, isbn: obra.isbn })),
  };
}
