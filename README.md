# Truckers Duel — versão final automática

## O que esta versão faz

- Compara Guilherme BR (#80613) e Fantasma MG (#321853).
- Busca os dados nos perfis públicos do TrucksBook usando um navegador headless.
- Seleciona ETS2 + Monthly/All-time + Real/All conforme necessário.
- Mantém cache de 1 hora para reduzir acessos.
- Guarda até 30 pontos históricos em `server/data.json`.
- Tem interface responsiva para celular e PC.
- Não pede nem guarda senha do TrucksBook.

## Por que Playwright?

A página pública do perfil deixa a área de estatísticas como conteúdo carregado dinamicamente. Portanto, um simples `fetch()` do HTML não é suficiente para obter todos os números. O Playwright abre a página como um navegador, seleciona os filtros e lê o resultado.

## Rodar

Node 20+:

```bash
cd server
npm install
npx playwright install chromium
npm start
```

Abra `http://localhost:3000`.

## Publicar barato

A opção mais simples é um serviço de hospedagem que aceite Docker. Use o `Dockerfile` da raiz. A aplicação expõe a porta 3000.

Depois de obter uma URL HTTPS, você terá:

`https://SEU-ENDERECO/api/stats`

e o dashboard:

`https://SEU-ENDERECO/`

## Atenção

Os Termos do TrucksBook proíbem sobrecarregar a base de dados com robôs. Por isso o projeto foi feito para no máximo uma coleta por hora e apenas dois perfis. Antes de tornar o serviço público, é recomendável confirmar com o TrucksBook que esta forma de leitura automatizada é aceitável.

Os valores de fallback incluídos são apenas uma rede de segurança; a finalidade é usar os dados obtidos automaticamente.
