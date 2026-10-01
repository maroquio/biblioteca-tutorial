import type {
  AutorConhecido,
  ConsultaDeAutoria,
} from "../src/modules/acervo/domain/ConsultaDeAutoria";
import { AutorId, LivroId } from "../src/shared/identifiers";
import type { Isbn } from "../src/modules/acervo/domain/Isbn";
import type { Livro } from "../src/modules/acervo/domain/Livro";
import type {
  AcervoEvent,
  EventPublisher,
} from "../src/modules/acervo/domain/events";
import type { LivroRepository } from "../src/modules/acervo/domain/LivroRepository";

export class InMemoryLivroRepository implements LivroRepository {
  private items: Livro[] = [];
  private nextId = 1;

  async contarNoAcervoDoAutor(autorId: AutorId): Promise<number> {
    return this.items.filter((item) => item.autorId.equals(autorId)).length;
  }

  async contarCatalogadosNoAno(ano: string): Promise<number> {
    return this.items.filter((item) => item.dataCatalogacao.startsWith(ano))
      .length;
  }

  async insert(livro: Livro): Promise<Livro> {
    const salvo = livro.withId(new LivroId(this.nextId++));
    this.items.push(salvo);

    return salvo;
  }

  async findByIsbn(isbn: Isbn): Promise<Livro | null> {
    return this.items.find((item) => item.isbn.equals(isbn)) ?? null;
  }

  async findByAutorId(autorId: AutorId): Promise<Livro[]> {
    return this.items.filter((item) => item.autorId.equals(autorId));
  }

  async searchByTitulo(termo: string): Promise<Livro[]> {
    const alvo = termo.toLowerCase();

    return this.items.filter((item) => item.titulo.toLowerCase().includes(alvo));
  }

  async findByAutorIds(autorIds: AutorId[]): Promise<Livro[]> {
    return this.items.filter((item) =>
      autorIds.some((autorId) => item.autorId.equals(autorId)),
    );
  }
}

export class InMemoryAutoria implements ConsultaDeAutoria {
  constructor(private readonly items: Record<number, AutorConhecido>) {}

  async autor(autorId: AutorId): Promise<AutorConhecido | null> {
    return this.items[autorId.value] ?? null;
  }

  async idsPorNome(termo: string): Promise<AutorId[]> {
    const alvo = termo.toLowerCase();

    return Object.entries(this.items)
      .filter(([, autor]) => autor.nome.toLowerCase().includes(alvo))
      .map(([id]) => new AutorId(Number(id)));
  }
}

export class FakeEventPublisher implements EventPublisher {
  readonly published: AcervoEvent[] = [];

  async publish(event: AcervoEvent): Promise<void> {
    this.published.push(event);
  }
}
