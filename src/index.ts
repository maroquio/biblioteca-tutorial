import { db, createDb } from "./db";

createDb();

type Handler = (
  request: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

type Route = { method: string; pattern: string; handler: Handler };

function match(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i]!;
    const received = pathParts[i]!;

    if (expected.startsWith(":")) {
      params[expected.slice(1)] = received;
    } else if (expected !== received) {
      return null;
    }
  }

  return params;
}

const routes: Route[] = [
  {
    method: "GET",
    pattern: "/",
    handler: () => Response.json({ message: "API da Biblioteca" }),
  },
  {
    method: "POST",
    pattern: "/livros",
    handler: async (request) => {
      const body = (await request.json()) as {
        isbn: string;
        titulo: string;
        autorId: number;
      };

      const isbn = body.isbn.replace(/[^0-9]/g, "");
      const titulo = body.titulo;
      const autorId = body.autorId;

      const autor = db
        .query("SELECT * FROM autores WHERE id = ?")
        .get(autorId) as
        | { id: number; nome: string; orcid: string | null; tipo: string }
        | null;

      if (!autor) {
        return Response.json({ error: "Autor não cadastrado" }, { status: 404 });
      }

      const livrosDoAutor = db
        .query("SELECT COUNT(*) AS total FROM livros WHERE autor_id = ?")
        .get(autorId) as { total: number };

      const noAcervo = livrosDoAutor.total;
      const limite = autor.tipo === "didatico" ? 10 : 5;

      if (noAcervo >= limite) {
        return Response.json(
          { error: `O autor já tem ${limite} livros no acervo` },
          { status: 409 },
        );
      }

      const jaExiste = db
        .query("SELECT 1 FROM livros WHERE isbn = ?")
        .get(isbn);

      if (jaExiste) {
        return Response.json(
          { error: "Livro já cadastrado" },
          { status: 409 },
        );
      }

      const mesmoTitulo = db
        .query(
          "SELECT 1 FROM livros WHERE autor_id = ? AND lower(titulo) = lower(?)",
        )
        .get(autorId, titulo);

      if (mesmoTitulo) {
        return Response.json(
          { error: "Este autor já tem um livro com este título" },
          { status: 409 },
        );
      }

      const hoje = new Date().toISOString().slice(0, 10);
      const ano = hoje.slice(0, 4);

      const catalogadosNoAno = db
        .query(
          `SELECT COUNT(*) AS total FROM livros
            WHERE data_catalogacao LIKE ?`,
        )
        .get(`${ano}%`) as { total: number };

      const numeroRegistro = `${ano}-${String(catalogadosNoAno.total + 1).padStart(6, "0")}`;

      const result = db.run(
        `INSERT INTO livros (numero_registro, isbn, titulo, autor_id, data_catalogacao)
         VALUES (?, ?, ?, ?, ?)`,
        [numeroRegistro, isbn, titulo, autorId, hoje],
      );

      const livro = db
        .query("SELECT * FROM livros WHERE id = ?")
        .get(result.lastInsertRowid as number) as Record<string, unknown>;

      return Response.json(
        { ...livro, autor: autor.nome },
        {
          status: 201,
          headers: { Location: `/livros/${isbn}` },
        },
      );
    },
  },
  {
    method: "GET",
    pattern: "/livros/:q",
    handler: (_request, params) => {
      const q = params.q!;

      const porIsbn = db
        .query("SELECT * FROM livros WHERE isbn = ?")
        .all(q);

      if (porIsbn.length > 0) return Response.json(porIsbn);

      const porTitulo = db
        .query("SELECT * FROM livros WHERE titulo LIKE ?")
        .all(`%${q}%`);

      if (porTitulo.length > 0) return Response.json(porTitulo);

      const porAutor = db
        .query(
          `SELECT livros.* FROM livros
             JOIN autores ON autores.id = livros.autor_id
            WHERE autores.nome LIKE ?`,
        )
        .all(`%${q}%`);

      return Response.json(porAutor);
    },
  },
];

const server = Bun.serve({
  port: 3000,

  async fetch(request) {
    const url = new URL(request.url);

    for (const route of routes) {
      if (route.method !== request.method) continue;

      const params = match(route.pattern, url.pathname);
      if (params) return await route.handler(request, params);
    }

    return Response.json({ error: "Recurso não encontrado" }, { status: 404 });
  },
});

console.log(`Servidor executando em http://localhost:${server.port}`);
