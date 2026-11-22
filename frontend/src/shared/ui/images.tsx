import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { api, sendFile } from "../api.ts";
import { Notices } from "./feedback.tsx";
import { Field } from "./fields.tsx";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = "image/jpeg,image/png,image/webp";

/** Miniatura numa linha de tabela; sem imagem, um espaço do mesmo tamanho. */
export function Thumbnail({ url, alt = "" }: { url: string | null; alt?: string }) {
  return url
    ? <img className="thumb" src={url} alt={alt} loading="lazy" width={48} height={64} />
    : <span className="thumb thumb-empty" aria-hidden="true" />;
}

/**
 * Mostra a imagem atual de um registro e permite enviar outra ou remover.
 * `endpoint` recebe PUT (multipart, no campo `field`) e DELETE. `noun` é a
 * palavra usada nas mensagens: "capa", "foto". Depois de cada mudança,
 * `onChange` recebe a mensagem de sucesso: a página recarrega o registro e
 * mostra a mensagem, que sobrevive à recarga. `onStart` avisa que o usuário
 * escolheu outro arquivo ou começou um envio: a página apaga a mensagem antiga.
 */
export function ImageManager({ imageUrl, alt, endpoint, field, noun, onChange, onStart }: {
  imageUrl: string | null; alt: string; endpoint: string; field: string; noun: string;
  onChange: (message: string) => void; onStart: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);

  // a pré-visualização é um endereço blob: local; libera a memória quando troca
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setError(""); onStart();
    // conferir aqui só poupa o envio: o servidor confere de novo, pelos bytes
    if (chosen && chosen.size > MAX_BYTES) {
      setError("A imagem passa de 2 MB.");
      event.target.value = "";
      setFile(null); setPreview("");
      return;
    }
    setFile(chosen);
    setPreview(chosen ? URL.createObjectURL(chosen) : "");
  }

  async function run(action: () => Promise<unknown>, done: string, form?: HTMLFormElement) {
    setSending(true); setError(""); onStart();
    try {
      await action();
      setFile(null); setPreview(""); form?.reset();
      onChange(done);
    } catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file) void run(() => sendFile(endpoint, field, file), `${Noun} enviada.`, event.currentTarget);
  }

  function remove() {
    void run(() => api(endpoint, { method: "DELETE" }), `${Noun} removida.`);
  }

  return <>
    <div className="image-manager">
      <figure className="image-current">
        {imageUrl ? <img src={imageUrl} alt={alt} /> : <div className="image-empty">Sem {noun}</div>}
        <figcaption>{imageUrl ? `${Noun} atual` : `Nenhuma ${noun} enviada`}</figcaption>
      </figure>
      <form className="record-form" onSubmit={save}>
        <Field name={field} label={imageUrl ? `Trocar a ${noun}` : `Escolher a ${noun}`} hint="JPEG, PNG ou WebP, até 2 MB.">
          <input id={field} name={field} type="file" accept={ACCEPTED} required onChange={choose} aria-describedby={`${field}-hint`} />
        </Field>
        {preview && <img className="image-preview" src={preview} alt="Pré-visualização da imagem escolhida" />}
        <div className="button-row">
          <button type="submit" disabled={sending || !file}>{sending ? "Enviando…" : `Enviar ${noun}`}</button>
          {imageUrl && <button type="button" className="danger" disabled={sending} onClick={remove}>Remover {noun}</button>}
        </div>
      </form>
    </div>
    <Notices error={error} />
  </>;
}
