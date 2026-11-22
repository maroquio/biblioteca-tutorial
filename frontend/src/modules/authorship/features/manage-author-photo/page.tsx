/* oxlint-disable react/only-export-components -- Cada page.tsx exporta metadados e componente para o carregamento automático. */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loading, Notices } from "../../../../shared/ui/feedback.tsx";
import { RecordPicker } from "../../../../shared/ui/fields.tsx";
import { ImageManager } from "../../../../shared/ui/images.tsx";
import { Page } from "../../../../shared/ui/Page.tsx";
import { useFetch } from "../../../../shared/useFetch.ts";
import type { Author } from "../../types.ts";

function ManageAuthorPhoto() {
  const [params, setParams] = useSearchParams();
  const id = params.get("id") ?? "";
  // cada envio ou remoção recarrega a lista: a fotoUrl nova vem com outro ?v=
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  // a lista vem da busca de autores, que tem cache no Redis: se o envio não
  // invalidar esse cache, a foto nova só aparece aqui quando ele expirar
  const authors = useFetch<Author[]>("/api/autores", revision);
  const author = authors.data?.find((item) => String(item.id) === id) ?? null;
  return <Page title="Foto do autor" description="Escolha o autor e envie, troque ou remova a foto. A imagem fica no armazenamento de objetos; o cadastro guarda só quando ela mudou.">
    <Loading loading={authors.loading} error={authors.error} />
    {authors.data && <RecordPicker label="Autor" items={authors.data} itemLabel={(item) => item.nome} value={id} onChange={(value) => { setParams(value ? { id: value } : {}); setNotice(""); }} />}
    {author && <ImageManager key={author.id} imageUrl={author.fotoUrl} alt={`Foto de ${author.nome}`} endpoint={`/api/autores/${author.id}/foto`} field="foto" noun="foto" onChange={(message) => { setNotice(message); setRevision((value) => value + 1); }} onStart={() => setNotice("")} />}
    <Notices success={notice} />
    <p className="form-footer"><Link to="/autores">Voltar à consulta</Link></p>
  </Page>;
}

export default { useCase: "UC26", title: "Foto do autor", path: "/autores/foto", Component: ManageAuthorPhoto };
