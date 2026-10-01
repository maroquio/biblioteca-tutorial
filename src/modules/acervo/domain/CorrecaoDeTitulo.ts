import { InvalidValue } from "../../../shared/domain-errors";
import { NotFound, RuleConflict } from "../../../shared/errors";
import { LivroId, type AutorId } from "../../../shared/identifiers";
import { getBodyAsObject, getFieldAsPositiveInt, getFieldAsText } from "../../../shared/validation";
import type { Isbn } from "./Isbn";
import type { Livro } from "./Livro";
import type { LivroRepository } from "./LivroRepository";
import { NumeroRegistro } from "./NumeroRegistro";  

export type CorrecaoDeTitulo = {
  id: number;
  titulo: string;
};

export function parseCorrecaoDeTitulo(
  params: { id?: string },
  body: unknown,
): CorrecaoDeTitulo {
  const data = getBodyAsObject(body);
  return {
    id: getFieldAsPositiveInt(params, "id"),
    titulo: getFieldAsText(data, "titulo"),
  };
}
export type TituloCorrigidoJson = {
  id: number;
  isbn: string;
  titulo: string;
};

export function tituloCorrigidoToJson(livro: Livro): TituloCorrigidoJson {
  return {
    id: livro.id!.value,
    isbn: livro.isbn.value,
    titulo: livro.titulo,
  };
}
export class CorrigirTitulo {
  constructor(private readonly livros: LivroRepository) {}

  execute(input: CorrecaoDeTitulo): TituloCorrigidoJson {
    const id = new LivroId(input.id);
    const livro = this.livros.findById(id);
    if (!livro) throw new NotFound("Livro não encontrado");

    const corrigido = livro.comTitulo(input.titulo);
    const duplicado = this.livros.findByAutorId(livro.autorId).some(
      (outro) => !outro.id?.equals(id) && outro.mesmoTituloQue(corrigido.titulo),
    );
    if (duplicado) {
      throw new RuleConflict("Este autor já tem um livro com este título");
    }

    this.livros.updateTitulo(corrigido);
    return tituloCorrigidoToJson(corrigido);
  }
}
