/* oxlint-disable react/only-export-components -- Cada page.tsx exporta metadados e componente para o carregamento automático. */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loading, Notices } from "../../../../shared/ui/feedback.tsx";
import { RecordPicker } from "../../../../shared/ui/fields.tsx";
import { ImageManager } from "../../../../shared/ui/images.tsx";
import { Page } from "../../../../shared/ui/Page.tsx";
import { useFetch } from "../../../../shared/useFetch.ts";
import type { Book } from "../../types.ts";

function ManageBookCover() {
  const [params, setParams] = useSearchParams();
  const id = params.get("id") ?? "";
  // cada envio ou remoção recarrega a lista: a capaUrl nova vem com outro ?v=
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const books = useFetch<Book[]>("/api/livros", revision);
  const book = books.data?.find((item) => String(item.id) === id) ?? null;
  return <Page title="Capa do livro" description="Escolha o livro e envie, troque ou remova a imagem da capa. A imagem fica no armazenamento de objetos; o catálogo guarda só quando ela mudou.">
    <Loading loading={books.loading} error={books.error} />
    {books.data && <RecordPicker label="Livro" items={books.data} itemLabel={(item) => `${item.titulo} · ${item.isbn}`} value={id} onChange={(value) => { setParams(value ? { id: value } : {}); setNotice(""); }} />}
    {book && <ImageManager key={book.id} imageUrl={book.capaUrl} alt={`Capa de ${book.titulo}`} endpoint={`/api/livros/${book.id}/capa`} field="capa" noun="capa" onChange={(message) => { setNotice(message); setRevision((value) => value + 1); }} onStart={() => setNotice("")} />}
    <Notices success={notice} />
    <p className="form-footer"><Link to="/livros">Voltar à consulta</Link></p>
  </Page>;
}

export default { useCase: "UC25", title: "Capa do livro", path: "/livros/capa", Component: ManageBookCover };
