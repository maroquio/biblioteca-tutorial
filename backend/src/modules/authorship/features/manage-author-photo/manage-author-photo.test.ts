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
 * Passo 07: respostas para discussão
 *
 * 1. A ordem das escritas
 *    No envio, o objeto vai antes da coluna. Se o processo morrer entre as duas,
 *    sobra um objeto no bucket que nenhum autor usa (ou a foto nova por cima da
 *    antiga, com a coluna ainda na data antiga). Na ordem inversa, a coluna diria
 *    que há foto nova e o bucket não teria o objeto: a fotoUrl apontaria para algo
 *    que não existe, e a leitura daria 404 para um autor que "tem" foto.
 *    Na remoção, a coluna é zerada antes de o objeto sair. Se morrer no meio, o
 *    autor já está sem foto e sobra um objeto órfão. Na ordem inversa, o objeto
 *    sumiria e a coluna continuaria dizendo que há foto, o mesmo estrago de antes.
 *    O objeto órfão é aceitável porque ninguém o vê: custa só espaço e dá para
 *    limpar depois. Um autor apontando para uma foto que não existe não é: o
 *    usuário vê o erro, e o banco, que é a fonte da verdade, fica mentindo.
 *
 * 2. Objetos órfãos
 *    Ficam no bucket quando: o processo morre entre o putObject e o UPDATE; o
 *    autor é excluído enquanto a foto sobe e o discardObject falha; a remoção da
 *    foto ou a exclusão do autor confirmam no Postgres, mas o RustFS falha no
 *    discardObject (ou está fora do ar); e o UPDATE do envio dá erro depois de o
 *    objeto já estar gravado.
 *    Para limpar: listar o bucket com list({ prefix: "autoria/autores/" }), tirar
 *    o id de cada chave e conferir no Postgres. Objeto cujo autor não existe, ou
 *    cujo autor tem foto_atualizada_em nula, é órfão e pode ser apagado.
 *    O cuidado é a foto que está subindo agora: o objeto já existe e a coluna
 *    ainda não foi gravada. Por isso a limpeza só apaga objetos mais antigos que
 *    uma margem (por exemplo, lastModified de mais de uma hora), e confere a
 *    coluna de novo logo antes de apagar.
 *
 * 3. Tudo passa pelo backend
 *    A fotoUrl deixaria de ser /api/autores/:id/foto e passaria a ser um endereço
 *    do subdomínio de mídia, com a assinatura e a validade na própria URL. O
 *    Cache-Control não poderia mais ser de um ano: a URL expira em pouco tempo, e
 *    o cache do navegador precisaria acompanhar essa validade. O ?v= perde o
 *    papel, porque cada URL assinada já é diferente; a versão poderia continuar
 *    dentro da chave, ou ser parte do que é assinado.
 *    Quem decide quem vê a foto e por quanto tempo passa a ser o backend no
 *    momento em que gera a URL assinada (ele escolhe para quem gerar e a
 *    validade). Depois disso, quem confere é o armazenamento, sem passar pelo Bun.
 *
 * 4. Chave fixa ou chave nova
 *    Com a chave fixa, a foto antiga é sobrescrita na hora e não sobra lixo. O
 *    cache do navegador depende do ?v= para saber que a imagem mudou. Em dois
 *    envios simultâneos do mesmo autor, o último putObject vence no bucket, mas o
 *    último UPDATE pode ser do outro envio: a coluna e os bytes podem ficar de
 *    envios diferentes (a imagem é a de um, a versão é a do outro).
 *    Com uma chave nova a cada envio (data ou hash), a chave vai para o Postgres.
 *    A foto antiga fica no bucket e precisa ser apagada depois, senão vira órfã.
 *    O cache do navegador fica simples, porque cada foto tem uma URL própria e
 *    pode ser immutable de verdade. Na corrida, quem grava a coluna por último
 *    vence, e a coluna sempre aponta para um objeto que existe e combina com ela;
 *    o objeto do outro envio é que sobra como órfão.
 *
 * 5. A foto é um dado pessoal
 *    Excluir o autor apaga o objeto, mas continuam existindo: as cópias no cache
 *    dos navegadores que já abriram a foto (immutable por um ano, e o servidor não
 *    tem como apagar isso); caches intermediários ou CDN, se houver; os dados
 *    ainda no volume rustfsdata até o espaço ser reaproveitado; backups do bucket
 *    e do volume; e versões antigas do objeto, se o bucket tiver versionamento.
 *    Num sistema de verdade, o pedido de exclusão precisaria chegar a tudo isso:
 *    apagar do armazenamento e das versões, purgar o CDN, ter uma política para os
 *    backups (apagar ou deixar expirar num prazo conhecido), e não usar cache tão
 *    longo para dado pessoal (URLs assinadas curtas ajudam). Também seria preciso
 *    registrar que o pedido foi atendido.
 */
