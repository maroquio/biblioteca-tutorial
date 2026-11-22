import { S3Client } from "bun";

// 1. O cliente S3 do próprio Bun: nenhum pacote para instalar.
//    Aponta para o RustFS do compose.yaml desta pasta.
const s3 = new S3Client({
  endpoint: "http://localhost:9100",
  accessKeyId: "exemplo",
  secretAccessKey: "exemplo-secreto",
  bucket: "fotos",
});

// 2. Validação: o tipo vem dos primeiros bytes do arquivo (a "assinatura"),
//    nunca do nome nem do Content-Type que o navegador mandou.
const MAX_BYTES = 2 * 1024 * 1024;

const SIGNATURES = [
  { type: "image/jpeg", ext: "jpg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", ext: "png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // WebP: "RIFF" no início e "WEBP" a partir do byte 8
  { type: "image/webp", ext: "webp", offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
];

function detectImage(bytes: Uint8Array) {
  return SIGNATURES.find((s) => s.bytes.every((b, i) => bytes[s.offset + i] === b)) ?? null;
}

Bun.serve({
  port: 3200,
  routes: {
    // a página de upload
    "/": () => new Response(Bun.file(new URL("./index.html", import.meta.url))),

    "/fotos": {
      // LIST: as chaves que começam com "fotos/"
      GET: async () => {
        const result = await s3.list({ prefix: "fotos/" });
        const photos = (result.contents ?? []).map((o) => ({ chave: o.key, bytes: o.size }));
        return Response.json(photos);
      },

      // POST: recebe o multipart, valida e grava o objeto
      POST: async (req) => {
        const form = await req.formData();
        const file = form.get("foto");
        if (!(file instanceof File)) return Response.json({ error: "Envie o campo foto" }, { status: 400 });
        if (file.size > MAX_BYTES) return Response.json({ error: "A foto passa de 2 MB" }, { status: 413 });

        const bytes = new Uint8Array(await file.arrayBuffer());
        const image = detectImage(bytes);
        if (!image) return Response.json({ error: "Envie JPEG, PNG ou WebP" }, { status: 400 });

        // a chave é escolhida pelo servidor: nada do nome original entra nela
        const key = `fotos/${crypto.randomUUID()}.${image.ext}`;
        await s3.write(key, bytes, { type: image.type });
        return Response.json({ chave: key }, { status: 201 });
      },
    },

    "/fotos/:nome": {
      // GET: lê do RustFS e devolve os bytes, com o Content-Type gravado no upload
      GET: async (req) => {
        const key = `fotos/${req.params.nome}`;
        const file = s3.file(key);
        try {
          const { type } = await file.stat();
          // Atenção: new Response(file) responderia 302 para uma URL assinada
          // do RustFS. Aqui queremos que os bytes passem pelo servidor.
          return new Response(file.stream(), { headers: { "Content-Type": type } });
        } catch (error) {
          if ((error as { code?: string }).code === "NoSuchKey") return new Response("Não encontrada", { status: 404 });
          throw error;
        }
      },

      // DELETE: apagar uma chave que não existe também dá certo
      DELETE: async (req) => {
        await s3.delete(`fotos/${req.params.nome}`);
        return new Response(null, { status: 204 });
      },
    },
  },
});

console.log("Exemplo em http://localhost:3200");
