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
 * Para discutir (passo 07 da atividade)
 *
 * 1. A ordem das escritas.
 * No envio, se o processo morre depois do putObject e antes do UPDATE, sobra um
 * objeto no bucket que nenhum autor referencia: a foto nova fica invisível, e o
 * autor continua com a foto anterior (ou sem foto). Na ordem inversa, a coluna
 * diria que há uma foto nova que nunca chegou ao bucket, e o GET responderia 404
 * para uma fotoUrl que a API acabou de anunciar, com o ?v= novo preso no cache do
 * navegador e no cache da busca.
 * Na remoção, se o processo morre depois de zerar a coluna e antes do
 * discardObject, sobra de novo um objeto órfão, e o autor aparece sem foto, que é
 * o que o usuário pediu. Na ordem inversa, o objeto sairia primeiro e a coluna
 * continuaria apontando para ele: autor com fotoUrl quebrada até alguém remover
 * de novo.
 * O estrago aceitável é o objeto órfão: ele só ocupa espaço, ninguém o vê e dá
 * para limpar depois. O inaceitável é o Postgres, que é a fonte da verdade,
 * afirmar algo que o bucket não confirma, porque esse erro chega ao usuário.
 *
 * 2. Objetos órfãos.
 * Ficam órfãos: o envio que morre entre o putObject e o UPDATE; o envio em que o
 * autor é excluído no meio e o discardObject falha; a remoção da foto com o
 * RustFS fora do ar (o requireStorage só confere se há cliente configurado, não
 * se o servidor responde, então a coluna é zerada, o discardObject só registra o
 * aviso e a rota responde 204); a exclusão do autor nas mesmas condições; e uma
 * restauração do Postgres a partir de um backup mais antigo que o bucket.
 * Para limpar, um job periódico lista o bucket com list({ prefix: "autoria/autores/" })
 * do S3Client, extrai o id de cada chave e confere no Postgres se existe autor com
 * esse id e foto_atualizada_em não nula. O que não tiver dono vira candidato.
 * O cuidado é não apagar uma foto que está subindo: entre o putObject e o COMMIT
 * do UPDATE o objeto existe e a coluna ainda é nula. Por isso a limpeza só apaga
 * objetos cujo lastModified seja mais antigo que uma margem folgada (uma hora,
 * por exemplo), e confere a coluna de novo imediatamente antes de apagar.
 *
 * 3. Tudo passa pelo backend.
 * Com um subdomínio de mídia, a fotoUrl deixaria de ser /api/autores/:id/foto e
 * passaria a ser uma URL assinada (presign do S3Client) em algo como
 * midia.biblioteca.exemplo, com validade curta embutida na própria assinatura.
 * O Cache-Control não poderia mais ser immutable por um ano: a URL expira antes
 * disso, então o cache do navegador fica limitado à validade da assinatura. O ?v=
 * perde a função, porque cada assinatura nova já gera uma URL diferente; a versão
 * continua útil só para saber se vale a pena gerar outra.
 * Quem decide quem vê a foto, e por quanto tempo, passa a ser o backend no
 * momento em que assina a URL. Depois de entregue, a URL vale para quem a tiver
 * até expirar, e o armazenamento só confere a assinatura. Em troca, o Bun para de
 * repassar bytes e cada miniatura deixa de custar uma requisição à aplicação.
 *
 * 4. Chave fixa ou chave nova.
 * Com chave fixa, a foto antiga é sobrescrita no mesmo instante, sem lixo no
 * bucket. O cache do navegador depende do ?v=: sem ele, o immutable mostraria a
 * foto velha por um ano. Em dois envios simultâneos do mesmo autor, o último
 * putObject vence no bucket e o último UPDATE vence no Postgres, e não há
 * garantia de que os dois sejam do mesmo envio: a coluna pode guardar a data de
 * um e o bucket os bytes do outro.
 * Com chave nova a cada envio (data ou hash do conteúdo) guardada no Postgres, a
 * URL já muda sozinha, o cache imutável é natural e a corrida se resolve pelo
 * UPDATE: a coluna aponta para um objeto inteiro e coerente, e quem perde vira
 * órfão. O preço é que toda troca deixa a foto antiga no bucket, e alguém precisa
 * apagá-la depois do COMMIT ou num job de limpeza. Com hash do conteúdo, reenviar
 * a mesma imagem ainda reaproveita o objeto.
 *
 * 5. A foto é um dado pessoal.
 * Depois de excluir o autor, a foto continua existindo no cache dos navegadores
 * que a abriram (immutable por um ano, e quem a salvou guarda para sempre), em
 * eventuais caches intermediários e CDNs, nas versões anteriores do objeto se o
 * versionamento do bucket estiver ligado, nos blocos do volume rustfsdata até
 * serem sobrescritos, nos backups do volume e do Postgres, e num objeto órfão se
 * o discardObject tiver falhado.
 * Um pedido de exclusão pela LGPD precisaria de um inventário de onde o dado
 * mora, apagar o objeto e todas as suas versões, confirmar a remoção (e repetir
 * se o RustFS estiver fora do ar, em vez de só registrar o aviso), purgar a CDN,
 * definir retenção e expurgo dos backups, e registrar o atendimento do pedido. O
 * cache do navegador do usuário final fica fora do alcance do sistema, o que é um
 * argumento a favor de validades curtas para fotos de pessoas.
 */
