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
 * Passo 07: respostas para discutir.
 *
 * 1. A ordem das escritas.
 *    Envio (objeto antes da coluna): se o processo morre entre as duas, sobra um
 *    objeto no bucket que nenhum autor aponta, ou, numa troca, o objeto novo com
 *    a data antiga na coluna. Na ordem inversa, o autor apontaria para uma foto
 *    que não existe, e a tela mostraria uma imagem quebrada.
 *    Remoção (coluna antes do objeto): se morre entre as duas, o autor já está
 *    sem foto e sobra um objeto órfão. Na ordem inversa, o objeto sumiria, mas a
 *    coluna continuaria dizendo que há foto: de novo, imagem quebrada.
 *    O objeto órfão é aceitável: ninguém o vê e ele pode ser limpo depois. Um
 *    autor apontando para uma foto que não existe não é: é um erro visível e um
 *    dado que mente.
 *
 * 2. Objetos órfãos.
 *    Sobram quando: o processo morre entre o putObject e o UPDATE; o autor é
 *    excluído enquanto a foto sobe e o descarte falha; a remoção zera a coluna e
 *    o RustFS falha no discardObject (o requireStorage só confere se há cliente
 *    configurado, não se o RustFS está respondendo);
 *    a exclusão do autor faz COMMIT e o discardObject falha.
 *    Limpeza: listar com list({ prefix: "autoria/autores/" }), tirar o id de cada
 *    chave e conferir no Postgres se o autor existe e tem foto_atualizada_em
 *    preenchida; quem não tiver é órfão e pode ser apagado.
 *    Cuidado: uma foto que está subindo já está no bucket, mas a coluna só muda
 *    no COMMIT, então parece órfã. A limpeza só deve apagar objetos com data de
 *    modificação mais antiga que uma margem (por exemplo, uma hora).
 *
 * 3. Tudo passa pelo backend.
 *    Com um subdomínio de mídia, a fotoUrl deixa de ser /api/autores/:id/foto e
 *    passa a ser uma URL assinada do armazenamento, gerada pelo backend, com
 *    validade curta. O Cache-Control não pode passar dessa validade: o immutable
 *    de um ano deixa de fazer sentido. O ?v= pode até sair, porque cada URL
 *    assinada já é diferente, mas a versão ainda ajuda o cache do CDN.
 *    Quem decide quem vê a foto continua sendo o backend, mas só na hora de
 *    assinar: depois disso, quem tem o link vê a foto até ele expirar.
 *
 * 4. Chave fixa ou chave nova.
 *    Chave fixa: a foto antiga é substituída e não sobra lixo; o navegador só
 *    busca a nova por causa do ?v=. Em dois envios ao mesmo tempo, o último put
 *    vence no bucket, mas os UPDATEs podem terminar na ordem contrária: o
 *    Postgres fica com a data de um envio e o bucket com os bytes do outro.
 *    Chave nova a cada envio: a foto antiga continua no bucket até alguém
 *    apagá-la; a URL já muda sozinha, então o cache nunca mostra a foto velha (e,
 *    com hash do conteúdo, o mesmo arquivo dá a mesma chave). Na corrida, cada
 *    envio grava o seu objeto, o último UPDATE vence e a coluna sempre aponta
 *    para bytes certos; o objeto do envio que perdeu fica órfão.
 *
 * 5. A foto é um dado pessoal.
 *    Depois de excluir o autor, ainda podem existir cópias: no cache do
 *    navegador de quem já viu a foto (immutable, por um ano), em proxies e CDNs
 *    no caminho (o cache é public), no disco do volume rustfsdata até o espaço
 *    ser reaproveitado (ou em versões antigas, se o bucket tiver versionamento)
 *    e nos backups do volume.
 *    Um pedido de exclusão precisaria alcançar o objeto e as versões antigas, o
 *    cache do CDN, os backups (apagando ou registrando o pedido para reaplicá-lo
 *    ao restaurar) e evitar cache longo para dados pessoais, porque o cache do
 *    navegador de outra pessoa não dá para apagar.
 */