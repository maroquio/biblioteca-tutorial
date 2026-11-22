import { api, testName } from "#tests/api";
import { testReader } from "#tests/reader-fixtures";
import { createRedis, redis, redisKey } from "../../../../infrastructure/redis";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";

async function search(q: string) {
    const response = await api("GET", `/leitores?q=${encodeURIComponent(q)}`);
    expect(response.status).toBe(200);
    return { cache: response.headers.get("X-Cache"), readers: await response.json() as { id: number; nome: string }[] };
}


test("UC06: a segunda busca vem do cache", async () => {
    const reader = await testReader();
    const first = await search(reader.nome);
    expect(first.cache).toBe("MISS");
    const second = await search(reader.nome);
    expect(second.cache).toBe("HIT");
    expect(second.readers).toEqual(first.readers);
});

test("UC06: termos que diferem em espaços e caixa compartilham o resultado", async () => {
    const reader = await testReader();
    const term = reader.nome;
    await search(term);
    expect((await search(`  ${term.toUpperCase()} `)).cache).toBe("HIT");
});

test("UC06: sem q e com q vazio compartilham o resultado", async () => {
    await invalidateReaderSearch();
    const semQ = await api("GET", "/leitores");
    expect(semQ.headers.get("X-Cache")).toBe("MISS");
    const vazio = await api("GET", "/leitores?q=");
    expect(vazio.headers.get("X-Cache")).toBe("HIT");
    expect(await vazio.json()).toEqual(await semQ.json());
});

test("UC06: POST /api/seed invalida o cache", async () => {
    await search("");
    expect((await search("")).cache).toBe("HIT");
    expect((await api("POST", "/seed")).status).toBe(200); // confira o status e o prefixo da rota
    expect((await search("")).cache).toBe("MISS");
});

test("UC06: sem Redis responde BYPASS e a invalidação não lança", async () => {
    const reader = await testReader();
    const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
    const result = await searchReadersCached(reader.nome, dead);
    expect(result.cache).toBe("BYPASS");
    expect(result.readers.map((r) => r.id)).toContain(reader.id);
    await expect(invalidateReaderSearch(dead)).resolves.toBeUndefined();
});

test("UC06: cada termo guardado expira sozinho (TTL)", async () => {
    await invalidateReaderSearch();
    const term = testName("Ttl");
    const read = await readCachedSearch(term);
    expect(read).not.toBeNull();                       // falha aqui = sem Redis (BYPASS)
    expect(read!.readers).toBeNull();

    await writeCachedSearch(term, read!.generation, [] as ReaderView[]);

    // o hash da geração tem de existir e conter o termo
    const key = redisKey("leitores", "buscas", String(read!.generation));
    const fields = (await redis!.send("HKEYS", [key])) as string[];
    expect(fields).toEqual([`q:${term.trim().toLocaleLowerCase("pt-BR")}`]);

    // cada campo tem TTL positivo, no máximo os 60 s do cache
    for (const f of fields) {
        const [ttl] = (await redis!.send("HTTL", [key, "FIELDS", "1", f])) as number[];
        expect(ttl).toBeGreaterThan(0);                  // -1 = sem TTL, -2 = campo inexistente
        expect(ttl).toBeLessThanOrEqual(60);
    }
});

test("UC06: cadastrar, editar e excluir autor invalidam o cache", async () => {
    await search("");
    expect((await search("")).cache).toBe("HIT");
    const reader = await testReader();
    const afterCreate = await search("");
    expect(afterCreate.cache).toBe("MISS");
    expect(afterCreate.readers.some((a) => a.id === reader.id)).toBe(true);

    const renamed = testName("Leitor");
    await search(renamed);
    expect((await api("PUT", `/leitores/${reader.id}`, { nome: renamed, cpf: "676.884.860-76", email: "dani@gmail.com", telefone: "29-333333333" })).status).toBe(200);
    const afterUpdate = await search(renamed);
    expect(afterUpdate.cache).toBe("MISS");
    expect(afterUpdate.readers.map((a) => a.id)).toEqual([reader.id]);

    expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
    const afterDelete = await search(renamed);
    expect(afterDelete.cache).toBe("MISS");
    expect(afterDelete.readers).toEqual([]);
});

test("UC06: resultado velho gravado numa geração antiga não é lido", async () => {
    const term = testName("Termo");
    const read = await readCachedSearch(term);
    expect(read!.readers).toBeNull();
    // uma escrita termina entre a leitura no Postgres e a gravação no cache
    await invalidateReaderSearch();
    await writeCachedSearch(term, read!.generation, [{ id: 1, name: "Velho", email: "dani@gmail.com", phone: "23-333543235", cpf: "230124934-23" }]);
    expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("UC06: sem Redis a busca responde do Postgres", async () => {
    const reader = await testReader();
    const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
    const result = await searchReadersCached(reader.nome, dead);
    expect(result.cache).toBe("BYPASS");
    expect(result.readers.map((a) => a.id)).toEqual([reader.id]);
    await invalidateReaderSearch(dead);
});
