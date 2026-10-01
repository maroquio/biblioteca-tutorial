import { getBodyAsObject, getFieldAsPositiveInt, getFieldAsText } from "../../../../shared/validation";


export type CorrecaoDeTitulo = {
  id: number;
  titulo: string;
};

export function parseCorrecaoDeTitulo(
  params: { id?: string },
  body: unknown,
): CorrecaoDeTitulo {
  const data = getBodyAsObject(body);               // 4 arquivo novo...
  return {
    id: getFieldAsPositiveInt(params, "id"),
    titulo: getFieldAsText(data, "titulo"),
  };
}

export class CorrigirTitulo {
  constructor(private readonly livros: LivroRepository) {}

  execute(input: CorrecaoDeTitulo): TituloCorrigidoJson {
    const id = new LivroId(input.id);
    const livro = this.livros.findById(id);
    if (!livro) throw new NotFound("Livro não encontrado");

    const corrigido = livro.comTitulo(input.titulo);
    const duplicado = this.livros.findByAutorId(livro.autorId).some(            // 6 arquivo novo...
      (outro) => !outro.id?.equals(id) && outro.mesmoTituloQue(corrigido.titulo),
    );
    if (duplicado) {
      throw new RuleConflict("Este autor já tem um livro com este título");
    }

    this.livros.updateTitulo(corrigido);
    return tituloCorrigidoToJson(corrigido);
  }
}


export function register(routes: Hono, useCases: UseCases): void {
  routes.patch("/livros/:id/titulo", async (contexto) => {
    const input = parseCorrecaoDeTitulo(                                // 7 arquivo novo...
      contexto.req.param(),
      await contexto.req.json(),
    );
    return contexto.json(useCases.corrigirTitulo.execute(input), 200);
  });
}
