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
 *    Envio (objeto, depois coluna). Se o processo morre entre as duas, sobra um
 *    objeto no bucket que a coluna não anuncia: no primeiro envio, o autor
 *    continua sem foto; numa troca, a chave fixa já recebeu os bytes novos, mas
 *    a coluna ainda tem a versão antiga. Na ordem inversa (coluna, depois
 *    objeto), o autor apontaria para uma foto que não existe: fotoUrl na tela,
 *    imagem quebrada, e o cache da busca espalhando isso.
 *    Remoção (coluna, depois objeto). Se morre no meio, sobra um objeto órfão
 *    que ninguém aponta. Na ordem inversa, a coluna diria que há foto e o bucket
 *    não teria: de novo, uma fotoUrl que responde 404.
 *    O estrago aceitável é o objeto órfão: custa espaço, é invisível para quem
 *    usa o sistema e dá para limpar depois. O inaceitável é o Postgres, que é a
 *    fonte da verdade, apontar para bytes que não existem.
 *
 * 2. Objetos órfãos.
 *    Sobram quando: o processo morre (ou o Postgres falha) entre o putObject e o
 *    COMMIT do UPDATE; o autor é excluído enquanto a foto sobe e o descarte
 *    falha; a foto é removida com o RustFS fora do ar (requireStorage só confere
 *    se o cliente está configurado: no passo 06, a remoção respondeu 204, a
 *    coluna ficou nula e o log avisou "Objeto órfão no armazenamento"); o autor
 *    é excluído com o RustFS fora do ar; o processo morre depois do COMMIT e
 *    antes do discardObject.
 *    Para limpar: percorrer o bucket com list({ prefix: "autoria/autores/" }),
 *    página por página, tirar o id de cada chave e perguntar ao Postgres, em
 *    lote, quais desses autores existem com foto_atualizada_em não nula. Quem
 *    não estiver na resposta é candidato a apagar.
 *    O cuidado: no envio, o objeto existe alguns instantes antes da coluna. Só
 *    apagar objetos cujo lastModified seja mais antigo que uma margem folgada
 *    (uma hora, por exemplo), e conferir a coluna de novo logo antes de apagar.
 *    Como a chave é fixa, um envio novo atualiza o lastModified, e a margem
 *    também protege a foto que acabou de substituir a anterior.
 *
 * 3. Tudo passa pelo backend.
 *    Com um subdomínio de mídia e URLs assinadas (s3.file(key).presign(...)), a
 *    fotoUrl deixa de ser /api/autores/:id/foto?v=... e vira uma URL absoluta do
 *    armazenamento, com assinatura e expiração na query. Ela não pode ir para o
 *    cache da busca com validade menor que a do cache, então seria gerada na
 *    saída, depois de ler o cache. O Cache-Control deixa de ser "immutable por
 *    um ano": o navegador não pode guardar por mais tempo do que a assinatura
 *    vale, e quem define o cabeçalho passa a ser o armazenamento ou a CDN. O
 *    ?v= perde a função, porque cada assinatura já muda a URL (o que também
 *    piora o aproveitamento do cache, a não ser que se assine por janelas fixas
 *    de tempo). Quem decide quem vê a foto é o backend, no momento de assinar;
 *    depois de entregue, a URL vale para qualquer um que a tenha até expirar,
 *    sem como revogar uma só. A validade da assinatura decide por quanto tempo.
 *
 * 4. Chave fixa ou chave nova.
 *    Chave fixa: a foto antiga é sobrescrita na hora, sem lixo para apagar na
 *    troca. Mas a URL com ?v= antigo pode servir os bytes novos na janela entre
 *    o putObject e o UPDATE, e um navegador pode guardá-los como "immutable"
 *    sob a versão errada. Em dois envios simultâneos, os putObject correm na
 *    mesma chave e os UPDATEs são serializados pelo lock da transação; a ordem
 *    em que cada um chega ao bucket pode ser diferente da ordem no Postgres, e a
 *    versão gravada pode não corresponder aos bytes que ficaram.
 *    Chave nova a cada envio (data ou hash do conteúdo, guardada no Postgres):
 *    cada objeto é imutável de verdade, a URL já identifica a versão, o cache
 *    de um ano fica correto por construção e quem vence a corrida é o UPDATE,
 *    sempre apontando para bytes coerentes. O custo: a foto anterior e a do
 *    perdedor da corrida viram órfãs e precisam ser descartadas depois do
 *    COMMIT (ou pela varredura). Com hash do conteúdo, reenviar a mesma imagem
 *    não cria objeto novo.
 *
 * 5. A foto é um dado pessoal.
 *    Depois de excluir o autor, continuam existindo: as cópias no cache dos
 *    navegadores de quem viu a foto (public, immutable, um ano; o servidor não
 *    alcança), e em qualquer proxy ou CDN no caminho, porque "public" permite
 *    cache compartilhado; dados no volume rustfsdata até o disco ser reescrito
 *    (e versões antigas, se o bucket tiver versionamento); os backups e
 *    snapshots do volume; e o objeto órfão, se o RustFS estava fora do ar na
 *    exclusão. Um pedido de exclusão de verdade precisaria: apagar o objeto com
 *    confirmação e nova tentativa até dar certo (não "melhor esforço", como o
 *    discardObject); varrer os órfãos daquele autor; expirar os backups numa
 *    política de retenção conhecida, ou cifrar cada foto com uma chave própria e
 *    destruir a chave; invalidar a CDN; servir a foto com um cabeçalho menos
 *    agressivo (private, validade curta); e registrar que o pedido foi atendido.
 */
