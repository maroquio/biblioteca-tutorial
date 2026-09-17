import type { Autor } from "../src/modules/autoria/domain/Autor";
import type { AutorRepository } from "../src/modules/autoria/domain/AutorRepository";
import type { Orcid } from "../src/modules/autoria/domain/Orcid";
import type {
  AutorConhecido,
  ConsultaDeAutoria,
} from "../src/modules/acervo/domain/ConsultaDeAutoria";
import { AutorId, LivroId } from "../src/shared/identifiers";
import type { Isbn } from "../src/modules/acervo/domain/Isbn";
import type { Livro } from "../src/modules/acervo/domain/Livro";
import type { NumeroRegistro } from "../src/modules/acervo/domain/NumeroRegistro";
import type {
  AcervoEvent,
  EventPublisher,
} from "../src/modules/acervo/domain/events";
import type { LivroRepository } from "../src/modules/acervo/domain/LivroRepository";

export class InMemoryLivroRepository implements LivroRepository {
  private items: Livro[] = [];
  private nextId = 1;

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

  findByNumeroRegistro(numero: NumeroRegistro): Livro | null {
    return (
      this.items.find((item) => item.numeroRegistro.value === numero.value) ??
      null
    );
  }

  findByAutorId(autorId: AutorId): Livro[] {
    return this.items.filter((item) => item.autorId.equals(autorId));
  }

  searchByTitulo(termo: string): Livro[] {
    const alvo = termo.toLowerCase();

    return this.items.filter((item) => item.titulo.toLowerCase().includes(alvo));
  }

  findByAutorIds(autorIds: AutorId[]): Livro[] {
    return this.items.filter((item) =>
      autorIds.some((autorId) => item.autorId.equals(autorId)),
    );
  }

  registrarBaixa(livro: Livro): void {
    this.items = this.items.map((item) =>
      item.id!.equals(livro.id!) ? livro : item,
    );
  }
}

export class InMemoryAutoria implements ConsultaDeAutoria {
  constructor(private readonly items: Record<number, AutorConhecido>) {}

  autor(autorId: AutorId): AutorConhecido | null {
    return this.items[autorId.value] ?? null;
  }

  idsPorNome(termo: string): AutorId[] {
    const alvo = termo.toLowerCase();

    return Object.entries(this.items)
      .filter(([, autor]) => autor.nome.toLowerCase().includes(alvo))
      .map(([id]) => new AutorId(Number(id)));
  }
}

export class FakeEventPublisher implements EventPublisher {
  readonly published: AcervoEvent[] = [];

  publish(event: AcervoEvent): void {
    this.published.push(event);
  }
}

export class InMemoryAutorRepository implements AutorRepository {
  private items: Autor[] = [];
  private nextId = 1;

  insert(autor: Autor): Autor {
    const salvo = autor.withId(new AutorId(this.nextId++));
    this.items.push(salvo);

    return salvo;
  }

  findById(autorId: AutorId): Autor | null {
    return this.items.find((item) => item.id?.equals(autorId)) ?? null;
  }

  findByOrcid(orcid: Orcid): Autor | null {
    return this.items.find((item) => item.orcid?.equals(orcid)) ?? null;
  }

  findByNomeSemelhante(nome: string): Autor[] {
    const alvo = nome.trim().toLowerCase();

    return this.items.filter((item) => item.nome.toLowerCase().includes(alvo));
  }

  ajustarLivrosNoAcervo(): void {
    /* a projeção não participa deste caso de uso */
  }
}