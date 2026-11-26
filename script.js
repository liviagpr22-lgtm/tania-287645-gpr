const VERSAO_SCRIPT_ATUAL = 48;

// Abertura pelo arquivo (file://) nao consegue chamar a API. Avisa e usa o atalho.
if (!/^https?:$/.test(location.protocol)) {
  (function () {
    var pagina = (location.pathname.split('/').pop() || 'index.html') + location.search;
    var destino = 'http://localhost:8080/' + pagina;
    var indo = false;
    function aviso() {
      document.addEventListener('DOMContentLoaded', function () {
        var el = document.createElement('aside');
        el.id = 'avisoArquivo';
        el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(73,56,61,0.97);color:#fff;display:flex;align-items:center;justify-content:center;font-family:Montserrat,sans-serif;';
        el.innerHTML = '<div style="max-width:520px;text-align:center;padding:30px;line-height:1.6;">'
          + '<h2 style="font-size:22px;margin-bottom:14px;">Abra a loja pelo atalho</h2>'
          + '<p style="font-size:14px;margin-bottom:22px;">Abrindo o arquivo direto, o site não recebe estoque, categorias nem login atualizados. Use o atalho <strong>ABRIR LOJA</strong> na área de trabalho ou na pasta do projeto.</p>'
          + '<a href="' + destino + '" style="display:inline-block;background:#A65365;color:#fff;padding:14px 26px;border-radius:50px;font-weight:700;text-decoration:none;">Abrir loja atualizada</a>'
          + '</div>';
        document.body.appendChild(el);
        document.body.style.overflow = 'hidden';
      });
    }
    try {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 1800);
      fetch('http://localhost:8080/api/produtos?t=' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
        .then(function () { clearTimeout(timer); if (!indo) { indo = true; location.replace(destino); } })
        .catch(function () { clearTimeout(timer); if (!indo) aviso(); });
    } catch (e) { aviso(); }
  })();
}
function esc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// Regra unica: zero (ou invalido) = esgotado; maior que zero = disponivel.
function estoqueDisponivel(p) {
  const v = Number(p && p.estoque);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// Estoque é sempre por variação: cada cor/modelo tem sua própria quantidade.
function variacaoEstoque(v) {
  if (!v) return 0;
  const bruta = v.estoque !== undefined ? v.estoque : v.disponivel;
  const qtd = Number(bruta);
  return Number.isFinite(qtd) && qtd > 0 ? Math.floor(qtd) : 0;
}
function statusEstoqueHtml(qtd) {
  return qtd > 0
    ? '<span class="status-variacao disponivel">Disponível: ' + qtd + '</span>'
    : '<span class="status-variacao esgotado">ESGOTADO</span>';
}
// Configuração
const WHATSAPP_NUMERO = '+5512981883097';
const WHATSAPP_LINK = 'https://wa.me/' + WHATSAPP_NUMERO;
const DESTAQUES_IDS = [1, 2, 3, 7, 14, 77, 9, 12];
const NOVIDADES_IDS = [77, 1, 2, 7, 14];

// Produtos baseados no catálogo real (imagens da pasta Produtos_imagens)
let produtos = [];

// Produtos editados no painel administrativo (salvos neste navegador)
function aplicarProdutos(arr) {
  if (!Array.isArray(arr) || !arr.length) return;
  produtos = arr;
  DESTAQUES_IDS.length = 0;
  NOVIDADES_IDS.length = 0;
  arr.forEach(function (p) {
    if (p.destaque) DESTAQUES_IDS.push(p.id);
    if (p.novidade) NOVIDADES_IDS.push(p.id);
  });
}

// Sincroniza com o servidor (mesma lista em todos os dispositivos)
function aplicarSnapshot() {
  try {
    if (Array.isArray(window.categoriasSnapshot) && window.categoriasSnapshot.length) categoriasLista = window.categoriasSnapshot;
    if (Array.isArray(window.produtosSnapshot) && window.produtosSnapshot.length) { aplicarProdutos(window.produtosSnapshot); return true; }
  } catch (e) {}
  return false;
}
function carregarCategoriasDoServidor() {
  return fetch('api/categorias?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('falha'); return r.json(); })
    .then(function (arr) { if (Array.isArray(arr)) categoriasLista = arr; })
    .catch(function () { aplicarSnapshot(); });
}
function carregarProdutosDoServidor() {
  return Promise.all([carregarCategoriasDoServidor(), fetch('api/produtos?t=' + Date.now(), { cache: 'no-store' })])
    .then(function (results) {
      const r = results[1];
      if (!r.ok) throw new Error('falha');
      return r.json();
    })
    .then(function (arr) {
      if (Array.isArray(arr) && arr.length) {
        aplicarProdutos(arr);
        try { localStorage.setItem('tania_produtos', JSON.stringify(arr)); } catch (e) {}
      }
    })
    .catch(function () {
      // Nunca mostra estoque/categorias obsoletos salvos no navegador.
      try { localStorage.removeItem('tania_produtos'); } catch (e) {}
      aplicarSnapshot();
    });
}

// Carrega do servidor antes de renderizar a pagina
window.produtosPromise = carregarProdutosDoServidor();
let _initOriginal = init;
init = function () {
  window.produtosPromise.then(function () { _initOriginal(); });
};

// Carrinho
function getCarrinho() {
  try {
    // Carrinho temporario: some quando a aba/navegador e fechada
    const antigo = localStorage.getItem('tania_carrinho');
    if (antigo) localStorage.removeItem('tania_carrinho');
    return JSON.parse(sessionStorage.getItem('tania_carrinho')) || [];
  } catch(e) { return []; }
}
function setCarrinho(c) { sessionStorage.setItem('tania_carrinho', JSON.stringify(c)); atualizarContador(); renderizarCarrinho(); }
function atualizarContador() { const c = getCarrinho(); const total = c.reduce((s, item) => s + item.qtd, 0); const contador = document.getElementById('cartCount'); if (contador) contador.textContent = total; }
function mostrarToast(mensagem) {
  let toast = document.getElementById('toastCarrinho');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastCarrinho';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = mensagem;
  toast.classList.add('mostrar');
  clearTimeout(window.toastCarrinhoTimeout);
  window.toastCarrinhoTimeout = setTimeout(() => toast.classList.remove('mostrar'), 2400);
}

function estoqueDoItem(item) {
  const prod = produtos.find(p => p.id === item.id);
  if (!prod || !prod.variacoes) return Infinity;
  const v = prod.variacoes.find(x => x.cor === item.cor) || prod.variacoes[0];
  return (v && typeof v.estoque === 'number') ? estoqueDisponivel(v) : Infinity;
}
function aumentarQtd(chave) { const c = getCarrinho(); const item = c.find(i => i.chave === chave); if (item) { if (item.qtd + 1 > estoqueDoItem(item)) { mostrarToast('Quantidade maxima em estoque atingida'); return; } item.qtd += 1; setCarrinho(c); } }
function diminuirQtd(chave) { const c = getCarrinho(); const idx = c.findIndex(i => i.chave === chave); if (idx > -1) { if (c[idx].qtd > 1) c[idx].qtd -= 1; else c.splice(idx, 1); setCarrinho(c); } }
function removerItem(chave) { const c = getCarrinho(); const idx = c.findIndex(i => i.chave === chave); if (idx > -1) { c.splice(idx, 1); setCarrinho(c); } }

// Renderização
function renderizarProdutos(lista) {
  const grid = document.getElementById('produtosGrid');
  if (!grid) return;
  const ehNovidades = /novidades\.html/i.test(location.pathname || '');
  grid.innerHTML = lista.map(p => `
    <article class="card-produto" data-categoria="${p.categoria}" data-id="${p.id}">
      ${ehNovidades ? '<span class="selo-novidade" aria-label="Novidade">Novidade</span>' : ''}
      <button type="button" class="card-media" onclick="abrirDetalhe(${p.id})" aria-label="Ver ${p.nome}">
        <img src="${p.imagem}" alt="${p.nome}" loading="lazy">
      </button>
      <div class="card-body">
        ${p.codigo ? '<div style="font-size:11px;color:#A65365;opacity:0.8;margin-bottom:4px;">Cod: ' + p.codigo + '</div>' : ''}
        <h3>${p.nome}</h3>
        <span class="preco">R$${p.preco.toFixed(2).replace('.',',')}</span>
        <div style="font-size:12px;margin-bottom:6px;color:${estoqueDisponivel(p)>0?'#2a7a3a':'#A65365'};font-weight:600;">${estoqueDisponivel(p)>0?'Disponível: '+estoqueDisponivel(p):'ESGOTADO'}</div>
        ${estoqueDisponivel(p) > 0
          ? '<button class="btn-carrinho" onclick="adicionarCarrinhoRapido(' + p.id + '); event.stopPropagation();" aria-label="Adicionar ao carrinho" title="Adicionar ao carrinho"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg></button>'
          : '<button onclick="solicitarEspera(' + p.id + '); event.stopPropagation();" aria-label="Solicitar produto esgotado" title="Solicitar" style="background:#fff;color:#A65365;border:2px solid #A65365;padding:8px 16px;border-radius:50px;font-size:12px;font-weight:700;cursor:pointer;">Solicitar</button>'}
      </div>
    </article>
  `).join('');
}

async function adicionarCarrinhoRapido(id) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) { abrirAuth('carrinho', { id: id, variacao: null }); return; }
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  const v = (p.variacoes || []).find(function (x) { return variacaoEstoque(x) > 0; }) ||
            (p.variacoes && p.variacoes[0]) || null;
  adicionarCarrinho(p.id, v);
}

async function abrirDetalhe(id) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) { abrirAuth('detalhe', { id: id }); return; }
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  const vars = Array.isArray(p.variacoes) && p.variacoes.length
    ? p.variacoes
    : [{ cor: 'Modelo único', imagem: p.imagem, estoque: estoqueDisponivel(p) }];
  const anterior = window.variacaoAtual;
  let vInicial = vars.find(function (v) { return anterior && v.id === anterior.id; }) ||
                 vars.find(function (v) { return variacaoEstoque(v) > 0; }) || vars[0];
  window.variacaoAtual = vInicial;
  const qtdInicial = variacaoEstoque(vInicial);
  const htmlVariacoes = vars.map(function (v, i) {
    const qtd = variacaoEstoque(v);
    const nome = String(v.cor || 'Modelo único');
    const selecionada = v === vInicial ? ' selecionada' : '';
    return '<button type="button" class="variacao-opcao' + selecionada + (qtd > 0 ? '' : ' esgotada') + '" ' +
      'onclick="selecionarVariacao(' + p.id + ', ' + i + ', this)" aria-label="' + nome.replace(/"/g, '&quot;') + '">' +
      '<img src="' + (v.imagem || p.imagem) + '" alt="' + nome.replace(/"/g, '&quot;') + '" loading="lazy">' +
      '<span class="variacao-nome">' + nome + '</span>' +
      statusEstoqueHtml(qtd) +
      '</button>';
  }).join('');
  const painelEl = document.createElement('section');
  painelEl.id = 'detalhe-panel';
  painelEl.setAttribute('aria-label', 'Detalhes do produto');
  painelEl.style.cssText = 'position:fixed;inset:0;background:rgba(73,56,61,0.35);z-index:250;display:flex;align-items:center;justify-content:center;';
  painelEl.innerHTML = `<div class="detalhe-inner">
    <button onclick="fecharDetalhe()" class="detalhe-fechar" aria-label="Fechar">&#10005;</button>
    <div class="detalhe-grid">
      <img id="imgDetalhe" src="${vInicial.imagem || p.imagem}" alt="${p.nome}" loading="lazy">
      <div>
        <h2>${p.nome}</h2>
        ${p.codigo ? '<div class="detalhe-codigo">Código: ' + p.codigo + '</div>' : ''}
        ${p.categoria ? '<div class="detalhe-categoria">Categoria: ' + nomeCategoria(p.categoria) + '</div>' : ''}
        <p class="detalhe-descricao"><strong>Descrição:</strong> ${p.descricao || 'Sem descrição.'}</p>
        <div id="estoqueVariacao" class="estoque-detalhe">${statusEstoqueHtml(qtdInicial)}<span class="estoque-obs">${qtdInicial > 0 ? '— pronta para envio' : '— avise-me quando chegar'}</span></div>
        <p class="detalhe-preco">R$${p.preco.toFixed(2).replace('.', ',')}</p>
        <div class="variacoes-box">
          <strong>Cor / Modelo</strong>
          <div class="variacoes-lista">${htmlVariacoes}</div>
        </div>
        <div class="detalhe-acoes">
          <button type="button" id="btnAcaoDetalhe" class="btn-detalhe" onclick="acaoDetalhe(${p.id})">${qtdInicial > 0 ? 'Adicionar ao carrinho' : 'Solicitar (lista de espera)'}</button>
          <span id="msgVariacao"></span>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(painelEl);
  document.body.style.overflow = 'hidden';
}

function acaoDetalhe(id) {
  const p = produtos.find(x => x.id === id);
  const v = window.variacaoAtual || (p && p.variacoes && p.variacoes[0]);
  if (v && variacaoEstoque(v) <= 0) { solicitarEspera(id); return; }
  adicionarCarrinho(id, v || null);
}

function selecionarVariacao(id, indice, botao) {
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  const vars = Array.isArray(p.variacoes) && p.variacoes.length ? p.variacoes : [];
  const v = vars[indice];
  if (!v) return;
  window.variacaoAtual = v;
  const img = document.getElementById('imgDetalhe');
  if (img) img.src = v.imagem || p.imagem;
  const qtd = variacaoEstoque(v);
  const status = document.getElementById('estoqueVariacao');
  if (status) status.innerHTML = statusEstoqueHtml(qtd) +
    '<span class="estoque-obs">' + (qtd > 0 ? '— pronta para envio' : '— avise-me quando chegar') + '</span>';
  const btn = document.getElementById('btnAcaoDetalhe');
  if (btn) btn.textContent = qtd > 0 ? 'Adicionar ao carrinho' : 'Solicitar (lista de espera)';
  const msg = document.getElementById('msgVariacao');
  if (msg) msg.textContent = 'Selecionado: ' + (v.cor || 'Modelo único');
  document.querySelectorAll('#detalhe-panel .variacao-opcao').forEach(function (b) { b.classList.remove('selecionada'); });
  if (botao) botao.classList.add('selecionada');
}

// Renderização do carrinho
function renderizarCarrinho() {
  const c = getCarrinho();
  const lista = document.getElementById('carrinhoLista');
  if (!lista) return;
  if (c.length === 0) { lista.innerHTML = '<p style="color:#49383D;opacity:0.7;padding:20px 0;">Seu carrinho está vazio.</p>'; document.getElementById('subtotal').textContent = 'R$0,00'; document.getElementById('total').textContent = 'R$0,00'; return; }
  lista.innerHTML = c.map(item => {
    const prod = produtos.find(p => p.id === item.id);
    return `<div class="carrinho-item">
      <img src="${item.imagem}" alt="${item.nome}">
      <div class="info">
        <h4>${esc(item.nome)}</h4>
        ${item.cor ? `<div class="var">${esc(item.cor)}</div>` : ''}
        ${item.observacao ? `<div class="obs">Obs: ${esc(item.observacao)}</div>` : ''}
        <span class="preco">R$${item.preco.toFixed(2).replace('.',',')}</span>
        <div class="qtd">
          <button onclick="diminuirQtd('${item.chave}')" aria-label="Diminuir quantidade">-</button>
          <span style="font-weight:600;color:#49383D;min-width:24px;text-align:center;">${item.qtd}</span>
          <button onclick="aumentarQtd('${item.chave}')" aria-label="Aumentar quantidade">+</button>
        </div>
        <button onclick="removerItem('${item.chave}')" style="margin-top:6px;background:none;border:none;color:#A65365;font-size:12px;font-weight:600;cursor:pointer;">Remover</button>
      </div>
    </div>`;
  }).join('');
  const t = totaisCarrinho(c);
  document.getElementById('subtotal').textContent = 'R$' + t.subtotal.toFixed(2).replace('.',',');
  document.getElementById('total').textContent = 'R$' + t.total.toFixed(2).replace('.',',');
  if (t.desconto > 0) {
    lista.innerHTML += '<div style="font-size:13px;color:#2a7a3a;font-weight:600;padding:8px 0;">Cupom ' +
      esc(cupomAplicado.codigo) + ': -R$' + t.desconto.toFixed(2).replace('.',',') + '</div>';
  }
}

// Carrinho painel
function abrirCarrinho() { document.getElementById('carrinho').hidden = false; renderizarCarrinho(); document.body.style.overflow = 'hidden'; }
function fecharCarrinho() { document.getElementById('carrinho').hidden = true; document.body.style.overflow = ''; }

// Busca
function openBusca() {
  const p = document.getElementById('busca');
  if (p) { p.hidden = false; document.body.style.overflow = 'hidden'; }
  if (typeof popularCategoriasBusca === 'function') popularCategoriasBusca();
  const c = document.getElementById('buscaNome');
  if (c) { c.value = ''; c.focus(); }
  const r = document.getElementById('resultadosBusca');
  if (r) r.innerHTML = '';
  const contador = document.getElementById('buscaContador');
  if (contador) contador.textContent = '';
}
function fecharBusca() {
  const p = document.getElementById('busca');
  if (p) p.hidden = true;
  document.body.style.overflow = '';
  ['buscaCategoria', 'buscaCodigo', 'buscaNome'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const r = document.getElementById('resultadosBusca');
  if (r) r.innerHTML = '';
}

function normalizarTexto(v) { return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function normalizarCodigo(v) { return normalizarTexto(v).replace(/\s+/g, ''); }

async function executarBusca() {
  if (typeof sincronizarCatalogo === 'function') {
    try {
      await Promise.race([sincronizarCatalogo(true), new Promise(function (r) { setTimeout(r, 1500); })]);
    } catch (e) {}
  }
  const catSel = document.getElementById('buscaCategoria');
  const codInput = document.getElementById('buscaCodigo');
  const nomeInput = document.getElementById('buscaNome');
  const catVal = catSel ? catSel.value : '';
  const codTermo = normalizarCodigo(codInput ? codInput.value : '');
  const nomeTermo = normalizarTexto(nomeInput ? nomeInput.value : '');
  const descCat = catVal ? slugsDescendentes(catVal) : [];

  const resultados = produtos.filter(function (p) {
    let ok = true;
    if (catVal) {
      ok = ok && descCat.indexOf(p.categoria) !== -1;
    }
    if (codTermo) {
      ok = ok && normalizarTexto(p.codigo) === codTermo;
    }
    if (nomeTermo) {
      const nome = normalizarTexto(p.nome);
      const desc = normalizarTexto(p.descricao);
      const varOk = p.variacoes && p.variacoes.some(function (v) { return normalizarTexto(v.cor).includes(nomeTermo); });
      ok = ok && (nome.includes(nomeTermo) || desc.includes(nomeTermo) || varOk);
    }
    return ok;
  });

  const div = document.getElementById('resultadosBusca');
  if (!div) return;
  const contador = document.getElementById('buscaContador');
  if (contador) contador.textContent = '';
  const algumFiltro = catVal || codTermo || nomeTermo;
  if (!algumFiltro) {
    div.innerHTML = '<div class="busca-vazio"><span aria-hidden="true">&#9829;</span><p>Informe um nome, código ou categoria para encontrar sua peça.</p></div>';
    return;
  }
  if (resultados.length === 0) {
    div.innerHTML = '<div class="busca-vazio"><span aria-hidden="true">&#10047;</span><p>Nenhum produto encontrado. Tente outro termo ou limpe os filtros.</p></div>';
    return;
  }
  if (contador) contador.textContent = resultados.length + (resultados.length === 1 ? ' peça encontrada' : ' peças encontradas');
  div.innerHTML = resultados.map(function (p) {
    const disponivel = estoqueDisponivel(p) > 0;
    return '<a href="#" onclick="abrirDetalhe(' + p.id + '); fecharBusca(); return false;" class="resultado-busca">' +
      '<span class="resultado-foto"><img src="' + p.imagem + '" alt="' + p.nome + '" loading="lazy"></span>' +
      '<span class="resultado-info"><strong>' + p.nome + '</strong>' +
        '<small>Código: ' + (p.codigo || '—') + ' · ' + (p.categoria ? nomeCategoria(p.categoria) : 'Tania Briet') + '</small>' +
        '<span class="resultado-status ' + (disponivel ? 'ok' : 'off') + '">' + (disponivel ? 'Disponível' : 'ESGOTADO') + '</span>' +
      '</span>' +
      '<span class="preco">R$' + p.preco.toFixed(2).replace('.', ',') + '</span>' +
      '</a>';
  }).join('');
}

// Dados do pedido

const OPCOES_PAGAMENTO = ['PIX', 'Cartão', 'Dinheiro', 'Outro'];
let dadosPedido = { nome: '', pagamento: 'PIX' };
let cupomAplicado = null;
let janelaWhatsPendente = null;
function totaisCarrinho(c) {
  const itens = c || getCarrinho();
  const subtotal = itens.reduce(function (s, i) { return s + i.preco * i.qtd; }, 0);
  const desconto = cupomAplicado ? Math.min(Number(cupomAplicado.valor) || 0, subtotal) : 0;
  return { subtotal: subtotal, desconto: desconto, total: Math.max(0, subtotal - desconto) };
}

// WhatsApp
function enviarWhatsApp(carrinho, janela) {
  const c = carrinho || getCarrinho();
  if (c.length === 0) { alert('Seu carrinho está vazio.'); return; }
  let msg = 'Olá! Gostaria de fazer um pedido:\n\n';
  let total = 0;
  c.forEach((item, idx) => {
    const prod = produtos.find(x => x.id === item.id);
    const descricao = prod ? prod.descricao : '';
    if (item.observacao) msg += '   Observação: ' + item.observacao + String.fromCharCode(10);
    if (descricao) msg += '   Descrição: ' + descricao + String.fromCharCode(10);
    const subtotalItem = item.preco * item.qtd;
    total += subtotalItem;
    msg += `${idx + 1}. ${item.nome}\n`;
    if (item.cor) msg += `   Cor/Modelo: ${item.cor}\n`;
    msg += `   Quantidade: ${item.qtd}\n`;
    msg += `   Valor unitário: R$${item.preco.toFixed(2).replace('.',',')}\n`;
    msg += `   Subtotal: R$${subtotalItem.toFixed(2).replace('.',',')}\n\n`;
  });
  msg += `Total dos produtos: R$${total.toFixed(2).replace('.',',')}\n`;
  if (cupomAplicado) {
    const desc = Math.min(Number(cupomAplicado.valor) || 0, total);
    msg += 'Cupom ' + cupomAplicado.codigo + ': -R$' + desc.toFixed(2).replace('.',',') + String.fromCharCode(10);
    msg += 'Total com desconto: R$' + (total - desc).toFixed(2).replace('.',',') + String.fromCharCode(10);
  }
  msg += String.fromCharCode(10);
  const cli = window.usuarioAtual || {};
  msg += 'Nome: ' + (dadosPedido.nome || cli.nome || '-') + String.fromCharCode(10);
  if (cli.telefone) msg += 'Telefone: ' + cli.telefone + String.fromCharCode(10);
  if (cli.email) msg += 'E-mail: ' + cli.email + String.fromCharCode(10);
  msg += 'Forma de pagamento escolhida: ' + dadosPedido.pagamento + String.fromCharCode(10) + String.fromCharCode(10);
  msg += `Gostaria de confirmar a disponibilidade e combinar a entrega ou retirada. Obrigada!`;
  const url = WHATSAPP_LINK + '?text=' + encodeURIComponent(msg);
  if (janela && !janela.closed) {
    try { janela.location.href = url; janela.focus(); }
    catch (e) { window.open(url, '_blank'); }
  } else {
    const aberta = window.open(url, '_blank');
    if (!aberta) window.location.href = url;
  }
}

// Modal de dados do pedido
function abrirModalPedido() {
  const c = getCarrinho();
  if (c.length === 0) { alert('Seu carrinho está vazio.'); return; }
  let painel = document.getElementById('pedido-panel');
  if (painel) painel.remove();
  const painelEl = document.createElement('section');
  painelEl.id = 'pedido-panel';
  painelEl.setAttribute('aria-label', 'Dados do pedido');
  painelEl.style.cssText = 'position:fixed;inset:0;background:rgba(73,56,61,0.35);z-index:300;display:flex;align-items:center;justify-content:center;';
  painelEl.innerHTML = `<div style="background:#FFFCFA;width:92%;max-width:460px;padding:28px;border-radius:24px;box-shadow:0 20px 60px rgba(166,83,101,0.2);position:relative;">
    <button onclick="fecharPedido()" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:22px;color:#49383D;cursor:pointer;" aria-label="Fechar">&#10005;</button>
    <h2 style="font-family:'Montserrat',sans-serif;font-size:24px;color:#49383D;margin-bottom:20px;">Dados do Pedido</h2>
    <p style="font-size:13px;color:#49383D;opacity:0.8;margin-bottom:18px;line-height:1.5;">Seus dados de cadastro serão usados no pedido.</p>
    <div style="margin-bottom:20px;">
      <span style="display:block;font-size:13px;font-weight:600;color:#49383D;margin-bottom:8px;">Você tem um cupom?</span>
      <div style="display:flex;gap:8px;">
        <button type="button" id="btnCupomSim" onclick="responderCupom(true)" style="flex:1;padding:10px;border-radius:50px;border:2px solid rgba(166,83,101,0.25);background:#fff;color:#49383D;font-weight:700;cursor:pointer;">Sim</button>
        <button type="button" id="btnCupomNao" onclick="responderCupom(false)" style="flex:1;padding:10px;border-radius:50px;border:2px solid rgba(166,83,101,0.25);background:#fff;color:#49383D;font-weight:700;cursor:pointer;">Não</button>
      </div>
      <div id="areaCupom" style="display:none;margin-top:10px;">
        <input id="campoCupom" type="text" placeholder="Digite o código do cupom" style="width:100%;padding:12px 14px;border:1px solid rgba(166,83,101,0.2);border-radius:12px;font-size:15px;box-sizing:border-box;margin-bottom:8px;text-transform:uppercase;">
        <button type="button" onclick="aplicarCupom()" style="background:#49383D;color:#fff;border:none;padding:10px 20px;border-radius:50px;font-weight:700;cursor:pointer;">Aplicar cupom</button>
      </div>
      <div id="msgCupomPedido" class="mensagem" style="display:none;position:static;transform:none;margin-top:8px;"></div>
      <div id="resumoCupom" style="font-size:13px;color:#2a7a3a;font-weight:600;margin-top:6px;"></div>
    </div>
    <span style="display:block;font-size:13px;font-weight:600;color:#49383D;margin-bottom:10px;">Forma de pagamento</span>
    <div id="opcoesPagamento" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;">
      ${OPCOES_PAGAMENTO.map((m) => `<button type="button" class="pag-btn" data-metodo="${m}" onclick="selecionarPagamento('${m}')" style="padding:10px 18px;border-radius:50px;border:2px solid rgba(166,83,101,0.2);background:#fff;color:#49383D;font-weight:600;font-size:14px;cursor:pointer;">${m}</button>`).join('')}
    </div>
    <div id="campoPagamentoOutro" style="display:none;margin-bottom:20px;">
      <input type="text" id="campoPagamentoOutroValor" placeholder="Digite a forma de pagamento" style="width:100%;padding:12px 14px;border:1px solid rgba(166,83,101,0.2);border-radius:12px;font-size:15px;font-family:var(--fonte-texto);color:#49383D;box-sizing:border-box;" />
    </div>
    <button onclick="confirmarPedido()" style="width:100%;background:linear-gradient(135deg,#D78B98,#A65365);color:#fff;border:none;padding:14px;border-radius:50px;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 6px 18px rgba(166,83,101,0.25);">Confirmar e enviar no WhatsApp</button>
  </div>`;
  document.body.appendChild(painelEl);
  document.body.style.overflow = 'hidden';
}

function fecharPedido() { const el = document.getElementById('pedido-panel'); if (el) el.remove(); document.body.style.overflow = ''; }

function selecionarPagamento(metodo) {
  dadosPedido.pagamento = metodo;
  document.querySelectorAll('#pedido-panel .pag-btn').forEach((b) => {
    const ativo = b.getAttribute('data-metodo') === metodo;
    b.style.borderColor = ativo ? '#A65365' : 'rgba(166,83,101,0.2)';
    b.style.background = ativo ? '#FBEAEC' : '#fff';
    b.style.color = ativo ? '#A65365' : '#49383D';
  });
  const campoOutro = document.getElementById('campoPagamentoOutro');
  const valorOutro = document.getElementById('campoPagamentoOutroValor');
  if (campoOutro) campoOutro.style.display = metodo === 'Outro' ? 'block' : 'none';
  if (valorOutro && metodo === 'Outro') dadosPedido.pagamento = valorOutro.value.trim() || 'Outro';
}

function responderCupom(tem) {
  const area = document.getElementById('areaCupom');
  if (area) area.style.display = tem ? 'block' : 'none';
  const sim = document.getElementById('btnCupomSim');
  const nao = document.getElementById('btnCupomNao');
  if (sim) { sim.style.background = tem ? '#A65365' : '#fff'; sim.style.color = tem ? '#fff' : '#49383D'; }
  if (nao) { nao.style.background = tem ? '#fff' : '#A65365'; nao.style.color = tem ? '#49383D' : '#fff'; }
  if (!tem) {
    cupomAplicado = null;
    const campo = document.getElementById('campoCupom');
    if (campo) campo.value = '';
    const msg = document.getElementById('msgCupomPedido');
    if (msg) msg.style.display = 'none';
    const resumo = document.getElementById('resumoCupom');
    if (resumo) resumo.textContent = '';
    renderizarCarrinho();
  }
}
function atualizarResumoCupom() {
  const resumo = document.getElementById('resumoCupom');
  if (!resumo) return;
  if (!cupomAplicado) { resumo.textContent = ''; return; }
  const t = totaisCarrinho();
  resumo.textContent = 'Desconto: -R$' + t.desconto.toFixed(2).replace('.',',') + ' · Total com desconto: R$' + t.total.toFixed(2).replace('.',',');
}
async function aplicarCupom() {
  const campo = document.getElementById('campoCupom');
  const msg = document.getElementById('msgCupomPedido');
  const codigo = campo ? (campo.value || '').trim() : '';
  if (msg) msg.style.display = 'none';
  if (!codigo) {
    if (msg) { msg.textContent = 'Digite o código do cupom.'; msg.className = 'mensagem erro'; msg.style.display = 'block'; }
    return;
  }
  try {
    const r = await fetch('api/cupons/validar', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: codigo })
    });
    const d = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      if (msg) { msg.textContent = d.erro || 'Cupom inválido.'; msg.className = 'mensagem erro'; msg.style.display = 'block'; }
      return;
    }
    cupomAplicado = { codigo: d.codigo, nome: d.nome, valor: Number(d.valor) || 0 };
    if (campo) campo.value = d.codigo;
    if (msg) { msg.textContent = 'Cupom aplicado: ' + d.nome; msg.className = 'mensagem'; msg.style.display = 'block'; }
    atualizarResumoCupom();
    renderizarCarrinho();
  } catch (e) {
    if (msg) { msg.textContent = 'Erro de conexao.'; msg.className = 'mensagem erro'; msg.style.display = 'block'; }
  }
}
function observacaoPedido() {
  const partes = [];
  if (dadosPedido.pagamento) partes.push('Forma de pagamento: ' + dadosPedido.pagamento);
  if (cupomAplicado) partes.push('Cupom ' + cupomAplicado.codigo + ' (-R$' + Number(cupomAplicado.valor).toFixed(2).replace('.',',') + ')');
  return partes.length ? partes.join(' | ') : null;
}
function varianteIdDoItem(item) {
  const prod = produtos.find(x => x.id === item.id);
  if (!prod || !prod.variacoes) return null;
  const v = prod.variacoes.find(x => x.cor === item.cor) || prod.variacoes[0];
  return v ? v.id : null;
}

async function confirmarPedido() {
  if (window.usuarioAtual && window.usuarioAtual.nome) dadosPedido.nome = window.usuarioAtual.nome;
  // Abre a janela no gesto do clique e reaproveita se o login interrompeu o pedido.
  let janelaWhats = (janelaWhatsPendente && !janelaWhatsPendente.closed) ? janelaWhatsPendente : null;
  if (!janelaWhats) {
    try { janelaWhats = window.open('about:blank', '_blank'); } catch (e) { janelaWhats = null; }
  }
  janelaWhatsPendente = janelaWhats;
  const campoOutro = document.getElementById('campoPagamentoOutro');
  if (campoOutro && campoOutro.style.display !== 'none') {
    const valorOutro = document.getElementById('campoPagamentoOutroValor');
    const valor = valorOutro ? (valorOutro.value || '').trim() : '';
    if (valor) dadosPedido.pagamento = valor;
  }

  // Exige conta logada para criar pedido persistente
  const usuario = await obterUsuarioAtual();
  if (!usuario) {
    abrirAuth('pedido');
    return;
  }
  dadosPedido.nome = usuario.nome || dadosPedido.nome || '';

  const c = getCarrinho();
  const itens = c.map(function (item) {
    return {
      product_id: item.id,
      variant_id: varianteIdDoItem(item),
      quantidade: item.qtd,
      observacao: item.observacao || null
    };
  }).filter(function (x) { return x.variant_id; });

  if (!itens.length) { alert('Nenhum item valido no carrinho.'); return; }

  try {
    const r = await fetch('api/pedidos', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itens: itens, observacao_geral: observacaoPedido(), idempotency_key: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) })
    });
    const d = await r.json();
    if (!r.ok) {
      if (janelaWhats && !janelaWhats.closed) janelaWhats.close();
      janelaWhatsPendente = null;
      alert(d.erro || 'Falha ao criar pedido');
      return;
    }
    fecharPedido();
    mostrarToast('Pedido criado: ' + d.codigo);
    // abre WhatsApp antes de limpar o carrinho
    enviarWhatsApp(c.slice(), janelaWhats);
    // limpa carrinho
    cupomAplicado = null;
    sessionStorage.removeItem('tania_carrinho');
    atualizarContador();
    renderizarCarrinho();
    // redireciona para conta
    janelaWhatsPendente = null;
    if (janelaWhats && !janelaWhats.closed) setTimeout(function () { window.location.href = 'conta.html'; }, 1200);
  } catch (e) {
    if (janelaWhats && !janelaWhats.closed) janelaWhats.close();
    janelaWhatsPendente = null;
    alert('Erro de conexao ao criar pedido.');
  }
}

function atualizarMenuAtivo() {
  const caminho = window.location.pathname.toLowerCase();
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href') || '';
    const ativo = href !== '#' && (caminho.endsWith(href) || (href === 'index.html' && (caminho === '/' || caminho.endsWith('/index.html'))));
    link.classList.toggle('active', ativo);
    if (ativo) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

let categoriaRolada = null;
function rolarParaProdutosDaCategoria(categoria) {
  if (!categoria || categoriaRolada === categoria) return;
  categoriaRolada = categoria;
  const alvo = document.getElementById('produtosCategoria');
  if (!alvo) return;
  requestAnimationFrame(function () {
    setTimeout(function () {
      alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  });
}

// Inicialização
function init() {
  atualizarMenuAtivo();
  const grid = document.getElementById('produtosGrid');
  if (grid) {
    const caminho = window.location.pathname.toLowerCase();
    if (caminho.includes('novidades.html')) {
      renderizarProdutos(produtos.filter(p => NOVIDADES_IDS.includes(p.id)));
    } else if (caminho.includes('categorias.html')) {
      const categoria = new URLSearchParams(window.location.search).get('categoria');
      const titulo = document.getElementById('categoriaTitulo');
      if (categoria) {
        const permitidas = slugsDescendentes(categoria);
        const lista = produtos.filter(p => permitidas.indexOf(p.categoria) !== -1);
        renderizarProdutos(lista);
        if (titulo) titulo.textContent = 'Categoria: ' + nomeCategoria(categoria);
        rolarParaProdutosDaCategoria(categoria);
      } else {
        renderizarProdutos(produtos);
      }
    } else {
      // Tela inicial mostra todos os produtos cadastrados (destaques primeiro),
      // inclusive os adicionados agora pelo painel.
      const ordenados = produtos.slice().sort(function (a, b) {
        const da = DESTAQUES_IDS.indexOf(a.id) === -1 ? 1 : 0;
        const db = DESTAQUES_IDS.indexOf(b.id) === -1 ? 1 : 0;
        return da - db || (Number(a.id) - Number(b.id));
      });
      renderizarProdutos(ordenados);
    }
  }
  atualizarContador();
  renderizarCarrinho();
}

// Adicionar carrinho rápido com variação selecionada (se houver)
let itemPendente = null;

function abrirModalObservacao(item) {
  let existente = document.getElementById('observacao-panel');
  if (existente) existente.remove();
  const painelEl = document.createElement('section');
  painelEl.id = 'observacao-panel';
  painelEl.setAttribute('aria-label', 'Observação do item');
  painelEl.setAttribute('role', 'dialog');
  painelEl.setAttribute('aria-modal', 'true');
  painelEl.style.cssText = 'position:fixed;inset:0;background:rgba(73,56,61,0.45);z-index:400;display:flex;align-items:center;justify-content:center;padding:16px;';
  painelEl.innerHTML = `<div style="background:#FFFCFA;width:92%;max-width:440px;padding:28px;border-radius:24px;box-shadow:0 20px 60px rgba(166,83,101,0.2);position:relative;max-height:85vh;overflow-y:auto;">
    <button onclick="finalizarObservacao(false)" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:22px;color:#49383D;cursor:pointer;" aria-label="Fechar">&#10005;</button>
    <h2 style="font-family:'Montserrat',sans-serif;font-size:24px;color:#49383D;margin-bottom:10px;">Quer adicionar alguma observação?</h2>
    <p style="font-size:14px;color:#49383D;opacity:0.8;margin-bottom:18px;line-height:1.5;">Item: <strong>${item.nome}</strong>${item.cor ? ' — ' + item.cor : ''}</p>
    <label for="campoObservacao" style="display:block;font-size:13px;font-weight:600;color:#49383D;margin-bottom:6px;">Escreva sua observação (opcional)</label>
    <textarea id="campoObservacao" rows="4" placeholder="Ex.: presente, cor especial, sem pedra..." style="width:100%;padding:12px 14px;border:1px solid rgba(166,83,101,0.2);border-radius:12px;font-size:15px;font-family:var(--fonte-texto);color:#49383D;box-sizing:border-box;resize:vertical;margin-bottom:20px;"></textarea>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button type="button" onclick="finalizarObservacao(false)" style="flex:1;min-width:130px;background:#fff;color:#49383D;border:2px solid rgba(166,83,101,0.2);padding:13px;border-radius:50px;font-weight:600;font-size:14px;cursor:pointer;">Sem observação</button>
      <button type="button" onclick="finalizarObservacao(true)" style="flex:1;min-width:130px;background:linear-gradient(135deg,#D78B98,#A65365);color:#fff;border:none;padding:13px;border-radius:50px;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 6px 18px rgba(166,83,101,0.25);">Salvar e adicionar</button>
    </div>
  </div>`;
  document.body.appendChild(painelEl);
  document.body.style.overflow = 'hidden';
  const campo = document.getElementById('campoObservacao');
  if (campo) campo.focus();
}

function finalizarObservacao(comObservacao) {
  const campo = document.getElementById('campoObservacao');
  const texto = campo ? (campo.value || '').trim() : '';
  const painel = document.getElementById('observacao-panel');
  if (painel) painel.remove();
  document.body.style.overflow = document.getElementById('detalhe-panel') ? 'hidden' : '';
  const item = itemPendente;
  itemPendente = null;
  if (!item) return;
  item.observacao = comObservacao && texto ? texto : null;
  const c = getCarrinho();
  c.push(item);
  setCarrinho(c);
  mostrarToast('Item adicionado ao carrinho');
}

async function adicionarCarrinho(id, variacao) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) {
    // Guarda a variação completa para que a ação pendente volta com estoque/cor corretos.
    abrirAuth('carrinho', { id: id, variacao: variacao || null });
    return;
  }
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  let v = variacao ? variacao : (window.variacaoAtual || (p.variacoes ? p.variacoes[0] : null));
  // Se a variação veio de uma ação pendente antiga (sem estoque), resolve pela cor no catálogo atual.
  if (variacao && variacao.cor && p.variacoes) {
    const correspondente = p.variacoes.find(x => x.cor === variacao.cor);
    if (correspondente) v = correspondente;
  }
  if (estoqueDisponivel(v || p) <= 0) {
    mostrarToast('Produto esgotado. Toque em Solicitar para entrar na lista de espera.');
    return;
  }
  const chave = p.id + '-' + (v && v.cor ? v.cor : 'padrao');
  const c = getCarrinho();
  const existente = c.find(i => i.chave === chave);
  if (existente) { existente.qtd += 1; setCarrinho(c); mostrarToast('Item adicionado ao carrinho'); return; }
  itemPendente = { chave, id: p.id, nome: p.nome, preco: p.preco, imagem: v && v.imagem ? v.imagem : p.imagem, cor: v && v.cor ? v.cor : null, qtd: 1, observacao: null };
  abrirModalObservacao(itemPendente);
}

document.addEventListener('DOMContentLoaded', init);

// ===== Autenticacao de clientes (Etapa 2) =====
window.usuarioAtual = null;

async function obterUsuarioAtual() {
  try {
    const r = await fetch('api/auth/me', { credentials: 'same-origin' });
    if (!r.ok) { window.usuarioAtual = null; return null; }
    const d = await r.json();
    window.usuarioAtual = d.usuario || null;
    return window.usuarioAtual;
  } catch (e) {
    window.usuarioAtual = null;
    return null;
  }
}

function atualizarMenuPerfil() {
  const bloco = document.getElementById('menuPerfil');
  if (!bloco) return;
  const u = window.usuarioAtual;
  const nome = document.getElementById('menuPerfilNome');
  const info = document.getElementById('menuPerfilInfo');
  const link = document.getElementById('menuPontinhosConta');
  if (u) {
    if (nome) nome.textContent = 'Olá, ' + ((u.nome || '').split(' ')[0] || 'cliente');
    if (info) info.textContent = u.email || 'Área da cliente';
    if (link) { link.textContent = 'Ver minha conta'; link.href = 'conta.html'; }
  } else {
    if (nome) nome.textContent = 'Olá, visitante';
    if (info) info.textContent = 'Entre ou crie sua conta';
    if (link) { link.textContent = 'Entrar na minha conta'; link.href = 'login.html'; }
  }
}

function atualizarHeaderAuth() {
  let link = document.getElementById('navAuth');
  const nav = document.querySelector('.main-nav');
  if (!link && nav) {
    link = document.createElement('a');
    link.id = 'navAuth';
    link.className = 'nav-link';
    link.href = 'login.html';
    link.textContent = 'Entrar';
    nav.appendChild(link);
  }
  if (!link) return;
  const u = window.usuarioAtual;
  if (u) {
    link.textContent = (u.nome || '').split(' ')[0] + ' (sair)';
    link.href = '#';
    link.onclick = function (e) { e.preventDefault(); sairCliente(); };
  } else {
    link.textContent = 'Entrar';
    link.href = 'login.html';
    link.onclick = null;
  }
  atualizarMenuPerfil();
}

async function cadastrarCliente(event) {
  if (event) event.preventDefault();
  const msg = document.getElementById('msgCadastro');
  const nome = (document.getElementById('cadNome').value || '').trim();
  const telefone = (document.getElementById('cadTelefone').value || '').trim();
  const email = (document.getElementById('cadEmail').value || '').trim();
  const senha = (document.getElementById('cadSenha').value || '').trim();
  try {
    const r = await fetch('api/auth/cadastro', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, telefone, email, senha })
    });
    const d = await r.json();
    if (!r.ok) { if (msg) { msg.textContent = d.erro || 'Falha no cadastro'; msg.className = 'mensagem erro'; msg.style.display = 'block'; } return; }
    window.usuarioAtual = d.usuario;
    atualizarHeaderAuth();
    window.location.href = 'conta.html';
  } catch (e) {
    if (msg) { msg.textContent = 'Erro de conexao'; msg.className = 'mensagem erro'; msg.style.display = 'block'; }
  }
}

async function entrarCliente(event) {
  if (event) event.preventDefault();
  const msg = document.getElementById('msgLogin');
  const email = (document.getElementById('loginEmail').value || '').trim();
  const senha = (document.getElementById('loginSenha').value || '').trim();
  if (!email || !senha) {
    if (msg) { msg.textContent = 'Informe e-mail e senha.'; msg.className = 'mensagem erro'; msg.style.display = 'block'; }
    return;
  }
  try {
    const r = await fetch('api/auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });
    let d = {};
    try { d = await r.json(); } catch (e) { d = {}; }
    if (!r.ok) {
      if (r.status === 429) { if (msg) { msg.textContent = d.erro || 'Muitas tentativas. Aguarde alguns minutos.'; msg.className = 'mensagem erro'; msg.style.display = 'block'; } return; }
      if (r.status === 401) { if (msg) { msg.textContent = 'E-mail ou senha incorretos.'; msg.className = 'mensagem erro'; msg.style.display = 'block'; } return; }
      if (msg) { msg.textContent = d.erro || 'Falha no login'; msg.className = 'mensagem erro'; msg.style.display = 'block'; }
      return;
    }
    window.usuarioAtual = d.usuario;
    atualizarHeaderAuth();
    window.location.href = 'conta.html';
  } catch (e) {
    if (msg) { msg.textContent = 'Erro de conexao'; msg.className = 'mensagem erro'; msg.style.display = 'block'; }
  }
}

async function sairCliente() {
  try { await fetch('api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
  window.usuarioAtual = null;
  atualizarHeaderAuth();
  window.location.href = 'index.html';
}

const _initOriginalAuth = init;
init = function () {
  _initOriginalAuth();
  obterUsuarioAtual().then(atualizarHeaderAuth);
};

function escConta(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function carregarContaCliente() {
  const contaBox = document.getElementById('contaBox');
  if (!contaBox) return;
  const u = await obterUsuarioAtual();
  if (!u) { window.location.href = 'login.html'; return; }
  contaBox.innerHTML = '<div class="conta-perfil">' +
    '<span class="conta-avatar">&#9829;</span>' +
    '<div><p class="conta-eyebrow">Área da cliente</p><h3>Olá, ' + escConta((u.nome || '').split(' ')[0] || 'cliente') + '!</h3>' +
    '<p class="conta-sub">Seus dados e acompanhamentos em um só lugar.</p></div></div>' +
    '<div class="conta-dados">' +
      '<div><span>Nome</span><strong>' + escConta(u.nome) + '</strong></div>' +
      '<div><span>E-mail</span><strong>' + escConta(u.email) + '</strong></div>' +
      '<div><span>Telefone</span><strong>' + escConta(u.telefone || '-') + '</strong></div>' +
    '</div>' +
    '<button type="button" class="busca-btn-limpar" style="margin-top:18px;" onclick="sairCliente()">Sair da conta</button>';
  const waitBox = document.getElementById('waitlistBox');
  const pedBox = document.getElementById('pedidosBox');
  try {
    const [wr, pr] = await Promise.all([
      fetch('api/waitlist', { credentials: 'same-origin' }),
      fetch('api/pedidos', { credentials: 'same-origin' })
    ]);
    const lista = wr.ok ? await wr.json() : [];
    const pedidos = pr.ok ? await pr.json() : [];
    if (waitBox) {
      waitBox.innerHTML = lista.length
        ? '<div class="conta-lista">' + lista.map((w) =>
            '<div class="conta-linha"><div><strong>' + escConta(w.produto) + '</strong>' +
            '<small>' + escConta(w.cor || 'Modelo único') + ' · ' + Number(w.quantidade || 1) + ' unidade(s)</small></div>' +
            '<span class="badge-status ' + (w.status === 'aguardando' ? 'aguardando' : '') + '">' + escConta(w.status) + '</span></div>').join('') + '</div>'
        : '<p class="conta-vazio">Você ainda não entrou em nenhuma lista de espera.</p>';
    }
    if (pedBox) {
      pedBox.innerHTML = pedidos.length
        ? '<div class="conta-lista">' + pedidos.map((o) =>
            '<div class="conta-pedido"><div class="conta-pedido-topo"><strong>' + escConta(o.codigo) + '</strong>' +
            '<span class="badge-status">' + escConta(o.status) + '</span></div>' +
            '<small>' + escConta(o.criado_em || '') + '</small>' +
            (o.itens || []).map((i) => '<div class="conta-pedido-item">' + escConta(i.produto) +
              (i.cor ? ' — ' + escConta(i.cor) : '') + ' x' + Number(i.quantidade || 1) + '</div>').join('') +
            '</div>').join('') + '</div>'
        : '<p class="conta-vazio">Seus pedidos e reservas aparecerão aqui.</p>';
    }
  } catch (e) {
    if (waitBox) waitBox.innerHTML = '<p class="conta-vazio">Não foi possível carregar agora.</p>';
    if (pedBox) pedBox.innerHTML = '<p class="conta-vazio">Não foi possível carregar agora.</p>';
  }
}

document.addEventListener('DOMContentLoaded', carregarContaCliente);
// ===== Busca na interface (Etapa 4) =====
function popularCategoriasBusca() {
  const sel = document.getElementById('buscaCategoria');
  if (!sel) return;
  const atual = sel.value;
  let html = '<option value="">Todas as categorias</option>';
  const principais = categoriasLista.filter(function (c) { return !c.parent_id; });
  for (const main of principais) {
    const filhas = categoriasLista.filter(function (c) { return c.parent_id === main.id; });
    if (filhas.length) {
      html += '<optgroup label="' + main.nome + '">';
      html += '<option value="' + main.slug + '">Todas de ' + main.nome + '</option>';
      for (const f of filhas) html += '<option value="' + f.slug + '">' + f.nome + '</option>';
      html += '</optgroup>';
    } else {
      html += '<option value="' + main.slug + '">' + main.nome + '</option>';
    }
  }
  // categorias orfas
  const orfas = categoriasLista.filter(function (c) { return c.parent_id && !principais.find(function (m) { return m.id === c.parent_id; }); });
  for (const o of orfas) html += '<option value="' + o.slug + '">' + o.nome + '</option>';
  sel.innerHTML = html;
  sel.value = atual;
}

async function solicitarEspera(id) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) { abrirAuth('reserva', { id: id }); return; }
  const p = produtos.find(x => x.id === id);
  if (!p || !p.variacoes || !p.variacoes.length) { alert('Produto nao encontrado.'); return; }
  const v = window.variacaoAtual || p.variacoes[0];
  try {
    const r = await fetch('api/waitlist', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant_id: v.id, quantidade: 1 })
    });
    const d = await r.json();
    if (!r.ok) { alert(d.erro || 'Falha ao solicitar'); return; }
    mostrarToast('Solicitacao registrada na lista de espera');
    fecharDetalhe();
  } catch (e) { alert('Erro de conexao'); }
}

// ===== Menu de tres pontinhos no cabecalho (Etapa 11) =====
document.addEventListener('DOMContentLoaded', function () {
  const actions = document.querySelector('.header-actions');
  if (!actions || document.getElementById('btnPontinhos')) return;

  // botao de tres pontinhos verticais
  const btn = document.createElement('button');
  btn.id = 'btnPontinhos';
  btn.className = 'icon-btn';
  btn.setAttribute('aria-label', 'Menu');
  btn.title = 'Menu';
  btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
  actions.appendChild(btn);

  // painel suspenso
  const panel = document.createElement('div');
  panel.id = 'menuPontinhosPanel';
  panel.className = 'menu-pontinhos-panel';
  panel.hidden = true;
  panel.innerHTML =
    '<div class="menu-pontinhos-perfil" id="menuPerfil">' +
      '<span class="menu-perfil-avatar" aria-hidden="true">&#9829;</span>' +
      '<div class="menu-perfil-texto"><strong id="menuPerfilNome">Olá, visitante</strong><small id="menuPerfilInfo">Entre ou crie sua conta</small></div>' +
    '</div>' +
    '<a href="conta.html" class="menu-pontinhos-item menu-pontinhos-conta" id="menuPontinhosConta">Minha conta</a>' +
    '<a href="index.html" class="menu-pontinhos-item">Início</a>' +
    '<a href="categorias.html" class="menu-pontinhos-item">Categorias</a>' +
    '<a href="novidades.html" class="menu-pontinhos-item">Novidades</a>' +
    '<a href="contato.html" class="menu-pontinhos-item">Contato</a>' +
    '<a href="painel-tania.html" class="menu-pontinhos-item">Área administrativa</a>';
  document.body.appendChild(panel);
  atualizarMenuPerfil();


  function posicionar() {
    const rect = btn.getBoundingClientRect();
    panel.style.top = (rect.bottom + 8) + 'px';
    panel.style.right = (window.innerWidth - rect.right) + 'px';
  }

  function abrir() {
    posicionar();
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }
  function fechar() {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (panel.hidden) abrir(); else fechar();
  });

  panel.addEventListener('click', function (e) {
    const a = e.target.closest('a');
    if (a) fechar();
  });

  document.addEventListener('click', function (e) {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) fechar();
  });

  window.addEventListener('resize', function () { if (!panel.hidden) posicionar(); });
  window.addEventListener('scroll', function () { if (!panel.hidden) posicionar(); }, true);
});let categoriasLista = [];
function categoriaEhDescendente(ancestralSlug, categoriaSlug) {
  if (ancestralSlug === categoriaSlug) return true;
  const cat = categoriasLista.find(function (c) { return c.slug === categoriaSlug; });
  if (!cat || !cat.parent_id) return false;
  const pai = categoriasLista.find(function (c) { return c.id === cat.parent_id; });
  if (!pai) return false;
  return categoriaEhDescendente(ancestralSlug, pai.slug);
}
function slugsDescendentes(slug) {
  return categoriasLista.filter(function (c) { return categoriaEhDescendente(slug, c.slug); }).map(function (c) { return c.slug; });
}
function nomeCategoria(slug) {
  const c = categoriasLista.find(function (x) { return x.slug === slug; });
  return c ? c.nome : slug;
}


function limparBusca() {
  const cat = document.getElementById('buscaCategoria');
  const cod = document.getElementById('buscaCodigo');
  const nome = document.getElementById('buscaNome');
  const res = document.getElementById('resultadosBusca');
  const contador = document.getElementById('buscaContador');
  if (cat) cat.value = '';
  if (cod) cod.value = '';
  if (nome) nome.value = '';
  if (res) res.innerHTML = '';
  if (contador) contador.textContent = '';
  if (nome) nome.focus();
}

// Atualiza o catalogo quando a pagina volta a ficar ativa
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) { carregarProdutosDoServidor().then(function () { try { init(); } catch (e) {} }); }
});
window.addEventListener('focus', function () {
  carregarProdutosDoServidor().then(function () { try { init(); } catch (e) {} });
});

// ===== Sincronizacao automatica do catalogo (complemento) =====
let assinaturaCatalogo = '';
async function sincronizarCatalogo(forcar) {
  if (!forcar && document.visibilityState && document.visibilityState !== 'visible') return;
  try {
    const [rCat, rProd] = await Promise.all([
      fetch('api/categorias?t=' + Date.now(), { cache: 'no-store' }),
      fetch('api/produtos?t=' + Date.now(), { cache: 'no-store' })
    ]);
    if (!rCat.ok || !rProd.ok) return;
    const cats = await rCat.json();
    const arr = await rProd.json();
    if (!Array.isArray(arr)) return;
    const assinatura = JSON.stringify(cats) + JSON.stringify(arr);
    if (assinatura === assinaturaCatalogo) return;
    assinaturaCatalogo = assinatura;
    if (Array.isArray(cats)) categoriasLista = cats;
    aplicarProdutos(arr);
    try { localStorage.setItem('tania_produtos', JSON.stringify(arr)); } catch (e) {}
    const temOverlay = document.getElementById('detalhe-panel') ||
      (document.getElementById('busca') && !document.getElementById('busca').hidden);
    if (!temOverlay && !document.hidden) init();
  } catch (e) {}
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') atualizarCatalogoLocal();
});
window.addEventListener('focus', sincronizarCatalogo);

// Atualizacao em tempo real: apenas uma aba mantem a conexao com o servidor
// e avisa as outras pelo armazenamento local (evita muitas conexoes no navegador).
let catalogoEventSource = null;
let coracaoEventos = null;
const ID_ABASSE = 'aba-' + Math.random().toString(36).slice(2) + '-' + Date.now();
const CHAVE_LIDER = 'tania_sse_lider';
const CHAVE_AVISO = 'tania_sse_aviso';

// Atualiza esta aba: busca dados novos e redesenha cards e filtros abertos.
function atualizarCatalogoLocal() {
  return sincronizarCatalogo(true).then(function () {
    // Atualiza tambem o detalhe aberto (ele tambem mostra ESGOTADO/Disponivel).
    const detalhe = document.getElementById('detalhe-panel');
    let idDetalhe = null;
    if (detalhe) {
      const titulo = detalhe.querySelector('h2');
      const atual = titulo ? titulo.textContent : '';
      const p = produtos.find(x => x.nome === atual);
      if (p) idDetalhe = p.id;
      if (typeof fecharDetalhe === 'function') fecharDetalhe();
    }
    try { if (typeof init === 'function') init(); } catch (e) {}
    const painel = document.getElementById('busca');
    if (painel && !painel.hidden && typeof executarBusca === 'function') executarBusca();
    if (idDetalhe && typeof abrirDetalhe === 'function') abrirDetalhe(idDetalhe);
  });
}

// Evento do painel: atualiza esta aba e avisa as outras.
function atualizarAposEventoCatalogo() {
  try { localStorage.setItem(CHAVE_AVISO, String(Date.now()) + '-' + Math.random().toString(36).slice(2)); } catch (e) {}
  return atualizarCatalogoLocal();
}

function liderEventos() {
  try {
    const atual = JSON.parse(localStorage.getItem(CHAVE_LIDER) || 'null');
    return !atual || atual.id === ID_ABASSE || (Date.now() - Number(atual.t || 0)) > 12000;
  } catch (e) { return true; }
}

function marcarLiderEventos() {
  try { localStorage.setItem(CHAVE_LIDER, JSON.stringify({ id: ID_ABASSE, t: Date.now() })); } catch (e) {}
}

function iniciarEventosCatalogo() {
  if (catalogoEventSource || typeof EventSource === 'undefined' || !liderEventos()) return;
  try {
    marcarLiderEventos();
    if (coracaoEventos) clearInterval(coracaoEventos);
    coracaoEventos = setInterval(marcarLiderEventos, 5000);
    catalogoEventSource = new EventSource('api/eventos');
    catalogoEventSource.addEventListener('catalogo', function () {
      marcarLiderEventos();
      atualizarAposEventoCatalogo();
      try { localStorage.setItem(CHAVE_AVISO, String(Date.now())); } catch (e) {}
    });
  } catch (e) { catalogoEventSource = null; }
}

window.addEventListener('storage', function (e) {
  // Nao retransmite: apenas atualiza localmente para evitar loop entre abas.
  if (e.key === CHAVE_AVISO && e.newValue) atualizarCatalogoLocal();
});

window.addEventListener('beforeunload', function () {
  try {
    const atual = JSON.parse(localStorage.getItem(CHAVE_LIDER) || 'null');
    if (atual && atual.id === ID_ABASSE) localStorage.removeItem(CHAVE_LIDER);
  } catch (e) {}
});

iniciarEventosCatalogo();
setInterval(function () {
  if (!catalogoEventSource && liderEventos()) iniciarEventosCatalogo();
}, 6000);
setInterval(function () { if (!document.hidden) atualizarCatalogoLocal(); }, 5000);

if (window.produtosPromise && typeof window.produtosPromise.then === 'function') {
  window.produtosPromise.then(function () { sincronizarCatalogo(); });
}

document.addEventListener('DOMContentLoaded', function () {
  const actions = document.querySelector('.header-actions');
  if (actions && !document.getElementById('btnBusca')) {
    const btn = document.createElement('button');
    btn.id = 'btnBusca';
    btn.className = 'icon-btn';
    btn.setAttribute('aria-label', 'Buscar');
    btn.title = 'Buscar';
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A65365" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
    btn.onclick = openBusca;
    actions.insertBefore(btn, actions.firstChild);
  }
  if (!document.getElementById('busca')) {
    const panel = document.createElement('section');
    panel.id = 'busca';
    panel.className = 'busca-panel';
    panel.hidden = true;
    panel.innerHTML = '<div class="busca-inner">' +
      '<button type="button" class="busca-fechar" onclick="fecharBusca()" aria-label="Fechar busca">&#10005;</button>' +
      '<div class="busca-cabecalho">' +
        '<span class="busca-coracao" aria-hidden="true">&#9829;</span>' +
        '<div><p class="busca-eyebrow">Tania Briet Acessórios</p>' +
        '<h3>Encontre sua peça favorita</h3>' +
        '<p>Nome, código ou cor — o que você procura?</p></div>' +
      '</div>' +
      '<div class="busca-campos">' +
        '<label class="busca-campo busca-campo-principal"><span>O que você procura?</span><input type="search" id="buscaNome" placeholder="Ex.: bracelete, verde, borboleta..."></label>' +
        '<label class="busca-campo"><span>Código do produto</span><input type="text" id="buscaCodigo" placeholder="Ex.: P0001"></label>' +
        '<label class="busca-campo"><span>Categoria</span><select id="buscaCategoria"></select></label>' +
      '</div>' +
      '<div class="busca-acoes">' +
        '<button type="button" class="busca-btn-buscar" onclick="executarBusca()">Buscar peças</button>' +
        '<button type="button" class="busca-btn-limpar" onclick="limparBusca()">Limpar filtros</button>' +
      '</div>' +
      '<div id="buscaContador" class="busca-contador"></div>' +
      '<div id="resultadosBusca" class="resultados-busca"></div>' +
      '</div>';
    document.body.appendChild(panel);
    let temporizadorBusca = null;
    function buscarAoDigitar() {
      if (temporizadorBusca) clearTimeout(temporizadorBusca);
      temporizadorBusca = setTimeout(function () { executarBusca(); }, 220);
    }
    const campoCodigo = document.getElementById('buscaCodigo');
    const campoNome = document.getElementById('buscaNome');
    if (campoCodigo) campoCodigo.addEventListener('input', buscarAoDigitar);
    if (campoNome) campoNome.addEventListener('input', buscarAoDigitar);
    const selectCategoria = document.getElementById('buscaCategoria');
    if (selectCategoria) selectCategoria.addEventListener('change', function () { executarBusca(); });
  }
  const topoPainel = document.querySelector('.admin-topo');
  if (topoPainel && !document.getElementById('btnBusca')) {
    const btnPainel = document.createElement('button');
    btnPainel.type = 'button';
    btnPainel.id = 'btnBusca';
    btnPainel.className = 'btn-secundario';
    btnPainel.textContent = 'Buscar produtos';
    btnPainel.onclick = openBusca;
    topoPainel.appendChild(btnPainel);
  }
});


// ===== Login/cadastro rapido no momento da reserva ou pedido =====
let acaoPendente = null;
let modoAuth = 'login';
function abrirAuth(acao, extra) {
  acaoPendente = { acao: acao, extra: extra || {} };
  modoAuth = 'login';
  const anterior = document.getElementById('auth-panel');
  if (anterior) anterior.remove();
  const el = document.createElement('section');
  el.id = 'auth-panel';
  el.setAttribute('aria-label', 'Entrar ou criar conta');
  el.style.cssText = 'position:fixed;inset:0;background:rgba(73,56,61,0.5);z-index:400;display:flex;align-items:center;justify-content:center;';
  el.innerHTML = `<div style="background:#FFFCFA;width:92%;max-width:460px;padding:28px;border-radius:24px;box-shadow:0 20px 60px rgba(166,83,101,0.2);position:relative;max-height:90vh;overflow-y:auto;">
    <button onclick="fecharAuth()" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:22px;color:#49383D;cursor:pointer;" aria-label="Fechar">&#10005;</button>
    <h2 style="font-family:'Montserrat',sans-serif;font-size:22px;color:#49383D;margin-bottom:14px;">Sua conta</h2>
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      <button id="abaEntrar" type="button" onclick="alternarModoAuth('login')" style="flex:1;padding:11px;border-radius:50px;border:2px solid #A65365;background:#A65365;color:#fff;font-weight:700;cursor:pointer;">Entrar</button>
      <button id="abaCadastrar" type="button" onclick="alternarModoAuth('cadastro')" style="flex:1;padding:11px;border-radius:50px;border:2px solid rgba(166,83,101,0.3);background:#fff;color:#49383D;font-weight:700;cursor:pointer;">Cadastrar</button>
    </div>
    <p id="authDescricao" style="font-size:13px;color:#49383D;opacity:0.85;margin-bottom:18px;line-height:1.5;">Entre com seu e-mail e senha para continuar.</p>
    <div id="authCamposCadastro" style="display:none;">
      <label style="display:block;font-size:13px;font-weight:600;color:#49383D;margin-bottom:6px;">Nome completo</label>
      <input id="authNome" type="text" placeholder="Seu nome" style="width:100%;padding:12px 14px;border:1px solid rgba(166,83,101,0.25);border-radius:12px;font-size:15px;margin-bottom:14px;box-sizing:border-box;">
      <label style="display:block;font-size:13px;font-weight:600;color:#49383D;margin-bottom:6px;">Telefone</label>
      <input id="authTelefone" type="tel" placeholder="(12) 99999-9999" style="width:100%;padding:12px 14px;border:1px solid rgba(166,83,101,0.25);border-radius:12px;font-size:15px;margin-bottom:14px;box-sizing:border-box;">
    </div>
    <label style="display:block;font-size:13px;font-weight:600;color:#49383D;margin-bottom:6px;">E-mail</label>
    <input id="authEmail" type="email" placeholder="voce@email.com" style="width:100%;padding:12px 14px;border:1px solid rgba(166,83,101,0.25);border-radius:12px;font-size:15px;margin-bottom:14px;box-sizing:border-box;">
    <label style="display:block;font-size:13px;font-weight:600;color:#49383D;margin-bottom:6px;">Senha</label>
    <input id="authSenha" type="password" placeholder="Sua senha" style="width:100%;padding:12px 14px;border:1px solid rgba(166,83,101,0.25);border-radius:12px;font-size:15px;margin-bottom:14px;box-sizing:border-box;">
    <div id="authMsg" class="mensagem erro" style="display:none;margin-bottom:14px;"></div>
    <button type="button" id="authEnviar" onclick="enviarAuth()" style="width:100%;background:linear-gradient(135deg,#D78B98,#A65365);color:#fff;border:none;padding:14px;border-radius:50px;font-weight:700;font-size:15px;cursor:pointer;">Entrar</button>
  </div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  setTimeout(function () { const c = document.getElementById('authEmail'); if (c) c.focus(); }, 60);
}

function alternarModoAuth(modo) {
  modoAuth = modo === 'cadastro' ? 'cadastro' : 'login';
  const campos = document.getElementById('authCamposCadastro');
  const desc = document.getElementById('authDescricao');
  const btn = document.getElementById('authEnviar');
  const entrar = document.getElementById('abaEntrar');
  const cadastrar = document.getElementById('abaCadastrar');
  if (campos) campos.style.display = modoAuth === 'cadastro' ? 'block' : 'none';
  if (desc) desc.textContent = modoAuth === 'cadastro'
    ? 'Crie sua conta com nome, telefone, e-mail e senha para continuar.'
    : 'Entre com seu e-mail e senha para continuar.';
  if (btn) btn.textContent = modoAuth === 'cadastro' ? 'Criar conta e continuar' : 'Entrar e continuar';
  if (entrar) { entrar.style.background = modoAuth === 'login' ? '#A65365' : '#fff'; entrar.style.color = modoAuth === 'login' ? '#fff' : '#49383D'; }
  if (cadastrar) { cadastrar.style.background = modoAuth === 'cadastro' ? '#A65365' : '#fff'; cadastrar.style.color = modoAuth === 'cadastro' ? '#fff' : '#49383D'; }
  const msg = document.getElementById('authMsg');
  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
}

function fecharAuth() {
  const el = document.getElementById('auth-panel');
  if (el) el.remove();
  if (janelaWhatsPendente && !janelaWhatsPendente.closed) {
    try { janelaWhatsPendente.close(); } catch (e) {}
  }
  janelaWhatsPendente = null;
  acaoPendente = null;
  if (!document.getElementById('pedido-panel') && !document.getElementById('detalhe-panel')) document.body.style.overflow = '';
}

async function enviarAuth() {
  const email = (document.getElementById('authEmail').value || '').trim();
  const senha = (document.getElementById('authSenha').value || '').trim();
  const campoNome = document.getElementById('authNome');
  const campoTelefone = document.getElementById('authTelefone');
  const nome = campoNome ? (campoNome.value || '').trim() : '';
  const telefone = campoTelefone ? (campoTelefone.value || '').trim() : '';
  const msg = document.getElementById('authMsg');
  const erro = function (t) { if (msg) { msg.textContent = t; msg.className = 'mensagem erro'; msg.style.display = 'block'; } };
  if (modoAuth === 'cadastro' && (!nome || !telefone)) { erro('Preencha nome e telefone.'); return; }
  if (!email || !senha) { erro('Preencha e-mail e senha.'); return; }
  if (senha.length < 6) { erro('A senha deve ter ao menos 6 caracteres.'); return; }
  const btn = document.getElementById('authEnviar');
  if (btn) { btn.disabled = true; btn.textContent = 'Aguarde...'; }
  try {
    let r;
    if (modoAuth === 'cadastro') {
      r = await fetch('api/auth/cadastro', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome, telefone: telefone, email: email, senha: senha })
      });
      if (r.status === 409) {
        alternarModoAuth('login');
        erro('Este e-mail já está cadastrado. Entre com sua senha.');
        if (btn) { btn.disabled = false; btn.textContent = 'Entrar e continuar'; }
        return;
      }
    } else {
      r = await fetch('api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, senha: senha })
      });
    }
    let d = {}; try { d = await r.json(); } catch (e) { d = {}; }
    if (!r.ok) {
      if (btn) { btn.disabled = false; btn.textContent = modoAuth === 'cadastro' ? 'Criar conta e continuar' : 'Entrar e continuar'; }
      erro(d.erro || (modoAuth === 'cadastro' ? 'Não foi possível criar a conta.' : 'E-mail ou senha incorretos.'));
      return;
    }
    window.usuarioAtual = d.usuario;
    atualizarHeaderAuth();
    const pendente = acaoPendente;
    fecharAuth();
    if (pendente) {
      if (pendente.acao === 'pedido') setTimeout(function () { confirmarPedido(); }, 60);
      if (pendente.acao === 'reserva') setTimeout(function () { solicitarEspera(pendente.extra.id); }, 60);
      if (pendente.acao === 'detalhe') setTimeout(function () { abrirDetalhe(pendente.extra.id); }, 60);
      if (pendente.acao === 'carrinho') setTimeout(function () { adicionarCarrinho(pendente.extra.id, pendente.extra.variacao || null); }, 60);
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Continuar'; }
    erro('Erro de conexao.');
  }
}

// Abas abertas com versao antiga recarregam sozinhas quando o script muda.
async function verificarVersaoScript() {
  try {
    const t = await fetch('script.js?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); });
    const m = t.match(/VERSAO_SCRIPT_ATUAL\s*=\s*(\d+)/);
    if (m && Number(m[1]) > VERSAO_SCRIPT_ATUAL) location.reload();
  } catch (e) {}
}

setInterval(verificarVersaoScript, 30000);
