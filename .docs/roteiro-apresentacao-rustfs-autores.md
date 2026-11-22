# Roteiro de apresentação — foto dos autores no RustFS (UC26)

**Duração estimada:** 8 a 12 minutos
**Objetivo:** explicar o problema, as decisões de consistência e demonstrar o envio, a leitura e a remoção da foto de um autor.

## Preparação antes de apresentar

Na raiz do projeto, deixe a infraestrutura e a aplicação prontas:

```powershell
docker compose -f infra/compose.yaml up -d --build
```

Abra antecipadamente:

- aplicação: <http://localhost:3000>
- console do RustFS: <http://localhost:9011/rustfs/console/>
- bucket `biblioteca`
- página de consulta de autores

Tenha também estes arquivos abertos no editor:

1. `backend/src/modules/authorship/infrastructure/photos.ts`
2. `backend/src/modules/authorship/features/manage-author-photo/uploadAuthorPhoto.ts`
3. `backend/src/modules/authorship/features/manage-author-photo/getAuthorPhoto.ts`
4. `backend/src/modules/authorship/features/manage-author-photo/removeAuthorPhoto.ts`
5. `backend/src/modules/authorship/features/delete-author/deleteAuthor.ts`
6. `backend/src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts`

## 1. Contexto e objetivo — 1 minuto

### Fala sugerida

> “Nesta atividade implementei o UC26, responsável pela foto dos autores. A solução segue a arquitetura já usada para a capa dos livros: os bytes da imagem ficam no RustFS, que oferece uma API compatível com S3, enquanto o PostgreSQL guarda apenas a informação de quando a foto foi atualizada.”

> “A funcionalidade permite enviar ou substituir, consultar e remover a foto. Ela também trata a indisponibilidade do armazenamento, invalida o cache da busca e remove o objeto quando o autor é excluído.”

### Destaque

O banco e o armazenamento têm responsabilidades diferentes:

```text
PostgreSQL                              RustFS
autores.foto_atualizada_em ──────────> autoria/autores/{id}/foto
indica se há foto e sua versão          guarda tipo e bytes da imagem
```

## 2. Chave do objeto e fronteira modular — 1 minuto

### Mostrar

`backend/src/modules/authorship/infrastructure/photos.ts`

### Fala sugerida

> “Cada foto usa uma chave fixa por autor: `autoria/autores/{id}/foto`. Uma nova foto sobrescreve o objeto anterior. O primeiro trecho, `autoria`, declara qual módulo é dono do objeto e permite que o verificador de fronteiras detecte acessos indevidos.”

> “A função `photoKey` fica em `infrastructure/photos.ts`, fora de uma fatia específica, porque tanto o gerenciamento da foto quanto a exclusão do autor precisam usá-la. Assim, uma feature não importa outra feature.”

## 3. Fluxo de envio e substituição — 2 minutos

### Mostrar

`backend/src/modules/authorship/features/manage-author-photo/uploadAuthorPhoto.ts`

### Sequência

1. `findAuthor` confirma que o autor existe antes de escrever bytes.
2. `putObject` grava a imagem na chave fixa.
3. Uma transação atualiza `foto_atualizada_em`.
4. `toAuthorView(tx, ...)` monta a resposta dentro da mesma transação.
5. Depois do commit, `invalidateAuthorSearch` invalida o cache.

### Fala sugerida

> “No upload, o objeto é escrito antes da coluna. Essa ordem evita o pior estado possível: um autor apontando para uma foto que ainda não existe. Se o processo parar entre as duas escritas, pode sobrar um objeto órfão, mas a aplicação não anuncia uma foto quebrada.”

> “O `toAuthorView` recebe o `tx`, não a conexão global. Isso é importante porque outra conexão ainda não enxergaria a atualização antes do commit e poderia devolver a URL antiga.”

> “Se o autor desaparecer entre a primeira verificação e o update, o objeto recém-enviado é descartado e a operação responde 404.”

### Versão na URL

A resposta contém uma URL semelhante a:

```text
/api/autores/42/foto?v=1795363200000
```

O valor de `v` vem de `foto_atualizada_em`. A chave no RustFS continua fixa, mas a URL muda, fazendo o navegador buscar a nova versão em vez de reutilizar a imagem antiga do cache.

## 4. Fluxo de leitura — 1 minuto

### Mostrar

`backend/src/modules/authorship/features/manage-author-photo/getAuthorPhoto.ts`

### Fala sugerida

> “A leitura consulta primeiro o PostgreSQL. Se o autor não existir, responde ‘Autor não encontrado’. Se a coluna for nula, responde ‘Autor sem foto’ sem consultar o RustFS.”

> “Somente quando o banco indica que existe uma foto a função busca o objeto. Se a coluna estiver preenchida, mas o objeto tiver desaparecido, a resposta também é 404, porque não há bytes válidos para servir.”

> “A rota preserva o `Content-Type` armazenado e entrega exatamente os bytes recebidos no upload.”

## 5. Remoção e exclusão do autor — 1 minuto e 30 segundos

### Mostrar

- `removeAuthorPhoto.ts`
- `deleteAuthor.ts`

### Fala sugerida

> “Na remoção, a ordem é inversa à do upload. Primeiro o PostgreSQL esquece a foto; depois o objeto é descartado. Se o RustFS falhar após o commit, pode sobrar um objeto órfão, mas nenhum autor aponta para uma foto inexistente.”

> “Antes de mexer no banco, `requireStorage` confirma que o serviço está disponível. Por isso, com o RustFS fora do ar, a operação responde 503 e o autor continua exatamente como estava.”

> “Ao excluir um autor, a foto também é descartada, mas somente depois que a transação de exclusão termina. Se a exclusão for recusada porque existem livros vinculados, o objeto permanece.”

## 6. Cache e momento do commit — 1 minuto

### Fala sugerida

> “A busca de autores fica em cache no Redis por até 60 segundos e inclui a `fotoUrl`. Por isso, upload e remoção precisam invalidar esse cache.”

> “A invalidação acontece depois do commit. Se acontecesse antes, uma busca concorrente poderia ler o valor antigo no PostgreSQL e gravá-lo novamente na nova geração do cache.”

### Resumo visual

```text
UPLOAD:  objeto no RustFS → transação no PostgreSQL → COMMIT → invalida Redis
REMOÇÃO: valida RustFS → transação no PostgreSQL → COMMIT → descarta objeto → invalida Redis
EXCLUSÃO: transação no PostgreSQL → COMMIT → invalida Redis → descarta objeto
```

## 7. Demonstração — 2 minutos

### Roteiro da demonstração

1. Na consulta de autores, escolha ou cadastre um autor sem foto.
2. Abra a opção **Foto** desse autor.
3. Envie uma imagem PNG ou JPEG.
4. Volte à busca e mostre a miniatura.
5. Atualize a foto com outro arquivo e destaque a mudança do parâmetro `?v=`.
6. No console do RustFS, mostre o objeto em `autoria/autores/{id}/foto`.
7. Remova a foto pela aplicação.
8. Mostre `fotoUrl: null` na consulta e confirme que o objeto saiu do bucket.

### Demonstração opcional de falha

Pare apenas o RustFS:

```powershell
docker compose -f infra/compose.yaml stop rustfs
```

Tente enviar uma foto e mostre a resposta 503 sem impedir a consulta de autores. Depois, restaure o serviço:

```powershell
docker compose -f infra/compose.yaml start rustfs
```

## 8. Testes e evidências — 1 minuto

### Mostrar

`backend/src/modules/authorship/features/manage-author-photo/manage-author-photo.test.ts`

### Fala sugerida

> “Os oito critérios de aceite começaram como `test.todo`. Eu os ativei antes da implementação, observei as falhas esperadas e implementei os fluxos em ciclos vermelho e verde.”

Os testes cobrem:

- propriedade e formato da chave;
- upload e leitura dos mesmos bytes;
- substituição e mudança da URL versionada;
- validações 400, 413 e 404;
- remoção da coluna e do objeto;
- indisponibilidade do RustFS com resposta 503;
- invalidação do cache no upload e na remoção;
- descarte da foto ao excluir o autor.

### Resultados verificados

```text
Critérios do UC26: 8 pass, 0 fail
Suíte completa:    128 pass, 0 fail, 0 todo
Fronteiras:        respeitadas
TypeScript:        typecheck sem erros
```

## 9. Encerramento — 30 segundos

### Fala sugerida

> “A solução separa metadados e bytes, mantém a propriedade modular da chave e escolhe ordens de escrita que preferem objetos órfãos recuperáveis a referências quebradas visíveis para o usuário.”

> “Para produção, os próximos passos seriam servir as imagens diretamente por um domínio de mídia com URLs assinadas, criar uma rotina segura de limpeza de órfãos e definir como caches e backups participam de pedidos de exclusão pela LGPD.”

## Perguntas que podem aparecer

### Por que aceitar objetos órfãos?

Porque eles não quebram a experiência do usuário e podem ser encontrados por uma rotina de reconciliação. Uma referência no banco sem objeto produziria uma foto quebrada anunciada como existente.

### Como limpar objetos órfãos?

Listar o prefixo `autoria/autores/`, extrair os IDs e comparar com autores cuja `foto_atualizada_em` está preenchida. A limpeza precisa considerar uploads em andamento, por exemplo ignorando objetos muito recentes ou usando uma janela de segurança antes de apagá-los.

### Por que uma chave fixa?

Ela simplifica substituição e limpeza: existe no máximo uma chave conhecida por autor. A URL versionada com `?v=` evita que o navegador continue mostrando a imagem antiga.

### O que mudaria com URLs assinadas?

O backend devolveria uma URL temporária do serviço de mídia em vez de repassar todos os bytes. O armazenamento ou gateway validaria a assinatura e sua expiração; `Cache-Control` precisaria respeitar a validade da URL e a política de privacidade.
