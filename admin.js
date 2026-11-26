// Painel administrativo - Tania Briet Acessorios
const CHAVE_PRODUTOS = 'tania_produtos';
const CATEGORIAS = [
  ['bijuterias', 'Bijuterias e Acessórios'],
  ['cabelo', 'Acessórios para Cabelo'],
  ['maquiagem', 'Maquiagem e Beleza'],
  ['roupas', 'Moda e Vestuário'],
  ['chinelo', 'Chinelos'],
  ['presentes', 'Presentes']
];

let listaProdutos = [];
let editandoId = null;
let imagemEscolhida = null;
let imagemAlterada = false;
let variacoesFormulario = [];
let fotoVariacaoEscolhida = null;

function clonar(obj) { return JSON.parse(JSON.stringify(obj)); }

// Cada cor/modelo tem seu proprio estoque; valor invalido ou vazio = nao alterar.
function numeroEstoque(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  const n = Number(String(valor).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function estoqueDaVariacao(v) {
  if (!v) return 0;
  return numeroEstoque(v.estoque !== undefined ? v.estoque : v.disponivel);
}

function esc(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mensagem(texto, erro) {
  const el = document.getElementById('mensagem');
  if (!el) return;
  el.textContent = texto;
  el.className = 'mensagem ' + (erro ? 'erro' : 'ok');
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(function () { el.style.display = 'none'; }, 4000);
}

// Sessao expirada: volta para o login com aviso em vez de falhar silenciosamente.
function sessaoExpirada() {
  const login = document.getElementById('telaLogin');
  const painel = document.getElementById('painel');
  if (login) login.style.display = 'block';
  if (painel) painel.style.display = 'none';
  const erro = document.getElementById('erroLogin');
  if (erro) erro.textContent = 'Sessão expirada. Entre novamente.';
  const msg = document.getElementById('mensagem');
  if (msg) { msg.textContent = 'Sessão expirada. Entre novamente.'; msg.className = 'mensagem erro'; msg.style.display = 'block'; }
  return false;
}
function erroAutenticacao(r) {
  if (!r || r.status !== 401) return false;
  return sessaoExpirada();
}

// Confirma a sessao antes de qualquer acao administrativa.
async function verificarSessaoAtiva() {
  try {
    const r = await fetch('api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(function () { return {}; });
    if (!r.ok || !d.usuario) { sessaoExpirada(); return false; }
  } catch (e) { /* sem conexao: deixa a acao tentar normalmente */ }
  return true;
}


function carregarLista() {
  // Usa a lista global carregada do servidor pelo script.js
  if (typeof produtos !== 'undefined' && Array.isArray(produtos) && produtos.length) return clonar(produtos);
  try {
    const salvos = localStorage.getItem(CHAVE_PRODUTOS);
    if (salvos) {
      const arr = JSON.parse(salvos);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) {}
  return [];
}

function salvarLista() {
  try {
    localStorage.setItem(CHAVE_PRODUTOS, JSON.stringify(listaProdutos));
  } catch (e) {
    mensagem('Nao foi possivel salvar localmente - use fotos menores.', true);
    return false;
  }
  // Salva tambem no servidor para aparecer em todos os dispositivos
  fetch('api/produtos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(listaProdutos)
  }).then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.ok) mensagem('Salvo! Aparece em todos os dispositivos (' + d.total + ' produtos).');
      else mensagem('Salvo neste navegador, mas nao foi possivel sincronizar com o servidor.', true);
    })
    .catch(function () {
      mensagem('Salvo neste navegador. Para sincronizar, o servidor precisa estar ligado.', true);
    });
  return true;
}

async function entrar() {
  const email = (document.getElementById('emailAdmin') ? document.getElementById('emailAdmin').value : '').trim();
  const campo = document.getElementById('senha');
  const erro = document.getElementById('erroLogin');
  if (erro) erro.textContent = '';
  const msgEntrada = document.getElementById('mensagem');
  if (msgEntrada) { msgEntrada.textContent = ''; msgEntrada.style.display = 'none'; }
  if (!email || !campo || !campo.value) { if (erro) erro.textContent = 'Informe e-mail e senha.'; return; }
  try {
    const r = await fetch('api/auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, senha: campo.value })
    });
    let d = {};
    try { d = await r.json(); } catch (e) { d = {}; }
    if (!r.ok) {
      if (r.status === 429) { if (erro) erro.textContent = d.erro || 'Muitas tentativas. Aguarde alguns minutos.'; return; }
      if (r.status === 401) { if (erro) erro.textContent = 'E-mail ou senha incorretos.'; return; }
      if (erro) erro.textContent = d.erro || 'Falha no login.';
      return;
    }
    if (!d.usuario || d.usuario.role !== 'admin') {
      await fetch('api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (erro) erro.textContent = 'Acesso negado: conta sem permissao de administrador.';
      return;
    }
    mostrarPainel();
  } catch (e) {
    if (erro) erro.textContent = 'Erro de conexao.';
  }
}

function mostrarPainel() {
  document.getElementById('telaLogin').style.display = 'none';
  document.getElementById('painel').style.display = 'block';
  const pronto = function () {
    listaProdutos = carregarLista();
    popularCategorias();
    renderizarLista();
    limparFormulario();
    // Recarrega tambem as areas administrativas apos um novo login.
    if (typeof carregarListaServidor === 'function') carregarListaServidor();
    if (typeof window.carregarCategoriasAdmin === 'function') window.carregarCategoriasAdmin();
    if (typeof window.carregarEstoque === 'function') window.carregarEstoque();
    if (typeof window.carregarPedidosAdmin === 'function') window.carregarPedidosAdmin();
    if (typeof window.carregarWaitlistAdmin === 'function') window.carregarWaitlistAdmin();
    if (typeof window.carregarCuponsAdmin === 'function') window.carregarCuponsAdmin();
    if (typeof window.carregarProdutosLive === 'function') window.carregarProdutosLive();
    if (typeof window.carregarLives === 'function') window.carregarLives();
  };
  if (window.produtosPromise && typeof window.produtosPromise.then === 'function') {
    window.produtosPromise.then(pronto);
  } else {
    pronto();
  }
}

async function sair() {
  try { await fetch('api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
  location.reload();
}

function popularCategorias() {
  const sel = document.getElementById('categoria');
  if (!sel) return;
  // Usa as categorias do banco (inclui subcategorias) quando disponivel.
  if (typeof window.popularCategoriasForm === 'function') { window.popularCategoriasForm(); return; }
  sel.innerHTML = CATEGORIAS.map(function (c) {
    return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>';
  }).join('');
}

function atualizarResumo() {
  const el = document.getElementById('resumo');
  if (el) el.textContent = listaProdutos.length + ' produtos cadastrados';
}

function renderizarLista(lista) {
  const arr = Array.isArray(lista) ? lista : listaProdutos;
  const box = document.getElementById('listaProdutos');
  if (!box) return;
  if (!arr.length) { box.innerHTML = '<p class="vazio">Nenhum produto cadastrado.</p>'; atualizarResumo(); return; }
  const nomes = {};
  CATEGORIAS.forEach(function (c) { nomes[c[0]] = c[1]; });
  box.innerHTML = arr.map(function (p) {
    const imagem = p.imagem || '';
    const src = (imagem.startsWith('data:') || imagem.startsWith('http') || imagem.startsWith('./')) ? imagem : './' + imagem;
    return '<div class="item-produto">' +
      '<img src="' + esc(src) + '" alt="">' +
      '<div class="item-info">' +
        '<strong>' + esc(p.nome) + '</strong>' +
        (p.codigo ? '<span class="item-codigo">Código: ' + esc(p.codigo) + '</span>' : '') +
        '<span>' + esc(nomes[p.categoria] || p.categoria) + ' - R$' + Number(p.preco).toFixed(2).replace('.', ',') + '</span>' +
      '</div>' +
      '<div class="item-acoes">' +
        '<button type="button" class="btn-mini" onclick="editarProduto(' + Number(p.id) + ')">Editar</button>' +
        '<button type="button" class="btn-mini perigo" onclick="removerProduto(' + Number(p.id) + ')">Remover</button>' +
      '</div>' +
    '</div>';
  }).join('');
  atualizarResumo();
}

function renderizarListaFiltrada(lista) { renderizarLista(lista); }

function redimensionarImagem(arquivo) {
  return new Promise(function (resolve, reject) {
    const leitor = new FileReader();
    leitor.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        const escala = Math.min(1, 900 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * escala));
        canvas.height = Math.max(1, Math.round(img.height * escala));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    leitor.onerror = reject;
    leitor.readAsDataURL(arquivo);
  });
}

function mostrarPreview(src) {
  const img = document.getElementById('previewFoto');
  if (!img || !src) return;
  img.src = src;
  img.style.display = 'block';
}

async function aoEscolherFoto(input) {
  const arquivo = input.files && input.files[0];
  if (!arquivo) return;
  if (!arquivo.type.startsWith('image/')) { mensagem('Escolha um arquivo de imagem.', true); return; }
  try {
    const dados = await redimensionarImagem(arquivo);
    imagemEscolhida = dados;
    imagemAlterada = true;
    document.getElementById('urlFoto').value = '';
    mostrarPreview(dados);
  } catch (e) { mensagem('Nao foi possivel ler a imagem.', true); }
}

function aoDigitarUrl(valor) {
  const v = (valor || '').trim();
  if (v) { imagemEscolhida = v; imagemAlterada = true; mostrarPreview(v); }
}


function alternarCores() {
  const sec = document.getElementById('secaoCores');
  if (!sec) return;
  const abrir = sec.style.display === 'none';
  sec.style.display = abrir ? 'block' : 'none';
  const btn = document.getElementById('btnCores');
  if (btn) btn.textContent = abrir ? 'Fechar cores / modelos' : 'Cores / modelos (fotos diferentes)';
  if (abrir) renderizarVariacoes();
}
async function aoEscolherFotoVariacao(input) {
  const arquivo = input.files && input.files[0];
  if (!arquivo) return;
  if (!arquivo.type.startsWith('image/')) { mensagem('Escolha um arquivo de imagem.', true); return; }
  try {
    const dados = await redimensionarImagem(arquivo);
    fotoVariacaoEscolhida = dados;
    const url = document.getElementById('urlFotoVariacao');
    if (url) url.value = '';
    const prev = document.getElementById('previewFotoVariacao');
    if (prev) { prev.src = dados; prev.style.display = 'block'; }
  } catch (e) { mensagem('Nao foi possivel ler a imagem da cor.', true); }
}
function aoDigitarUrlVariacao(valor) {
  const v = (valor || '').trim();
  if (!v) return;
  fotoVariacaoEscolhida = v;
  const prev = document.getElementById('previewFotoVariacao');
  if (prev) { prev.src = v; prev.style.display = 'block'; }
}
function adicionarVariacao() {
  const campo = document.getElementById('corVariacao');
  const cor = campo ? (campo.value || '').trim() : '';
  if (!cor) { mensagem('Informe o nome da cor ou modelo.', true); return; }
  if (variacoesFormulario.some(function (v) { return String(v.cor || '').toLowerCase() === cor.toLowerCase(); })) {
    mensagem('Essa cor/modelo ja foi adicionada.', true); return;
  }
  const urlEl = document.getElementById('urlFotoVariacao');
  const imagem = fotoVariacaoEscolhida || (urlEl ? (urlEl.value || '').trim() : '') || imagemEscolhida || './Produtos_imagens/Vale Presente/vale presente.jfif';
  const estoqueEl = document.getElementById('estoqueVariacao');
  variacoesFormulario.push({ cor: cor, imagem: imagem, estoque: numeroEstoque(estoqueEl ? estoqueEl.value : 0) });
  renderizarVariacoes();
  if (campo) campo.value = '';
  if (urlEl) urlEl.value = '';
  const fileEl = document.getElementById('arquivoFotoVariacao');
  if (fileEl) fileEl.value = '';
  const prev = document.getElementById('previewFotoVariacao');
  if (prev) { prev.removeAttribute('src'); prev.style.display = 'none'; }
  if (estoqueEl) estoqueEl.value = '0';
  fotoVariacaoEscolhida = null;
  mensagem('Cor/modelo adicionado ao produto.');
}
function removerVariacao(indice) {
  variacoesFormulario.splice(indice, 1);
  renderizarVariacoes();
}
function alterarEstoqueVariacao(indice, valor) {
  if (!variacoesFormulario[indice]) return;
  variacoesFormulario[indice].estoque = numeroEstoque(valor);
  mensagem('Estoque da cor/modelo atualizado no produto.');
}
function renderizarVariacoes() {
  const box = document.getElementById('listaVariacoes');
  if (!box) return;
  if (!variacoesFormulario.length) {
    box.innerHTML = '<p class="dica">Nenhuma cor adicionada. Se nao adicionar, sera usada a cor e a foto principais.</p>';
    return;
  }
  box.innerHTML = variacoesFormulario.map(function (v, i) {
    return '<div class="item-simples variacao-item" style="display:flex;align-items:center;gap:10px;padding:8px;margin-top:8px;background:#fff;border-radius:10px;">' +
      '<img src="' + esc(v.imagem) + '" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;">' +
      '<span style="flex:1;min-width:0;font-size:13px;color:#49383D;">' + esc(v.cor) + '</span>' +
      '<label style="font-size:11px;color:#A65365;font-weight:600;">Estoque ' +
        '<input type="number" min="0" step="1" value="' + estoqueDaVariacao(v) + '" onchange="alterarEstoqueVariacao(' + i + ', this.value)" aria-label="Estoque de ' + esc(v.cor) + '" style="width:82px;padding:7px;border:1px solid rgba(166,83,101,0.25);border-radius:8px;font-size:13px;"></label>' +
      '<button type="button" class="btn-mini perigo" onclick="removerVariacao(' + i + ')">Remover</button>' +
      '</div>';
  }).join('');
}

async function salvarProduto(event) {
  if (event) event.preventDefault();
  const nome = (document.getElementById('nome').value || '').trim();
  const codigo = (document.getElementById('codigo') ? document.getElementById('codigo').value : '').trim();
  const descricao = (document.getElementById('descricao').value || '').trim();
  const preco = parseFloat((document.getElementById('preco').value || '').replace(',', '.'));
  let categoria = document.getElementById('categoria').value;
  const atualEdicao = editandoId !== null ? listaProdutos.find(function (p) { return p.id === editandoId; }) : null;
  if (!categoria && atualEdicao && atualEdicao.categoria) categoria = atualEdicao.categoria;
  if (!categoria) categoria = 'braceletes';
  const cor = (document.getElementById('cor').value || '').trim() || 'Modelo unico';
  const estoqueElSalvar = document.getElementById('estoqueProduto');
  const estoqueProduto = numeroEstoque(estoqueElSalvar ? estoqueElSalvar.value : 0);
  if (!nome) { mensagem('Informe o nome do produto.', true); return; }
  if (!isFinite(preco) || preco <= 0) { mensagem('Informe um preco valido.', true); return; }
  let imagem = imagemEscolhida;
  if (!imagemAlterada && editandoId !== null) {
    const antigo = listaProdutos.find(function (p) { return p.id === editandoId; });
    imagem = antigo ? antigo.imagem : '';
  }
  // Se nao escolheu foto, usa uma imagem padrao para nao travar o cadastro
  let usouPadrao = false;
  if (!imagem) {
    imagem = './Produtos_imagens/Vale Presente/vale presente.jfif';
    usouPadrao = true;
  }
  let variacoes;
  if (variacoesFormulario.length) {
    if (!imagemAlterada) {
      imagem = variacoesFormulario[0].imagem || imagem;
      usouPadrao = false;
    }
    variacoes = variacoesFormulario.map(function (v) {
      const out = { cor: v.cor, imagem: v.imagem, estoque: estoqueDaVariacao(v) };
      if (v.id) out.id = v.id;
      return out;
    });
  } else if (imagemAlterada || editandoId === null) {
    variacoes = [{ cor: cor, imagem: imagem, estoque: estoqueProduto }];
  } else {
    const antigo = listaProdutos.find(function (p) { return p.id === editandoId; });
    variacoes = (antigo && Array.isArray(antigo.variacoes) && antigo.variacoes.length) ? clonar(antigo.variacoes) : [{ cor: cor, imagem: imagem }];
  }
  const destaqueEl = document.getElementById('destaque');
  const novidadeEl = document.getElementById('novidade');
  const dados = { codigo: codigo || null, nome: nome, descricao: descricao, preco: preco, categoria: categoria, imagem: imagem, variacoes: variacoes, destaque: !!(destaqueEl && destaqueEl.checked), novidade: !!(novidadeEl && novidadeEl.checked) };
  if (editandoId !== null) {
    const atual = listaProdutos.find(function (p) { return p.id === editandoId; });
    if (atual) Object.assign(atual, dados);
  } else {
    const novoId = listaProdutos.reduce(function (m, p) { return Math.max(m, Number(p.id) || 0); }, 0) + 1;
    listaProdutos.push(Object.assign({ id: novoId }, dados));
  }
  try {
    if (editandoId !== null) {
      const r = await fetch('api/admin/produtos/' + editandoId, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
      const resp = await r.json().catch(function () { return {}; });
      if (erroAutenticacao(r)) return;
      if (!r.ok) { mensagem((resp && resp.erro) || 'Falha ao salvar produto.', true); return; }
      mensagem(usouPadrao ? 'Produto atualizado! (foto padrao)' : 'Produto atualizado!');
    } else {
      const r = await fetch('api/admin/produtos', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
      const resp = await r.json().catch(function () { return {}; });
      if (erroAutenticacao(r)) return;
      if (!r.ok) { mensagem((resp && resp.erro) || 'Falha ao salvar produto.', true); return; }
      mensagem(usouPadrao ? 'Produto adicionado! (foto padrao - adicione uma foto depois)' : 'Produto adicionado!');
    }
    await carregarListaServidor();
    if (typeof window.carregarEstoque === 'function') window.carregarEstoque();
    limparFormulario();
  } catch (e) {
    mensagem('Erro de conexao ao salvar produto.', true);
  }
}

function editarProduto(id) {
  const p = listaProdutos.find(function (x) { return x.id === id; });
  if (!p) return;
  editandoId = id;
  document.getElementById('nome').value = p.nome || '';
  if (document.getElementById('codigo')) document.getElementById('codigo').value = p.codigo || '';
  document.getElementById('descricao').value = p.descricao || '';
  document.getElementById('preco').value = Number(p.preco).toFixed(2);
  const selCat = document.getElementById('categoria');
  const catAtual = p.categoria || 'braceletes';
  if (selCat && !Array.from(selCat.options).some(function (o) { return o.value === catAtual; })) {
    const op = document.createElement('option');
    op.value = catAtual;
    op.textContent = catAtual;
    selCat.appendChild(op);
  }
  if (selCat) selCat.value = catAtual;
  variacoesFormulario = Array.isArray(p.variacoes) ? clonar(p.variacoes).map(function (v) {
    return { id: v.id, cor: v.cor || '', imagem: v.imagem || p.imagem || '', estoque: estoqueDaVariacao(v) };
  }) : [];
  renderizarVariacoes();
  const secaoCoresEdit = document.getElementById('secaoCores');
  if (secaoCoresEdit && variacoesFormulario.length) secaoCoresEdit.style.display = 'block';
  const btnCoresEdit = document.getElementById('btnCores');
  if (btnCoresEdit && variacoesFormulario.length) btnCoresEdit.textContent = 'Fechar cores / modelos';
  document.getElementById('cor').value = (p.variacoes && p.variacoes[0]) ? (p.variacoes[0].cor || '') : '';
  const estoqueEdit = document.getElementById('estoqueProduto');
  if (estoqueEdit) estoqueEdit.value = String(estoqueDaVariacao(p.variacoes && p.variacoes[0]));
  const destaqueEdit = document.getElementById('destaque');
  const novidadeEdit = document.getElementById('novidade');
  if (destaqueEdit) destaqueEdit.checked = !!p.destaque;
  if (novidadeEdit) novidadeEdit.checked = !!p.novidade;
  document.getElementById('urlFoto').value = (p.imagem || '').startsWith('http') ? p.imagem : '';
  document.getElementById('arquivoFoto').value = '';
  imagemEscolhida = p.imagem || null;
  imagemAlterada = false;
  mostrarPreview(p.imagem);
  document.getElementById('formTitulo').textContent = 'Editando: ' + p.nome;
  document.getElementById('btnSalvar').textContent = 'Salvar alteracoes';
  document.getElementById('formProduto').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function removerProduto(id) {
  const p = listaProdutos.find(function (x) { return x.id === id; });
  if (!p || !confirm('Arquivar "' + p.nome + '"? (pode ser restaurado depois)')) return;
  fetch('api/admin/produtos/' + id, { method: 'DELETE', credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.ok) {
        mensagem('Produto arquivado.');
        carregarListaServidor();
        if (editandoId === id) limparFormulario();
      } else {
        mensagem((d && d.erro) || 'Falha ao arquivar.', true);
      }
    })
    .catch(function () { mensagem('Falha ao arquivar.', true); });
}

function carregarListaServidor() {
  fetch('api/admin/produtos', { credentials: 'same-origin' })
    .then(function (r) { if (erroAutenticacao(r)) return []; return r.json(); })
    .then(function (arr) {
      if (Array.isArray(arr)) { listaProdutos = arr.map(function (p) {
        return { id: p.id, codigo: p.codigo, nome: p.nome, descricao: p.descricao, preco: p.preco, categoria: p.categoria, imagem: p.imagem, estoque: p.estoque, variacoes: p.variacoes, destaque: p.destaque, novidade: p.novidade, arquivado: p.arquivado };
      }); renderizarLista(); atualizarResumo(); }
    })
    .catch(function () {});
}

function limparFormulario() {
  const f = document.getElementById('formProduto');
  if (f) f.reset();
  if (document.getElementById('codigo')) document.getElementById('codigo').value = '';
  const destaqueClear = document.getElementById('destaque');
  const novidadeClear = document.getElementById('novidade');
  if (destaqueClear) destaqueClear.checked = false;
  if (novidadeClear) novidadeClear.checked = false;
  editandoId = null;
  const estoqueClear = document.getElementById('estoqueProduto');
  if (estoqueClear) estoqueClear.value = '0';
  imagemEscolhida = null;
  imagemAlterada = false;
  variacoesFormulario = [];
  fotoVariacaoEscolhida = null;
  renderizarVariacoes();
  const secaoCoresClear = document.getElementById('secaoCores');
  if (secaoCoresClear) secaoCoresClear.style.display = 'none';
  const btnCoresClear = document.getElementById('btnCores');
  if (btnCoresClear) btnCoresClear.textContent = 'Cores / modelos (fotos diferentes)';
  const prevVariacaoClear = document.getElementById('previewFotoVariacao');
  if (prevVariacaoClear) { prevVariacaoClear.removeAttribute('src'); prevVariacaoClear.style.display = 'none'; }
  const img = document.getElementById('previewFoto');
  if (img) { img.removeAttribute('src'); img.style.display = 'none'; }
  document.getElementById('formTitulo').textContent = 'Novo produto';
  document.getElementById('btnSalvar').textContent = 'Adicionar produto';
  popularCategorias();
}

function exportarJSON() {
  const dados = JSON.stringify(listaProdutos, null, 2);
  const url = URL.createObjectURL(new Blob([dados], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'produtos-tania.json';
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  mensagem('Arquivo baixado.');
}

function importarJSON(event) {
  const arquivo = event.target.files && event.target.files[0];
  if (!arquivo) return;
  const leitor = new FileReader();
  leitor.onload = function (e) {
    try {
      const arr = JSON.parse(e.target.result);
      if (!Array.isArray(arr)) throw new Error('formato');
      if (!confirm('Substituir todos os produtos pelos ' + arr.length + ' itens do arquivo?')) return;
      listaProdutos = arr;
      if (salvarLista()) { mensagem('Produtos importados!'); renderizarLista(); limparFormulario(); }
    } catch (err) { mensagem('Arquivo invalido.', true); }
    event.target.value = '';
  };
  leitor.readAsText(arquivo);
}

function restaurarOriginais() {
  if (!confirm('Restaurar a lista original de produtos? Suas alteracoes neste navegador serao perdidas.')) return;
  localStorage.removeItem(CHAVE_PRODUTOS);
  location.reload();
}

async function verificarAdmin() {
  try {
    const r = await fetch('api/auth/me', { credentials: 'same-origin' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d.usuario && d.usuario.role === 'admin');
  } catch (e) { return false; }
}

// Seguranca: se a sessao expirar enquanto o painel esta aberto, volta ao login.
setInterval(async function () {
  const painel = document.getElementById('painel');
  if (!painel || getComputedStyle(painel).display === 'none') return;
  await verificarSessaoAtiva();
}, 5000);

document.addEventListener('DOMContentLoaded', async function () {
  const campo = document.getElementById('senha');
  if (campo) campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
  const emailCampo = document.getElementById('emailAdmin');
  if (emailCampo) emailCampo.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
  if (await verificarAdmin()) mostrarPainel();
});

