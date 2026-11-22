import type { Hono } from "hono";
import { catalogIntegration } from "../../../../integration/catalogIntegration";
import { readImageUpload } from "../../../../shared/images";
import { parseId } from "../../../../shared/validation";
import { bookJson } from "../../infrastructure/json";
import { getBookCover } from "./getBookCover";
import { removeBookCover } from "./removeBookCover";
import { uploadBookCover } from "./uploadBookCover";

/** UC25: envia, mostra e remove a capa de um livro. A imagem passa pelo backend. */
export function registerRoutes(api: Hono): void {
  api.put("/livros/:id/capa", async (c) => {
    const id = parseId(c.req.param("id"));
    const image = await readImageUpload(c.req.raw, "capa");
    return c.json(bookJson(await uploadBookCover(id, image, catalogIntegration)));
  });

  api.get("/livros/:id/capa", async (c) => {
    const cover = await getBookCover(parseId(c.req.param("id")));
    // o fluxo vindo do RustFS sai em pedaços (Transfer-Encoding: chunked)
    return new Response(cover.stream, {
      headers: {
        "Content-Type": cover.type,
        // com ?v=..., a URL muda a cada troca de capa: o navegador pode guardar para sempre
        "Cache-Control": c.req.query("v") ? "public, max-age=31536000, immutable" : "no-cache",
        // o navegador usa o Content-Type informado, sem tentar adivinhar outro
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  api.delete("/livros/:id/capa", async (c) => {
    await removeBookCover(parseId(c.req.param("id")));
    return c.body(null, 204);
  });
}
