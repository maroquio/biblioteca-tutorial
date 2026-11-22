import { expect, test } from "bun:test";
import { FAKE_JPEG, imageForm, JPEG, PNG, WEBP } from "#tests/images";
import { InvalidInput, PayloadTooLarge } from "./errors";
import { detectImageType, MAX_IMAGE_BYTES, readImageUpload } from "./images";

function upload(body: FormData | string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/upload", { method: "PUT", body, headers });
}

test("detectImageType reconhece JPEG, PNG e WebP pela assinatura", () => {
  expect(detectImageType(JPEG)).toBe("image/jpeg");
  expect(detectImageType(PNG)).toBe("image/png");
  expect(detectImageType(WEBP)).toBe("image/webp");
  expect(detectImageType(FAKE_JPEG)).toBeNull();
  expect(detectImageType(new Uint8Array())).toBeNull();
  // RIFF sozinho também abre arquivos .wav e .avi
  expect(detectImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
});

test("readImageUpload devolve os bytes e o tipo detectado", async () => {
  const image = await readImageUpload(upload(imageForm("capa", PNG)), "capa");
  expect(image.type).toBe("image/png");
  expect(image.bytes).toEqual(PNG);
});

test("o tipo vem dos bytes, não do que o navegador declarou", async () => {
  const image = await readImageUpload(upload(imageForm("capa", PNG, "capa.jpg", "image/jpeg")), "capa");
  expect(image.type).toBe("image/png");
  await expect(readImageUpload(upload(imageForm("capa", FAKE_JPEG, "capa.jpg", "image/jpeg")), "capa")).rejects.toThrow("Envie uma imagem JPEG, PNG ou WebP");
});

test("campo ausente, arquivo vazio ou corpo que não é multipart: 400", async () => {
  await expect(readImageUpload(upload(imageForm("outro", PNG)), "capa")).rejects.toBeInstanceOf(InvalidInput);
  await expect(readImageUpload(upload(imageForm("capa", new Uint8Array())), "capa")).rejects.toBeInstanceOf(InvalidInput);
  await expect(readImageUpload(upload("{}", { "Content-Type": "application/json" }), "capa")).rejects.toBeInstanceOf(InvalidInput);
});

test("imagem acima de 2 MB: 413", async () => {
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(PNG);
  await expect(readImageUpload(upload(imageForm("capa", big)), "capa")).rejects.toBeInstanceOf(PayloadTooLarge);
});

test("Content-Length muito acima do limite é recusado antes de ler o corpo", async () => {
  const request = upload(imageForm("capa", PNG), { "Content-Length": String(10 * 1024 * 1024) });
  await expect(readImageUpload(request, "capa")).rejects.toBeInstanceOf(PayloadTooLarge);
});
