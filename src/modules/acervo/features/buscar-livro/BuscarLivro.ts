import type { AutorRepository } from "../../../autoria/domain/AutorRepository";
import { Isbn } from "../../domain/Isbn";
import type { Livro } from "../../domain/Livro";
import type { LivroRepository } from "../../domain/LivroRepository";
import { livroToJson, type LivroJson } from "../../output";

export class BuscarLivro {
  constructor(
    private readonly livros: LivroRepository,
    private readonly autores: AutorRepository,
  ) {}

  execute(q: string): LivroJson[] {
    if (Isbn.isValid(q)) {
      const porIsbn = this.livros.findByIsbn(new Isbn(q));

      if (porIsbn) return [this.comAutor(porIsbn)];
    }

    const porTitulo = this.livros.searchByTitulo(q);

    if (porTitulo.length > 0) return porTitulo.map((l) => this.comAutor(l));

    // ⚠️ a pergunta que não é do acervo. Fase 50.
    return this.livros.searchByNomeDoAutor(q).map((l) => this.comAutor(l));
  }

  private comAutor(livro: Livro): LivroJson {
    const autor = this.autores.findById(livro.autorId);

    return livroToJson(livro, autor!);
  }
}
