import { expect, test } from "bun:test";
import { S3Client } from "bun";
import { ServiceUnavailable } from "../shared/errors";
import { createStorage, deleteObject, discardObject, getObject, objectKey, putObject, storage } from "./storage";

const key = () => objectKey("testes", crypto.randomUUID());

test("objectKey junta os trechos com barra", () => {
  expect(objectKey("acervo", "livros", 7, "capa")).toBe("acervo/livros/7/capa");
});

test("sem S3_ENDPOINT não há cliente", () => {
  expect(createStorage({})).toBeNull();
});

test("grava, lê e apaga um objeto no RustFS do compose", async () => {
  expect(storage).not.toBeNull();
  const k = key();
  await putObject(k, new TextEncoder().encode("olá, RustFS"), "text/plain");
  const stored = await getObject(k);
  // para tipos de texto, o Bun acrescenta ;charset=utf-8
  expect(stored!.type).toStartWith("text/plain");
  expect(stored!.size).toBe(12);
  expect(await new Response(stored!.stream).text()).toBe("olá, RustFS");
  await deleteObject(k);
  expect(await getObject(k)).toBeNull();
});

test("gravar de novo na mesma chave substitui o objeto", async () => {
  const k = key();
  await putObject(k, new Uint8Array([1, 2, 3]), "application/octet-stream");
  await putObject(k, new Uint8Array([9]), "image/png");
  const stored = await getObject(k);
  expect(stored!.type).toBe("image/png");
  expect(stored!.size).toBe(1);
  await deleteObject(k);
});

test("chave inexistente: getObject devolve null e deleteObject não reclama", async () => {
  const k = key();
  expect(await getObject(k)).toBeNull();
  await expect(deleteObject(k)).resolves.toBeUndefined();
});

test("sem cliente, toda operação responde ServiceUnavailable", async () => {
  await expect(putObject(key(), new Uint8Array([1]), "image/png", null)).rejects.toBeInstanceOf(ServiceUnavailable);
  await expect(getObject(key(), null)).rejects.toBeInstanceOf(ServiceUnavailable);
  await expect(deleteObject(key(), null)).rejects.toBeInstanceOf(ServiceUnavailable);
});

test("RustFS fora do ar vira ServiceUnavailable, e rápido", async () => {
  const dead = new S3Client({ endpoint: "http://127.0.0.1:1", accessKeyId: "x", secretAccessKey: "y", bucket: "z" });
  const started = performance.now();
  await expect(getObject(key(), dead)).rejects.toBeInstanceOf(ServiceUnavailable);
  expect(performance.now() - started).toBeLessThan(3000);
});

test("discardObject nunca lança: falha vira aviso no log", async () => {
  const dead = new S3Client({ endpoint: "http://127.0.0.1:1", accessKeyId: "x", secretAccessKey: "y", bucket: "z" });
  await expect(discardObject(key(), dead)).resolves.toBeUndefined();
  await expect(discardObject(key(), null)).resolves.toBeUndefined();
});
