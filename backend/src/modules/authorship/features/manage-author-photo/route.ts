import type { Hono } from "hono";
import { authorshipIntegration } from "../../../../integration/authorshipIntegration";
import { readImageUpload } from "../../../../shared/images";
import { parseId } from "../../../../shared/validation";
import { authorJson } from "../../infrastructure/json";
import { getAuthorPhoto } from "./getAuthorPhoto";
import { removeAuthorPhoto } from "./removeAuthorPhoto";
import { uploadAuthorPhoto } from "./uploadAuthorPhoto";

/**
 * UC26: envia, mostra e remove a foto de um autor. As rotas já estão prontas;
 * o trabalho da atividade está nas três funções que elas chamam.
 */
export function registerRoutes(api: Hono): void {
  api.put("/autores/:id/foto", async (c) => {
    const id = parseId(c.req.param("id"));
    const image = await readImageUpload(c.req.raw, "foto");
    return c.json(authorJson(await uploadAuthorPhoto(id, image, authorshipIntegration)));
  });

  api.get("/autores/:id/foto", async (c) => {
    const photo = await getAuthorPhoto(parseId(c.req.param("id")));
    return new Response(photo.stream, {
      headers: {
        "Content-Type": photo.type,
        "Cache-Control": c.req.query("v") ? "public, max-age=31536000, immutable" : "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  api.delete("/autores/:id/foto", async (c) => {
    await removeAuthorPhoto(parseId(c.req.param("id")));
    return c.body(null, 204);
  });
}
