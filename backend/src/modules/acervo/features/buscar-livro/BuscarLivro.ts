import type { ConsultaDeAutoria } from "../../domain/ConsultaDeAutoria";
import { Isbn } from "../../domain/Isbn";
import type { Livro } from "../../domain/Livro";
import type { LivroRepository } from "../../domain/LivroRepository";
import { livroToJson, type LivroJson } from "../../output";

export class BuscarLivro {
  constructor(
    private readonly livros: LivroRepository,
    private readonly autoria: ConsultaDeAutoria,
  ) {}

  async execute(q: string): Promise<LivroJson[]> {
    if (Isbn.isValid(q)) {
      const porIsbn = await this.livros.findByIsbn(new Isbn(q));

      if (porIsbn) return [await this.comAutor(porIsbn)];
    }

    const porTitulo = await this.livros.searchByTitulo(q);

    if (porTitulo.length > 0) return this.comAutores(porTitulo);

    // pergunta à autoria QUEM bate com o nome, e filtra os próprios livros
    const autorIds = await this.autoria.idsPorNome(q);

    return this.comAutores(await this.livros.findByAutorIds(autorIds));
  }

  private comAutores(livros: Livro[]): Promise<LivroJson[]> {
    return Promise.all(livros.map((livro) => this.comAutor(livro)));
  }

  private async comAutor(livro: Livro): Promise<LivroJson> {
    const autor = await this.autoria.autor(livro.autorId);

    return livroToJson(livro, autor!);
  }
}
