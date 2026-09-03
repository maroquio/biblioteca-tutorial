import type { Autor } from "../src/modules/autoria/domain/Autor";
import type { AutorRepository } from "../src/modules/autoria/domain/AutorRepository";
import { LivroId, type AutorId } from "../src/shared/identifiers";
import type { Isbn } from "../src/modules/acervo/domain/Isbn";
import type { Livro } from "../src/modules/acervo/domain/Livro";
import type { LivroRepository } from "../src/modules/acervo/domain/LivroRepository";

export class InMemoryLivroRepository implements LivroRepository {
  private items: Livro[] = [];
  private nextId = 1;

  contarNoAcervoDoAutor(autorId: AutorId): number {
    return this.items.filter((item) => item.autorId.equals(autorId)).length;
  }

  contarCatalogadosNoAno(ano: string): number {
    return this.items.filter((item) => item.dataCatalogacao.startsWith(ano))
      .length;
  }

  insert(livro: Livro): Livro {
    const salvo = livro.withId(new LivroId(this.nextId++));
    this.items.push(salvo);

    return salvo;
  }

  findByIsbn(isbn: Isbn): Livro | null {
    return this.items.find((item) => item.isbn.equals(isbn)) ?? null;
  }

  findByAutorId(autorId: AutorId): Livro[] {
    return this.items.filter((item) => item.autorId.equals(autorId));
  }

  searchByTitulo(termo: string): Livro[] {
    const alvo = termo.toLowerCase();

    return this.items.filter((item) => item.titulo.toLowerCase().includes(alvo));
  }

  searchByNomeDoAutor(_termo: string): Livro[] {
    // ⚠️ o dublê não sabe responder: esta é uma pergunta sobre AUTORES, e um
    // repositório de livros em memória não tem como conhecê-los. Fase 50.
    throw new Error("searchByNomeDoAutor não tem como ser respondido em memória");
  }
}

export class InMemoryAutorRepository implements AutorRepository {
  constructor(private readonly items: Autor[]) {}

  findById(autorId: AutorId): Autor | null {
    return this.items.find((item) => item.id.equals(autorId)) ?? null;
  }
}
