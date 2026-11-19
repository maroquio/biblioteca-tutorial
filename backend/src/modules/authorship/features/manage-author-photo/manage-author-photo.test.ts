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
 * Passo 07: para discutir
 *
 * 1. A ordem das escritas
 * No envio, se o processo morrer depois de gravar o objeto e antes da coluna,
 * sobra só um arquivo no bucket que ninguém usa. O autor continua como estava.
 * Na ordem inversa, a coluna diria que tem foto e o objeto não existiria: a
 * miniatura quebrava na tela. Na remoção é parecido: zerando a coluna primeiro,
 * o pior caso é sobrar o arquivo órfão. Apagando o objeto primeiro, o autor ia
 * continuar apontando pra uma foto que não existe mais. Arquivo sobrando no
 * bucket é aceitável (só ocupa espaço), autor apontando pro nada não é.
 *
 * 2. Objetos órfãos
 * Sobra objeto sem dono quando: o processo cai entre o putObject e o UPDATE; o
 * autor é excluído enquanto a foto sobe e o discardObject falha; a remoção zera
 * a coluna mas o RustFS está fora na hora de apagar; e a exclusão do autor
 * quando o RustFS está fora. Pra limpar, dá pra listar o bucket com
 * list({ prefix: "autoria/autores/" }), pegar o id de cada chave e ver no
 * Postgres se o autor existe e se foto_atualizada_em não é nula. O cuidado é não
 * apagar uma foto que está subindo agora: o objeto já está no bucket mas a coluna
 * ainda não foi gravada. Então só apagaria objeto mais velho que uns minutos
 * (pela data do próprio objeto).
 *
 * 3. Tudo passa pelo backend
 * Com um subdomínio de mídia, a fotoUrl passaria a ser uma URL assinada direto
 * pro armazenamento, com prazo de validade. O Cache-Control não poderia mais ser
 * de um ano, porque a URL vence antes disso. O ?v= quase nem precisaria, porque
 * cada assinatura já gera uma URL diferente. E quem decide quem vê a foto e por
 * quanto tempo passa a ser o backend na hora de assinar, não mais a cada
 * requisição. Depois de entregue, a URL vale até vencer.
 *
 * 4. Chave fixa ou chave nova
 * Com chave fixa, a foto nova sobrescreve a antiga, então não sobra lixo, e o ?v=
 * força o navegador a buscar de novo. Se dois envios acontecerem juntos, quem
 * gravar por último no bucket ganha, e a coluna pode ficar com a data do outro
 * (os bytes e a versão podem não bater por um tempo). Com chave nova a cada
 * envio, a foto antiga vira lixo que tem que ser apagado depois, mas o cache do
 * navegador funciona sozinho (URL nova = arquivo novo) e a corrida é resolvida
 * pelo Postgres: a chave que ficar gravada na coluna é a que vale, e os bytes
 * sempre batem com ela.
 *
 * 5. A foto é um dado pessoal
 * Mesmo apagando do bucket, a foto ainda pode estar: no cache do navegador de
 * quem já viu (o immutable deixa guardar por um ano), em algum proxy ou CDN no
 * meio do caminho, no volume rustfsdata se o arquivo virou órfão, e nos backups
 * do banco e do armazenamento. Num sistema de verdade, o pedido de exclusão
 * teria que apagar os órfãos, ter um prazo pra sumir dos backups, invalidar a
 * CDN e evitar cache tão longo pra dado pessoal.
 */
