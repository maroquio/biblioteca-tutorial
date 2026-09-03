import type { Clock } from "../../../../shared/Clock";
import type { ConsultaDeAutoria } from "../../domain/ConsultaDeAutoria";
import { Livro, toIso } from "../../domain/Livro";
import type { LivroRepository } from "../../domain/LivroRepository";
import { AutorId } from "../../../../shared/identifiers";
import { Isbn } from "../../domain/Isbn";
import { LimiteDeLivros } from "../../domain/LimiteDeLivros";
import { NotFound, RuleConflict } from "../../../../shared/errors";
import type { NovoLivro } from "./input";
import { livroToJson, type LivroJson } from "../../output";

export class CadastrarLivro {
  constructor(
    private readonly livros: LivroRepository,
    private readonly autoria: ConsultaDeAutoria,
    private readonly now: Clock,
  ) {}

  execute(input: NovoLivro): LivroJson {
    const isbn = new Isbn(input.isbn);
    const autorId = new AutorId(input.autorId);

    const autor = this.autoria.autor(autorId);

    if (!autor) {
      throw new NotFound("Autor não cadastrado");
    }

    LimiteDeLivros.verificar(
      autor.tiragem,
      this.livros.contarNoAcervoDoAutor(autorId),
    );

    if (this.livros.findByIsbn(isbn)) {
      throw new RuleConflict("Livro já cadastrado");
    }

    const mesmoTitulo = this.livros
      .findByAutorId(autorId)
      .some((livro) => livro.mesmoTituloQue(input.titulo));

    if (mesmoTitulo) {
      throw new RuleConflict("Este autor já tem um livro com este título");
    }

    const hoje = this.now();
    const ano = toIso(hoje).slice(0, 4);

    const livro = this.livros.insert(
      Livro.catalogar(
        isbn,
        input.titulo,
        autorId,
        hoje,
        this.livros.contarCatalogadosNoAno(ano),
      ),
    );

    return livroToJson(livro, autor);
  }
}
