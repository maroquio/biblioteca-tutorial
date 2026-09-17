import type { Autor } from "./domain/Autor";

export type AutorJson = {
  id: number;
  nome: string;
  tipo: string;
  orcid: string | null;
  livrosNoAcervo: number;
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