import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { testReader } from "#tests/reader-fixtures";
import { createRedis, ready, redis, redisKey } from "../../../../infrastructure/redis";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";

type ReaderJson = Awaited<ReturnType<typeof testReader>>;

async function search(q?: string) {
  const path = q === undefined ? "/leitores" : `/leitores?q=${encodeURIComponent(q)}`;
  const response = await api("GET", path);
  expect(response.status).toBe(200);
  return {
    cache: response.headers.get("X-Cache"),
    readers: await response.json() as ReaderJson[],
  };
}

test("UC10: a segunda busca vem do cache e compartilha termos equivalentes", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");

  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);

  const normalized = await search(`  ${reader.nome.toUpperCase()}  `);
  expect(normalized.cache).toBe("HIT");
  expect(normalized.readers).toEqual(first.readers);
});

test("UC10: busca sem q e com q vazio compartilham o mesmo cache", async () => {
  await invalidateReaderSearch();
  const withoutQ = await search();
  expect(withoutQ.cache).toBe("MISS");

  const emptyQ = await search("");
  expect(emptyQ.cache).toBe("HIT");
  expect(emptyQ.readers).toEqual(withoutQ.readers);
});

test("UC10: cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");

  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers.some(r => r.id === reader.id)).toBe(true);

  const renamed = testName("Leitor");
  await search(renamed);
  expect((await search(renamed)).cache).toBe("HIT");

  const updateRes = await api("PUT", `/leitores/${reader.id}`, {
    nome: renamed,
    cpf: reader.cpf,
    email: reader.email,
    telefone: reader.telefone,
  });
  expect(updateRes.status).toBe(200);

  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers.map(r => r.id)).toEqual([reader.id]);
  expect(afterUpdate.readers[0]!.nome).toBe(renamed);

  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC10: seed invalida o cache de leitores", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");

  const seedRes = await api("POST", "/seed");
  expect(seedRes.status).toBe(200);

  const afterSeed = await search("");
  expect(afterSeed.cache).toBe("MISS");
});

test("UC10: resultado velho gravado numa geração antiga não é lido", async () => {
  const term = testName("TermoLeitor");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();

  // uma escrita termina entre a leitura no Postgres e a gravação no cache
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [
    { id: 1, name: "Velho", cpf: "52998224725", email: "velho@exemplo.com", phone: "27999990000" },
  ]);
  expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("UC10: sem Redis a busca responde do Postgres", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchReadersCached(reader.nome, dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map(r => r.id)).toEqual([reader.id]);
  await invalidateReaderSearch(dead);
});

test("UC10: cada termo guardado possui TTL próprio no Redis", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");

  const cached = await readCachedSearch(reader.nome);
  expect(cached).not.toBeNull();

  const client = await ready(redis!);
  const hashKey = redisKey("leitores", "buscas", String(cached!.generation));
  const fieldKey = `q:${reader.nome.trim().toLocaleLowerCase("pt-BR")}`;
  const ttls = await client.send("HTTL", [hashKey, "FIELDS", "1", fieldKey]) as number[];
  expect(ttls[0]).toBeGreaterThan(0);
  expect(ttls[0]).toBeLessThanOrEqual(60);
});

/*
 * Respostas às questões do Passo 06 (Para discutir):
 *
 * 1. Valeu a pena?
 *    Na busca de autores, o cache evita o problema de 1 + N consultas (uma consulta
 *    principal e uma contagem de livros por autor). Na busca de leitores, o ganho é
 *    menor porque a busca original já faz apenas uma consulta SQL com ILIKE. Ele
 *    passaria a compensar em cenários com muitos leitores cadastrados (onde o ILIKE
 *    com curinga nas duas pontas `%termo%` exige Seq Scan na tabela inteira) e alta
 *    taxa de leituras repetidas por minuto (por exemplo, a listagem inicial vazia
 *    aberta constantemente no balcão da biblioteca).
 *
 * 2. Dados pessoais no Redis (LGPD).
 *    Guardar CPF, e-mail e telefone no Redis cria uma segunda cópia de dados pessoais
 *    identificáveis fora do banco principal. O TTL curto (60s) e a ausência de volume
 *    persistente reduzem a janela de exposição (os dados somem rápido e ficam só em
 *    memória), e o Redis não tem porta publicada fora da rede interna do Docker. Ainda
 *    assim, qualquer serviço na mesma rede interna ou pessoa com acesso ao Redis pode
 *    ler essas chaves sem controle de acesso por linha/coluna. Num sistema real, seria
 *    importante exigir autenticação/ACL no Redis, TLS em trânsito, ou evitar cachear
 *    dados sensíveis completos quando não houver necessidade comprovada de desempenho.
 *
 * 3. Por que geração, e não DEL?
 *    Se a escrita apenas fizesse DEL nas chaves de busca, ocorreria uma condição de
 *    corrida: uma leitura concorrente que começou antes da escrita terminar pode ler
 *    o dado antigo no Postgres, sofrer um atraso de escalonamento/rede e só gravar no
 *    Redis depois que a escrita já comitou e executou o DEL. Com isso, o dado antigo
 *    ficaria preso no cache até o TTL vencer. Com geração, a leitura lê o número da
 *    geração G antes de ir ao Postgres e grava em G; se uma escrita incrementar a
 *    geração para G+1 no meio do caminho, o dado velho é gravado em G, que ninguém
 *    mais consulta.
 *
 * 4. Invalidar tudo.
 *    Para invalidar apenas os termos afetados, seria preciso descobrir quais buscas
 *    (substrings de nome, e-mail, CPF com ou sem pontuação, tanto dos dados antigos
 *    quanto dos novos) casariam com o leitor alterado, ou manter um índice invertido
 *    mapeando cada leitor às chaves de busca em que ele apareceu (e ainda lidar com
 *    termos que antes não retornavam o leitor e agora passam a retornar). O custo em
 *    complexidade e memória seria alto e muito propenso a bugs de cache desatualizado,
 *    enquanto incrementar a geração é O(1) e simples.
 */
