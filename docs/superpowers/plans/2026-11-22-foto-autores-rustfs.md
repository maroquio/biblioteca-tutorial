# Foto dos autores no RustFS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o UC26 para armazenar, servir e remover fotos de autores no RustFS, com consistência no PostgreSQL, invalidação do cache e limpeza após exclusão.

**Architecture:** A infraestrutura S3 compartilhada guarda os bytes sob uma chave pertencente ao módulo Autoria; o PostgreSQL guarda somente `foto_atualizada_em`. Escritas usam transação para a coluna e deixam cache e descarte de objetos para depois do commit, seguindo o desenho já usado pelas capas dos livros.

**Tech Stack:** Bun, TypeScript, Hono, PostgreSQL, Redis 8, RustFS/S3, Docker Compose, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-foto-autores-rustfs-design.md`

## Global Constraints

- Não alterar assinaturas, rotas, esquema, frontend nem expectativas dos testes fornecidos.
- A chave deve ser exatamente `autoria/autores/{id}/foto`.
- Toda operação de armazenamento deve receber o `client` injetado quando a função o oferece.
- `toAuthorView` deve receber o `tx` dentro de `inTransaction`.
- Invalidação do cache e descarte pós-exclusão devem ocorrer somente depois do commit.
- Os oito `test.todo` devem virar `test`, sem mudanças em seus corpos.

## Review Focus

- RustFS indisponível: upload e remoção retornam 503 sem mudar a coluna; coberto pelo teste “sem RustFS”.
- Autor removido entre a verificação e o update: o upload descarta o objeto e retorna 404; revisar o ramo `row === undefined` em `uploadAuthorPhoto`.
- Coluna aponta para objeto ausente: leitura retorna 404 “Autor sem foto”; coberto pelo teste de envio/leitura e revisão de `getAuthorPhoto`.
- Cache populado antes da escrita: upload e remoção causam MISS imediatamente após o commit; coberto pelo teste de cache.
- Exclusão recusada por livros vinculados: nenhuma foto deve ser descartada; preservado porque o descarte permanece após a transação bem-sucedida em `deleteAuthor`.

---

### Task 1: Ativar os critérios de aceite e implementar a chave da foto

**Files:**
- Modify: `backend/src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts`
- Modify: `backend/src/modules/authorship/infrastructure/photos.ts`

**Interfaces:**
- Consumes: `objectKey(...parts: (string | number)[]): string`.
- Produces: `photoKey(authorId: number): string` retornando a chave de propriedade de Autoria.

- [ ] **Step 1: Trocar os oito `test.todo` por `test`, sem alterar os corpos**

- [ ] **Step 2: Rodar os testes de aceite e confirmar o estado vermelho**

Run: `docker compose -f infra/compose.yaml run --rm --build test bun test src/modules/authorship/features/manage-author-photo`

Expected: FAIL nos oito testes por `NotImplemented`/501, começando por `photoKey` e pelas três operações do UC26.

- [ ] **Step 3: Implementar `photoKey(authorId)` com `objectKey("autoria", "autores", authorId, "foto")`**

- [ ] **Step 4: Rodar apenas o teste da chave**

Run: `docker compose -f infra/compose.yaml run --rm --build test bun test src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts -t "a chave da foto"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/authorship/infrastructure/photos.ts backend/src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts
git commit -m "test: ativar critérios de aceite da foto de autores"
```

### Task 2: Enviar, substituir e servir a foto

**Files:**
- Modify: `backend/src/modules/authorship/features/manage-author-photo/uploadAuthorPhoto.ts`
- Modify: `backend/src/modules/authorship/features/manage-author-photo/getAuthorPhoto.ts`

**Interfaces:**
- Consumes: `findAuthor`, `putObject`, `getObject`, `discardObject`, `inTransaction`, `toAuthorView`, `invalidateAuthorSearch`, `photoKey`.
- Produces: `uploadAuthorPhoto(...): Promise<AuthorView>` e `getAuthorPhoto(id, client): Promise<StoredObject>`.

- [ ] **Step 1: Confirmar que os testes de envio, troca, validação e leitura falham por implementação ausente**

Run: `docker compose -f infra/compose.yaml run --rm --build test bun test src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts -t "envia|trocar|recusa"`

Expected: FAIL com 501/`NotImplemented` nas chamadas válidas.

- [ ] **Step 2: Implementar `uploadAuthorPhoto`**

Verificar o autor via `findAuthor(sql, id)`, escrever com `putObject(photoKey(id), image.bytes, image.type, client)`, atualizar `foto_atualizada_em` dentro de `inTransaction`, retornar `toAuthorView(tx, row, integration)`, descartar o objeto e lançar `NotFound("Autor não encontrado")` se o update não retornar linha, e invalidar a busca após o commit.

- [ ] **Step 3: Implementar `getAuthorPhoto`**

Consultar `foto_atualizada_em`; lançar `NotFound("Autor não encontrado")` para linha ausente e `NotFound("Autor sem foto")` para coluna nula; buscar `getObject(photoKey(id), client)` e usar a mesma mensagem de foto ausente se não houver objeto.

- [ ] **Step 4: Rodar os testes de envio, troca, validação e leitura**

Run: `docker compose -f infra/compose.yaml run --rm --build test bun test src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts -t "envia|trocar|recusa"`

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/authorship/features/manage-author-photo/uploadAuthorPhoto.ts backend/src/modules/authorship/features/manage-author-photo/getAuthorPhoto.ts
git commit -m "feat: armazenar e servir fotos de autores"
```

### Task 3: Remover a foto com ordem segura

**Files:**
- Modify: `backend/src/modules/authorship/features/manage-author-photo/removeAuthorPhoto.ts`

**Interfaces:**
- Consumes: `requireStorage`, `inTransaction`, `discardObject`, `photoKey`, `invalidateAuthorSearch`.
- Produces: `removeAuthorPhoto(id, client): Promise<void>`.

- [ ] **Step 1: Confirmar que os testes de remoção e indisponibilidade falham**

Run: `docker compose -f infra/compose.yaml run --rm --build test bun test src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts -t "remover a foto|sem RustFS"`

Expected: FAIL por `NotImplemented` na remoção.

- [ ] **Step 2: Implementar `removeAuthorPhoto`**

Chamar `requireStorage(client)` antes do banco; em transação, zerar `foto_atualizada_em` com `RETURNING id`; lançar `NotFound("Autor não encontrado")` se nenhuma linha voltar; depois do commit, chamar `discardObject(photoKey(id), client)` e `invalidateAuthorSearch()`.

- [ ] **Step 3: Rodar os testes de remoção e indisponibilidade**

Run: `docker compose -f infra/compose.yaml run --rm --build test bun test src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts -t "remover a foto|sem RustFS"`

Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/authorship/features/manage-author-photo/removeAuthorPhoto.ts
git commit -m "feat: remover fotos de autores do RustFS"
```

### Task 4: Limpar a foto ao excluir o autor

**Files:**
- Modify: `backend/src/modules/authorship/features/delete-author/deleteAuthor.ts`

**Interfaces:**
- Consumes: `discardObject(key)`, `photoKey(id)`.
- Produces: `deleteAuthor` removendo também o objeto após uma exclusão confirmada.

- [ ] **Step 1: Confirmar que o teste de exclusão deixa o objeto no bucket**

Run: `docker compose -f infra/compose.yaml run --rm --build test bun test src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts -t "excluir o autor"`

Expected: FAIL porque `getObject(photoKey(id))` ainda encontra o objeto.

- [ ] **Step 2: Importar `discardObject` e `photoKey` e descartar após o commit**

Preservar a transação, a regra de conflito e a invalidação existentes; chamar `discardObject(photoKey(id))` somente depois que a exclusão e a invalidação terminarem.

- [ ] **Step 3: Rodar o teste de exclusão e a suíte de `delete-author`**

Run: `docker compose -f infra/compose.yaml run --rm --build test bun test src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts -t "excluir o autor" src/modules/authorship/features/delete-author`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/authorship/features/delete-author/deleteAuthor.ts
git commit -m "feat: descartar foto ao excluir autor"
```

### Task 5: Verificar o UC26 e documentar a apresentação

**Files:**
- Create: `.docs/roteiro-apresentacao-rustfs-autores.md`
- Modify if necessary: only files already listed in Tasks 1–4.

**Interfaces:**
- Consumes: comportamento implementado e evidências reais dos comandos de verificação.
- Produces: roteiro em português para apresentação de 8–12 minutos.

- [ ] **Step 1: Rodar os oito critérios de aceite**

Run: `docker compose -f infra/compose.yaml run --rm --build test bun test src/modules/authorship/features/manage-author-photo`

Expected: 8 PASS, 0 FAIL, 0 TODO.

- [ ] **Step 2: Rodar verificações estruturais**

Run: `docker compose -f infra/compose.yaml run --rm --build test bun run check-boundaries`

Expected: PASS.

Run: `docker compose -f infra/compose.yaml run --rm --build test bun run typecheck`

Expected: PASS.

- [ ] **Step 3: Rodar a suíte completa**

Run: `docker compose -f infra/compose.yaml run --rm --build test`

Expected: 128 PASS, 0 FAIL, 0 TODO.

- [ ] **Step 4: Criar o roteiro com tempos, falas, arquivos a mostrar e sequência de demonstração**

Incluir: problema, arquitetura, chave e propriedade modular, upload, leitura, remoção, ordem das escritas, cache pós-commit, falhas/objetos órfãos, demonstração no navegador/RustFS, testes e conclusão.

- [ ] **Step 5: Commit**

```bash
git add .docs/roteiro-apresentacao-rustfs-autores.md
git commit -m "docs: adicionar roteiro da apresentação do UC26"
```
