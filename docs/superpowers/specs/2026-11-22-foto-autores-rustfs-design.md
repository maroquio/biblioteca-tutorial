# Foto dos autores no RustFS — design

## Intenção

Implementar o UC26 descrito em `.docs/atividades/atividade-rustfs.html`: enviar, servir, substituir e remover a foto de um autor, mantendo os bytes no RustFS e somente a versão da foto no PostgreSQL. O trabalho também deve resultar em um roteiro de apresentação que explique e demonstre a solução.

## Objetivos

- Fazer `photoKey(authorId)` produzir `autoria/autores/{id}/foto`.
- Gravar o objeto antes de marcar `foto_atualizada_em`, evitando registros que apontem para bytes inexistentes.
- Servir a imagem com tipo e bytes preservados e responder 404 para autor ou foto ausentes.
- Limpar a coluna antes de descartar o objeto na remoção.
- Invalidar o cache de busca de autores somente depois do commit.
- Descartar a foto depois do commit quando o autor for excluído.
- Ativar, sem alterar expectativas, os oito testes de aceite atualmente marcados como `test.todo`.
- Entregar um roteiro em Markdown para apresentar arquitetura, decisões, demonstração e resultados dos testes.

## Não objetivos

- Alterar rotas, frontend, esquema do banco, validação de imagens ou contratos existentes.
- Generalizar capa e foto em uma nova abstração de mídia.
- Implementar URLs assinadas, CDN ou limpeza automática de objetos órfãos.
- Publicar a branch ou abrir pull request sem pedido explícito.

## Restrições

- Preservar todas as assinaturas existentes.
- Reaproveitar `storage.ts`, `inTransaction`, `findAuthor`, `toAuthorView` e `invalidateAuthorSearch`.
- Passar o `client` injetado a todas as operações de armazenamento para que `client: null` simule indisponibilidade.
- Usar o `tx` ao chamar `toAuthorView` dentro da transação.
- Manter operações de cache e descarte pós-commit fora da transação.
- Seguir TDD usando os testes de aceite fornecidos, ativando-os progressivamente.

## Abordagens consideradas

1. **Espelhar o UC25 e adaptar as diferenças de Autoria — escolhida.** É a intenção didática do enunciado, preserva fronteiras e cobre cache, integração e consistência transacional.
2. **Criar uma abstração genérica para mídia.** Reduziria duplicação, mas aumentaria o escopo e esconderia as decisões que a atividade quer tornar explícitas.
3. **Copiar literalmente o UC25.** É simples, porém incorreto: usaria outro dono de chave, não invalidaria o cache e não montaria `AuthorView` corretamente.

## Desenho da solução

`uploadAuthorPhoto` verificará o autor antes de escrever, gravará a imagem na chave fixa e atualizará `foto_atualizada_em` em transação. O `RETURNING` fornecerá um `AuthorRow`, e `toAuthorView(tx, ...)` produzirá a resposta já com a nova versão. Se o autor desaparecer entre a verificação e o update, o objeto será descartado. Após o commit, a busca de autores será invalidada.

`getAuthorPhoto` consultará primeiro o PostgreSQL. Autor inexistente e coluna nula terão mensagens 404 distintas, sem acessar o RustFS. Quando a coluna indicar foto, a função lerá o objeto; ausência física também resultará em 404 de foto.

`removeAuthorPhoto` exigirá armazenamento disponível antes da transação, zerará a coluna e confirmará a existência do autor. Após o commit, descartará o objeto e invalidará o cache. `deleteAuthor` também descartará a chave depois de concluir exclusão e invalidação.

## Verificação

- Observar cada teste recém-ativado falhar pelo motivo esperado antes da implementação correspondente.
- Rodar os testes do UC26 durante os ciclos vermelho/verde.
- Ao final, executar a suíte completa, `bun run check-boundaries` e `bun run typecheck` no ambiente indicado pelo projeto.
- Confirmar 128 testes passando, nenhum `todo` e nenhum teste falhando, ou registrar claramente qualquer impedimento ambiental.

## Roteiro de apresentação

Será criado em `.docs/roteiro-apresentacao-rustfs-autores.md`, em português, com uma sequência de aproximadamente 8 a 12 minutos: contexto e problema, arquitetura, fluxo de upload/leitura/remoção, decisões de consistência, cache, tratamento de falhas, demonstração sugerida, evidências de testes e perguntas para discussão.
