import { expect, test } from "bun:test";
import { api, apiForm, testBook } from "#tests/api";
import { FAKE_JPEG, imageForm, JPEG, PNG } from "#tests/images";
import { catalogIntegration } from "../../../../integration/catalogIntegration";
import { getObject } from "../../../../infrastructure/storage";
import { MAX_IMAGE_BYTES } from "../../../../shared/images";
import { ServiceUnavailable } from "../../../../shared/errors";
import { coverKey } from "../../infrastructure/covers";
import { removeBookCover } from "./removeBookCover";
import { uploadBookCover } from "./uploadBookCover";

const sendCover = (id: number, bytes: Uint8Array, name = "capa.png", type = "image/png") =>
  apiForm("PUT", `/livros/${id}/capa`, imageForm("capa", bytes, name, type));

test("UC25: envia a capa, devolve capaUrl e serve os mesmos bytes", async () => {
  const book = await testBook();
  const response = await sendCover(book.id, PNG);
  expect(response.status).toBe(200);
  const { capaUrl } = await response.json();
  expect(capaUrl).toMatch(new RegExp(`^/api/livros/${book.id}/capa\\?v=\\d+$`));

  const cover = await api("GET", capaUrl.replace(/^\/api/, ""));
  expect(cover.status).toBe(200);
  expect(cover.headers.get("Content-Type")).toBe("image/png");
  expect(cover.headers.get("Cache-Control")).toContain("immutable");
  expect(cover.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(new Uint8Array(await cover.arrayBuffer())).toEqual(PNG);

  // sem ?v=, a mesma imagem, mas o navegador precisa confirmar antes de reaproveitar
  expect((await api("GET", `/livros/${book.id}/capa`)).headers.get("Cache-Control")).toBe("no-cache");
  expect((await (await api("GET", `/livros/id/${book.id}`)).json()).capaUrl).toBe(capaUrl);
});

test("UC25: trocar a capa substitui o objeto e muda a capaUrl", async () => {
  const book = await testBook();
  const first = (await (await sendCover(book.id, PNG)).json()).capaUrl;
  await Bun.sleep(5);
  const second = (await (await sendCover(book.id, JPEG, "capa.jpg", "image/jpeg")).json()).capaUrl;
  expect(second).not.toBe(first);
  const cover = await api("GET", `/livros/${book.id}/capa`);
  expect(cover.headers.get("Content-Type")).toBe("image/jpeg");
  expect(new Uint8Array(await cover.arrayBuffer())).toEqual(JPEG);
});

test("UC25: recusa o que não é imagem (400), o que passa de 2 MB (413) e livro inexistente (404)", async () => {
  const book = await testBook();
  expect((await sendCover(book.id, FAKE_JPEG, "capa.jpg", "image/jpeg")).status).toBe(400);
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(PNG);
  expect((await sendCover(book.id, big)).status).toBe(413);
  expect((await api("PUT", `/livros/${book.id}/capa`, { capa: "não é multipart" })).status).toBe(400);
  expect((await sendCover(2147483647, PNG)).status).toBe(404);
  // nada disso deixou capa para trás
  expect((await (await api("GET", `/livros/id/${book.id}`)).json()).capaUrl).toBeNull();
  expect((await api("GET", `/livros/${book.id}/capa`)).status).toBe(404);
  expect(await getObject(coverKey(book.id))).toBeNull();
});

test("UC25: remover a capa zera capaUrl e apaga o objeto do bucket", async () => {
  const book = await testBook();
  await sendCover(book.id, PNG);
  expect(await getObject(coverKey(book.id))).not.toBeNull();
  expect((await api("DELETE", `/livros/${book.id}/capa`)).status).toBe(204);
  expect((await (await api("GET", `/livros/id/${book.id}`)).json()).capaUrl).toBeNull();
  expect((await api("GET", `/livros/${book.id}/capa`)).status).toBe(404);
  expect(await getObject(coverKey(book.id))).toBeNull();
  expect((await api("DELETE", "/livros/2147483647/capa")).status).toBe(404);
});

test("UC25: sem RustFS, 503 e o livro continua como estava", async () => {
  const book = await testBook();
  const image = { bytes: PNG, type: "image/png" as const };
  await expect(uploadBookCover(book.id, image, catalogIntegration, { client: null })).rejects.toBeInstanceOf(ServiceUnavailable);
  expect((await (await api("GET", `/livros/id/${book.id}`)).json()).capaUrl).toBeNull();

  await sendCover(book.id, PNG);
  await expect(removeBookCover(book.id, null)).rejects.toBeInstanceOf(ServiceUnavailable);
  expect((await (await api("GET", `/livros/id/${book.id}`)).json()).capaUrl).not.toBeNull();
});
