import { RedisClient } from "bun";

/**
 * Cliente Redis do próprio Bun. Sem fila offline: com o Redis fora do ar, cada
 * comando falha na hora, e quem chamou decide seguir sem o dado derivado, em vez
 * de a requisição ficar esperando a reconexão.
 */
export function createRedis(url: string, options: { autoReconnect?: boolean } = {}): RedisClient {
  return new RedisClient(url, { enableOfflineQueue: false, connectionTimeout: 2000, ...options });
}

/**
 * O Redis só guarda dados derivados do Postgres (cache e índice de busca). Sem
 * REDIS_URL a aplicação funciona do mesmo jeito, só que sem eles.
 */
export const redis: RedisClient | null = process.env.REDIS_URL ? createRedis(process.env.REDIS_URL) : null;

/**
 * A conexão é aberta no primeiro uso. Sem fila offline, um comando enviado antes
 * dela ficar pronta seria recusado; por isso quem usa o Redis passa por aqui.
 * Com o servidor fora do ar, connect() rejeita: recusa imediata ou, no máximo, o
 * connectionTimeout.
 */
export async function ready(client: RedisClient): Promise<RedisClient> {
  if (!client.connected) await client.connect();
  return client;
}

const PREFIX = process.env.REDIS_PREFIX ?? "biblioteca";

/**
 * Toda chave passa por aqui. O prefixo separa os ambientes que dividem o mesmo
 * Redis (a aplicação usa "biblioteca", os testes "biblioteca_test"), e o primeiro
 * trecho diz o módulo dono da chave, como acontece com as tabelas.
 */
export function redisKey(...parts: string[]): string {
  return [PREFIX, ...parts].join(":");
}