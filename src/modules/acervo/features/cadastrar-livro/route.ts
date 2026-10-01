import type { Hono } from "hono";
import type { UseCases } from "../../../../composition";
import { parseNovoLivro } from "./input";
import type { Livro } from "../../domain/Livro";

export function register(routes: Hono, useCases: UseCases): void {
  routes.post("/livros", async (contexto) => {
    const livro = useCases.cadastrarLivro.execute(
      parseNovoLivro(await contexto.req.json()),
    );

    contexto.header("Location", `/livros/${livro.isbn}`);

    return contexto.json(livro, 201);
  });
}

export type IsbnCorrigidoJson = {
  id: number;
  numeroRegistro: string;
  isbn: string;
};

export function isbnCorrigidoToJson(livro: Livro): IsbnCorrigidoJson {
  return {
    id: livro.id!.value,
    numeroRegistro: livro.numeroRegistro.value,
    isbn: livro.isbn.value,
  };
}