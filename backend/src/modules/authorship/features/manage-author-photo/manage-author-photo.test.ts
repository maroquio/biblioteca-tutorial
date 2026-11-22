import { expect, test } from "bun:test";
import { api, apiForm, testAuthor } from "#tests/api";
import { FAKE_JPEG, imageForm, JPEG, PNG } from "#tests/images";
import { getObject } from "../../../../infrastructure/storage";
import { authorshipIntegration } from "../../../../integration/authorshipIntegration";
import { ServiceUnavailable } from "../../../../shared/errors";
import { MAX_IMAGE_BYTES } from "../../../../shared/images";
import { photoKey } from "../../infrastructure/photos";
import { removeAuthorPhoto } from "./removeAuthorPhoto";
import { uploadAuthorPhoto } from "./uploadAuthorPhoto";

/*
 * Testes de aceite da atividade. Cada um começa como test.todo: o bun test lista,
 * mas não executa. Quando implementar a parte que um teste cobre, troque
 * test.todo por test e rode a suíte. Não altere o que os testes esperam.
 */

const sendPhoto = (id: number, bytes: Uint8Array, name = "foto.png", type = "image/png") =>
  apiForm("PUT", `/autores/${id}/foto`, imageForm("foto", bytes, name, type));

const authorById = async (id: number) => (await api("GET", `/autores/${id}`)).json();

test("UC26: a chave da foto pertence ao módulo Autoria", () => {
  expect(photoKey(7)).toBe("autoria/autores/7/foto");
});

test("UC26: envia a foto, devolve fotoUrl e serve os mesmos bytes", async () => {
  const author = await testAuthor();
  const response = await sendPhoto(author.id, PNG);
  expect(response.status).toBe(200);
  const { fotoUrl } = await response.json();
  expect(fotoUrl).toMatch(new RegExp(`^/api/autores/${author.id}/foto\\?v=\\d+$`));

  const photo = await api("GET", fotoUrl.replace(/^\/api/, ""));
  expect(photo.status).toBe(200);
  expect(photo.headers.get("Content-Type")).toBe("image/png");
  expect(new Uint8Array(await photo.arrayBuffer())).toEqual(PNG);
  expect((await authorById(author.id)).fotoUrl).toBe(fotoUrl);
  expect(await getObject(photoKey(author.id))).not.toBeNull();
});

test("UC26: trocar a foto substitui o objeto e muda a fotoUrl", async () => {
  const author = await testAuthor();
  const first = (await (await sendPhoto(author.id, PNG)).json()).fotoUrl;
  await Bun.sleep(5);
  const second = (await (await sendPhoto(author.id, JPEG, "foto.jpg", "image/jpeg")).json()).fotoUrl;
  expect(second).not.toBe(first);
  const photo = await api("GET", `/autores/${author.id}/foto`);
  expect(photo.headers.get("Content-Type")).toBe("image/jpeg");
  expect(new Uint8Array(await photo.arrayBuffer())).toEqual(JPEG);
});

test("UC26: recusa o que não é imagem (400), o que passa de 2 MB (413) e autor inexistente (404)", async () => {
  const author = await testAuthor();
  expect((await sendPhoto(author.id, FAKE_JPEG, "foto.jpg", "image/jpeg")).status).toBe(400);
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(PNG);
  expect((await sendPhoto(author.id, big)).status).toBe(413);
  expect((await sendPhoto(2147483647, PNG)).status).toBe(404);
  // nada disso deixou foto para trás
  expect((await authorById(author.id)).fotoUrl).toBeNull();
  expect((await api("GET", `/autores/${author.id}/foto`)).status).toBe(404);
  expect((await api("GET", "/autores/2147483647/foto")).status).toBe(404);
  expect(await getObject(photoKey(author.id))).toBeNull();
});

test("UC26: remover a foto zera fotoUrl e apaga o objeto do bucket", async () => {
  const author = await testAuthor();
  await sendPhoto(author.id, PNG);
  expect((await api("DELETE", `/autores/${author.id}/foto`)).status).toBe(204);
  expect((await authorById(author.id)).fotoUrl).toBeNull();
  expect((await api("GET", `/autores/${author.id}/foto`)).status).toBe(404);
  expect(await getObject(photoKey(author.id))).toBeNull();
  expect((await api("DELETE", "/autores/2147483647/foto")).status).toBe(404);
});

test("UC26: sem RustFS, 503 e o autor continua como estava", async () => {
  const author = await testAuthor();
  const image = { bytes: PNG, type: "image/png" as const };
  await expect(uploadAuthorPhoto(author.id, image, authorshipIntegration, { client: null })).rejects.toBeInstanceOf(ServiceUnavailable);
  expect((await authorById(author.id)).fotoUrl).toBeNull();

  await sendPhoto(author.id, PNG);
  await expect(removeAuthorPhoto(author.id, null)).rejects.toBeInstanceOf(ServiceUnavailable);
  expect((await authorById(author.id)).fotoUrl).not.toBeNull();
});

test("UC26: enviar e remover a foto invalidam o cache da busca de autores", async () => {
  const author = await testAuthor();
  const search = async () => {
    const response = await api("GET", `/autores?q=${encodeURIComponent(author.nome)}`);
    return { cache: response.headers.get("X-Cache"), authors: await response.json() as { fotoUrl: string | null }[] };
  };
  await search();
  expect((await search()).cache).toBe("HIT");

  await sendPhoto(author.id, PNG);
  const afterUpload = await search();
  expect(afterUpload.cache).toBe("MISS");
  expect(afterUpload.authors[0]!.fotoUrl).not.toBeNull();

  expect((await search()).cache).toBe("HIT");
  expect((await api("DELETE", `/autores/${author.id}/foto`)).status).toBe(204);
  const afterRemove = await search();
  expect(afterRemove.cache).toBe("MISS");
  expect(afterRemove.authors[0]!.fotoUrl).toBeNull();
});

test("UC08: excluir o autor apaga a foto do bucket", async () => {
  const author = await testAuthor();
  await sendPhoto(author.id, PNG);
  expect(await getObject(photoKey(author.id))).not.toBeNull();
  expect((await api("DELETE", `/autores/${author.id}`)).status).toBe(204);
  expect(await getObject(photoKey(author.id))).toBeNull();
});

/*
 * Passo 07: para discutir.
 *
 * 1. A ordem das escritas.
 *    Envio: morrer entre objeto e coluna deixa um objeto órfão no bucket (ou,
 *    se o autor já tinha foto, bytes novos sob o ?v= antigo). Na ordem inversa,
 *    a coluna apontaria para uma foto inexistente ou antiga, e a antiga seria
 *    guardada como "immutable" sob o ?v= novo.
 *    Remoção: morrer entre coluna e objeto deixa um órfão. Na ordem inversa, a
 *    coluna aponta para um objeto apagado: miniatura quebrada.
 *    O órfão é aceitável porque ninguém o vê e dá para limpar depois. O Postgres
 *    apontar para bytes errados ou inexistentes não é: o erro chega ao usuário.
 *
 * 2. Objetos órfãos.
 *    Surgem quando: o processo morre entre o putObject e o COMMIT; o autor é
 *    excluído durante o envio e o discardObject falha; a remoção da foto ou a
 *    exclusão do autor acontece com o RustFS fora (204, coluna zerada, objeto
 *    fica); o processo morre entre o COMMIT e o discardObject.
 *    Limpeza: percorrer s3.list({ prefix: "autoria/autores/" }) paginado e
 *    apagar as chaves cujo autor não existe ou tem foto_atualizada_em nula.
 *    Cuidado: no envio o objeto chega antes da coluna, então só apagar objetos
 *    com lastModified mais velho que uma margem (ex.: 1 h) e reconferir a
 *    coluna logo antes do delete.
 *
 * 3. Tudo passa pelo backend.
 *    A fotoUrl vira uma URL assinada (presign) do subdomínio de mídia, que
 *    expira; por isso não pode ficar em cache mais tempo do que vale. O
 *    Cache-Control passa a ser do objeto ou da CDN, e o immutable de um ano
 *    deixa de fazer sentido. O ?v= ainda serve para a CDN não entregar a foto
 *    antiga. O backend só decide quem vê na hora de assinar; depois, qualquer
 *    um com o link vê até expirar, e quem confere é o armazenamento/CDN.
 *
 * 4. Chave fixa ou chave nova.
 *    Fixa: a foto antiga é sobrescrita (sem lixo), o cache depende do ?v=, e
 *    dois envios simultâneos podem deixar os bytes de um com a versão do outro.
 *    Nova a cada envio: a antiga precisa ser apagada depois (mais órfãos), a
 *    URL muda com o conteúdo (immutable seguro, sem ?v=), e na corrida vence
 *    quem confirma por último, com coluna e bytes sempre correspondendo.
 *
 * 5. A foto é um dado pessoal.
 *    Cópias que sobram: caches de navegadores e CDNs (public, immutable, um
 *    ano), objetos órfãos de discardObject que falhou, o disco e versões
 *    antigas no volume rustfsdata, e os backups.
 *    Um pedido de exclusão precisaria: apagar com nova tentativa garantida (não
 *    só um aviso no log), apagar versões, purgar a CDN, usar max-age curto,
 *    ter retenção definida nos backups (ou cifrar cada foto e destruir a
 *    chave) e registrar o atendimento.
 */
