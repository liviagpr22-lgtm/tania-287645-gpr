# Tania Briet Acessorios

Loja completa com catalogo, categorias, carrinho, cupons, pedidos, lista de espera e painel administrativo.

## Rodar localmente

```bash
npm install
npm start
```

Acesse **http://localhost:8080**.

## Publicacao

O repositorio esta preparado para Netlify:

- `public/` e gerado por `node netlify/preparar.js` a partir dos arquivos da loja.
- `netlify/functions/api.js` roda a API Node com persistencia em Netlify Blobs.
- `data/tania-inicial.db` e um banco sanitizado usado apenas no primeiro acesso.

Variaveis de ambiente necessarias na hospedagem:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

O painel fica em `/painel-tania.html`.
