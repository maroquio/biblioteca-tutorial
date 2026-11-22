import { S3Client } from "bun";
import { ServiceUnavailable } from "../shared/errors";

/**
 * Cliente S3 do próprio Bun, apontando para o RustFS do compose. Sem S3_ENDPOINT
 * o cliente é null: as rotas de imagem respondem 503 e o resto da aplicação
 * funciona do mesmo jeito.
 */
export function createStorage(env: Record<string, string | undefined>): S3Client | null {
  if (!env.S3_ENDPOINT) return null;
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucket: env.S3_BUCKET,
  });
}

export const storage: S3Client | null = createStorage(process.env);

/**
 * Toda chave de objeto passa por aqui. O bucket já separa a aplicação dos testes;
 * o primeiro trecho diz o módulo dono do objeto, como em redisKey(...).
 */
export function objectKey(...parts: (string | number)[]): string {
  return parts.join("/");
}

export type StoredObject = { stream: ReadableStream<Uint8Array>; type: string; size: number };

const UNAVAILABLE = "O armazenamento de arquivos está indisponível no momento";

/** Sem cliente configurado, 503. Útil para recusar antes de mexer no banco. */
export function requireStorage(client: S3Client | null = storage): S3Client {
  if (!client) throw new ServiceUnavailable(UNAVAILABLE);
  return client;
}

/** Qualquer falha do RustFS (fora do ar, bucket inexistente, credencial errada) vira 503. */
function unavailable(error: unknown): ServiceUnavailable {
  const { code, message } = error as { code?: string; message?: string };
  console.warn("Armazenamento indisponível:", code ?? message);
  return new ServiceUnavailable(UNAVAILABLE);
}

/** Grava o objeto inteiro. Se a chave já existe, o objeto anterior é substituído. */
export async function putObject(key: string, bytes: Uint8Array, type: string, client = storage): Promise<void> {
  const s3 = requireStorage(client);
  try {
    await s3.write(key, bytes, { type });
  } catch (error) {
    throw unavailable(error);
  }
}

/**
 * Lê os metadados (stat) e abre o fluxo de bytes; null se a chave não existe.
 * Não devolva new Response(s3.file(key)): o Bun responderia 302 para uma URL
 * assinada em rustfs:9000, um endereço que o navegador não alcança.
 */
export async function getObject(key: string, client = storage): Promise<StoredObject | null> {
  const file = requireStorage(client).file(key);
  try {
    const { type, size } = await file.stat();
    return { stream: file.stream(), type, size };
  } catch (error) {
    if ((error as { code?: string }).code === "NoSuchKey") return null;
    throw unavailable(error);
  }
}

/** Apaga o objeto. Apagar uma chave que não existe também dá certo. */
export async function deleteObject(key: string, client = storage): Promise<void> {
  const s3 = requireStorage(client);
  try {
    await s3.delete(key);
  } catch (error) {
    throw unavailable(error);
  }
}

/**
 * Limpeza depois do COMMIT: o registro já saiu do Postgres, então uma falha aqui
 * não desfaz nada. Vira um aviso no log, e o objeto fica órfão no bucket.
 */
export async function discardObject(key: string, client = storage): Promise<void> {
  if (!client) return;
  await deleteObject(key, client).catch(() => console.warn(`Objeto órfão no armazenamento: ${key}`));
}
