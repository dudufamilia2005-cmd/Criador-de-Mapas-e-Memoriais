/* Tela: formulário, desenho da planta e memorial. Depende de U, Geo e Coord. */
(function(){
'use strict';
var $=function(id){ return document.getElementById(id); };
var fmt=U.fmt, r2=U.r2, esc=U.esc, maiusc=U.maiusc;

/* ================================================================
   Geometria
   ================================================================ */
function cruzam(a,b,c,d){
  function orient(p,q,r){ return (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x); }
  var d1=orient(c,d,a), d2=orient(c,d,b), d3=orient(a,b,c), d4=orient(a,b,d);
  return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
}
function geometria(pts){
  var n=pts.length, ox=pts[0].x, oy=pts[0].y;
  var P=pts.map(function(p){ return {x:p.x-ox, y:p.y-oy}; });   // tira a ordem de grandeza da UTM antes de multiplicar
  var a2=0, segs=[];
  for(var i=0;i<n;i++){
    var j=(i+1)%n, dx=P[j].x-P[i].x, dy=P[j].y-P[i].y;
    a2+=P[i].x*P[j].y-P[j].x*P[i].y;
    segs.push({i:i, j:j, dx:dx, dy:dy, d:Math.hypot(dx,dy), az:(Math.atan2(dx,dy)*180/Math.PI+360)%360});
  }
  var ccw=a2>0;
  segs.forEach(function(s){
    var d=s.d||1;
    s.nx = ccw ?  s.dy/d : -s.dy/d;   // normal para fora do imóvel
    s.ny = ccw ? -s.dx/d :  s.dx/d;
  });
  var cruza=null;
  for(var a=0;a<n && !cruza;a++){
    for(var b=a+2;b<n;b++){
      if(a===0 && b===n-1) continue;
      if(cruzam(P[a],P[(a+1)%n],P[b],P[(b+1)%n])){ cruza=[a,b]; break; }
    }
  }
  var perimetro=segs.reduce(function(s,x){ return s+r2(x.d); },0);   // soma das medidas como estão escritas
  return {segs:segs, area:Math.abs(a2)/2, perimetro:perimetro, ccw:ccw, cruza:cruza};
}

// Frente escolhida → demais lados por orientação, de quem da rua olha para o imóvel
function classificar(geo, fi){
  var f=geo.segs[fi]; if(!f) return geo.segs.map(function(){ return 'outro'; });
  var nx=f.nx, ny=f.ny, rx=-ny, ry=nx;
  return geo.segs.map(function(s,i){
    if(i===fi) return 'frente';
    var a=s.nx*nx+s.ny*ny, b=s.nx*rx+s.ny*ry;
    // diagonal curta voltada para a rua, entre a frente e uma lateral: chanfro de esquina
    if(a>0.4 && Math.abs(b)>0.4 && s.d<f.d*0.6) return 'chanfro';
    if(Math.abs(a)>=Math.abs(b)) return a>0 ? 'frente' : 'fundos';
    return b>0 ? 'direito' : 'esquerdo';
  });
}

/* ================================================================
   Estado
   ================================================================ */
var CAMPOS=['coords','formato','datum','fuso','hemisferio','plano','altitude','orientacao','lote','quadra','logradouro','numero','setor','municipio','cep','enderecoExtenso','propNome','propDoc','rtNome','rtTitulo','rtCrea','rtArt','rtLembrar','estilo','coordSaida','dataDoc','extensoArea','quadroVertices','assinaProp','descricao'];
var CAMPOS_RT=['rtNome','rtTitulo','rtCrea','rtArt'];
var PADRAO={formato:'auto', datum:'auto', fuso:'22', hemisferio:'S', plano:'utm', altitude:'', orientacao:'frente', municipio:'Morrinhos-GO', estilo:'confrontacoes', coordSaida:'utm', quadroVertices:true, extensoArea:false, assinaProp:false};
var CHAVE_RASCUNHO='plantaMemorial.rascunho.v1', CHAVE_RT='plantaMemorial.rt.v1';

function estadoNovo(){ return {segs:[], frenteIdx:0, descricaoManual:false, enderecoManual:false}; }
var estado=estadoNovo();
var chaveTabela='';

function lerCampos(){
  var c={};
  CAMPOS.forEach(function(id){ var el=$(id); c[id] = el.type==='checkbox' ? el.checked : el.value; });
  return c;
}
function porCampos(c){
  CAMPOS.forEach(function(id){
    if(!(id in c)) return;
    var el=$(id);
    if(el.type==='checkbox') el.checked=!!c[id]; else el.value = c[id]==null ? '' : c[id];
  });
}
function camposPadrao(){
  var c={}; CAMPOS.forEach(function(id){ c[id] = ($(id).type==='checkbox') ? false : ''; });
  Object.keys(PADRAO).forEach(function(k){ c[k]=PADRAO[k]; });
  c.dataDoc=U.hojeISO();
  return c;
}
function lerStorage(chave){ try{ var s=localStorage.getItem(chave); return s ? JSON.parse(s) : null; }catch(e){ return null; } }
function gravarStorage(chave, v){ try{ if(v===null) localStorage.removeItem(chave); else localStorage.setItem(chave, JSON.stringify(v)); }catch(e){} }

/* ================================================================
   Tabela de lados
   ================================================================ */
var CLASSES=[['frente','Frente'],['chanfro','Chanfro'],['fundos','Fundos'],['direito','Lado direito'],['esquerdo','Lado esquerdo'],['outro','Outro']];
var TIPOS=[['lote','Lote'],['rua','Rua'],['outro','Outro']];

function sincronizarSegs(n){
  for(var i=estado.segs.length;i<n;i++){
    estado.segs.push({classe:'', tipo: i===estado.frenteIdx ? 'rua' : 'lote', valor:'', classeManual:false});
  }
  if(estado.frenteIdx>=n) estado.frenteIdx=0;
}
function placeholderValor(s){
  if(s.tipo==='lote') return 'nº do lote';
  if(s.tipo==='rua') return s.classe==='frente' ? 'a rua do imóvel' : 'nome da rua';
  return 'ex.: a área verde';
}
function opcoes(lista, sel){ return lista.map(function(o){ return '<option value="'+o[0]+'"'+(o[0]===sel?' selected':'')+'>'+o[1]+'</option>'; }).join(''); }

function montarTabelaSegs(L, geo){
  var tb=$('tbSegs');
  if(!geo){ chaveTabela=''; tb.innerHTML='<tr><td colspan="6" class="vazio">Os lados aparecem aqui depois das coordenadas.</td></tr>'; return; }
  var chave=L.pts.length+'|'+L.pts.map(function(p){ return p.nome; }).join('|');
  if(chave!==chaveTabela){
    chaveTabela=chave;
    var h='';
    geo.segs.forEach(function(sg,i){
      var s=estado.segs[i];
      h+='<tr data-i="'+i+'">'+
        '<td><input type="radio" name="frente" value="'+i+'" title="Este lado é a frente"></td>'+
        '<td class="nm">'+esc(L.pts[sg.i].nome)+'–'+esc(L.pts[sg.j].nome)+'</td>'+
        '<td class="ds"></td>'+
        '<td><select class="classe">'+opcoes(CLASSES, s.classe)+'</select></td>'+
        '<td><select class="tipo">'+opcoes(TIPOS, s.tipo)+'</select></td>'+
        '<td><input type="text" class="valor"></td>'+
      '</tr>';
    });
    tb.innerHTML=h;
    Array.prototype.forEach.call(tb.rows, function(tr,i){ tr.querySelector('.valor').value=estado.segs[i].valor; });
  }
  Array.prototype.forEach.call(tb.rows, function(tr,i){
    var s=estado.segs[i];
    tr.querySelector('.ds').textContent=fmt(geo.segs[i].d)+' m';
    tr.querySelector('input[type=radio]').checked = i===estado.frenteIdx;
    tr.classList.toggle('frente', i===estado.frenteIdx);
    var sc=tr.querySelector('.classe'); if(sc.value!==s.classe) sc.value=s.classe;
    var st=tr.querySelector('.tipo'); if(st.value!==s.tipo) st.value=s.tipo;
    tr.querySelector('.valor').placeholder=placeholderValor(s);
  });
}

/* ================================================================
   Texto
   ================================================================ */
var FEMININOS=/^(rua|r\.|avenida|av\.?|alameda|al\.|travessa|tv\.|rodovia|praça|praca|estrada|est\.|viela|via|marginal|passagem|quadra)\b/i;
function ehFeminino(nome){ return FEMININOS.test(String(nome).trim()); }
function tipoLogradouro(nome){
  var w=String(nome).trim().split(/\s+/)[0].toLowerCase();
  return ({'r.':'rua','av':'avenida','av.':'avenida','al.':'alameda','tv.':'travessa','est.':'estrada','praca':'praça'})[w] || w;
}
function normaliza(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim(); }
function numeroLote(v){ return String(v||'').replace(/^\s*lote\s*(n[º°o.]*\s*)?/i,'').trim(); }
function nomeRua(seg, c){ return (seg.valor||'').trim() || (c.logradouro||'').trim(); }

function gerarEndereco(c){
  var p=[];
  if(c.logradouro) p.push(c.logradouro.trim()+(c.numero?', nº '+c.numero.trim():''));
  if(c.quadra) p.push('Quadra '+c.quadra.trim());
  if(c.lote) p.push('Lote '+c.lote.trim());
  if(c.setor) p.push(c.setor.trim());
  var s=p.join(', ');
  if(c.municipio) s += (s?', ':'')+c.municipio.trim();
  if(c.cep) s += (s?', ':'')+'CEP '+c.cep.trim();
  return s;
}

// trecho "confrontando com …" de um lado; vazio se não houver confrontante
function confrontacao(seg, c, modo){
  if(seg.tipo==='rua'){
    var rua=nomeRua(seg,c); if(!rua) return '';
    var fem=ehFeminino(rua), mesma=c.logradouro && normaliza(rua)===normaliza(c.logradouro);
    var alvo = mesma ? (fem?'a dita ':'o dito ')+tipoLogradouro(rua) : (fem?'a ':'o ')+rua;
    return (modo==='frente' ? 'para ' : 'confrontando com ')+alvo;
  }
  var v=(seg.valor||'').trim(); if(!v) return '';
  if(seg.tipo==='lote') return 'confrontando com o lote '+numeroLote(v);
  return 'confrontando com '+v;
}
function confrontanteCurto(seg, c){
  if(seg.tipo==='rua') return nomeRua(seg,c);
  var v=(seg.valor||'').trim(); if(!v) return '';
  return seg.tipo==='lote' ? 'Lote '+numeroLote(v) : v;
}

var POSICAO={frente:'de frente', chanfro:'em chanfro', fundos:'de fundos', direito:'pelo lado direito', esquerdo:'pelo lado esquerdo', outro:''};
var ORDEM={frente:0, chanfro:1, fundos:2, direito:3, esquerdo:4, outro:5};

function cabecalhoDescricao(c, geo){
  var ident=[c.lote&&'Lote '+c.lote.trim(), c.quadra&&'Quadra '+c.quadra.trim()].filter(Boolean).join(', ');
  var s=ident || 'Imóvel';
  if(c.logradouro){
    s += (ident?', ':' ')+'situado '+(ehFeminino(c.logradouro)?'na ':'no ')+c.logradouro.trim();
    if(c.numero) s+=', nº '+c.numero.trim();
  }
  if(c.setor) s+=', '+c.setor.trim();
  if(c.municipio) s+=', '+c.municipio.trim();
  s+=', com a área de '+fmt(geo.area)+' m²'+(c.extensoArea?' ('+U.areaExtenso(r2(geo.area))+')':'');
  s+=' e perímetro de '+fmt(geo.perimetro)+' m'+(c.extensoArea?' ('+U.compExtenso(r2(geo.perimetro))+')':'');
  return s;
}

function gerarDescricao(c, L, geo){
  var cab=cabecalhoDescricao(c, geo);
  if(c.estilo==='vertices') return cab+', assim descrito: '+descricaoVertices(c, L, geo);
  var itens=geo.segs.map(function(sg,i){ return {i:i, s:estado.segs[i], d:sg.d}; });
  itens.sort(function(a,b){ return (ORDEM[a.s.classe]-ORDEM[b.s.classe]) || (a.i-b.i); });
  var partes=itens.map(function(it){
    var conf=confrontacao(it.s, c, it.s.classe==='frente' ? 'frente' : '');
    return [fmt(it.d)+' metros', POSICAO[it.s.classe]||'', conf].filter(Boolean).join(' ');
  });
  var lista = partes.length>1 ? partes.slice(0,-1).join('; ')+'; e '+partes[partes.length-1] : partes[0];
  return cab+', com as seguintes divisas e confrontações: '+lista+'.';
}

function saidaGeo(c, L){ return L.georef && c.coordSaida==='geo'; }
function coordTexto(p, L, c){
  if(!L.georef) return 'de coordenadas X '+fmt(p.E)+' m e Y '+fmt(p.N)+' m';
  if(saidaGeo(c,L)) return 'de coordenadas latitude '+Geo.gms(p.lat,'lat')+' e longitude '+Geo.gms(p.lon,'lon');
  return 'de coordenadas N '+fmt(p.N)+' m e E '+fmt(p.E)+' m';
}
function descricaoVertices(c, L, geo){
  var pts=L.pts, s='Inicia-se a descrição deste perímetro no vértice '+pts[0].nome+', '+coordTexto(pts[0],L,c);
  geo.segs.forEach(function(sg,i){
    var conf=confrontacao(estado.segs[i], c, '');
    var ult = sg.j===0;
    s+='; deste, segue com azimute de '+U.grausMS(sg.az)+' e distância de '+fmt(sg.d)+' m'+(conf?', '+conf:'')+
       ', até o vértice '+pts[sg.j].nome+(ult ? ', ponto inicial da descrição deste perímetro' : ', '+coordTexto(pts[sg.j],L,c));
  });
  s+='.';
  if(L.georef){
    var mc=Geo.meridianoCentral(L.fuso);
    s+=' Todas as coordenadas aqui descritas estão georreferenciadas ao Sistema Geodésico Brasileiro, tendo como datum o SIRGAS 2000, e encontram-se representadas '+
       (saidaGeo(c,L) ? 'em coordenadas geodésicas (latitude e longitude).'
                      : 'no sistema UTM, fuso '+L.fuso+L.hemi+', referenciadas ao meridiano central '+Math.abs(mc)+'° '+(mc<0?'W':'E')+' Gr.');
    s+= L.plano==='sgl'
      ? ' Os azimutes, as distâncias, a área e o perímetro foram calculados no plano topográfico local.'
      : ' Os azimutes, as distâncias, a área e o perímetro foram calculados no plano de projeção UTM'+(saidaGeo(c,L)?', fuso '+L.fuso+L.hemi:'')+'.';
  }
  return s;
}

function textoSistema(L, c){
  if(!L.familia) return '';
  if(!L.georef) return 'Coordenadas locais (sem georreferenciamento)';
  var mc=Geo.meridianoCentral(L.fuso), D=Geo.DATUMS[L.datumOrigem];
  var conv = (L.datumOrigem==='sad69' || L.datumOrigem==='ca') ? ' (convertido de '+D.nome+')' : '';
  return 'SIRGAS 2000'+conv+' · '+(saidaGeo(c,L)?'coordenadas geodésicas · ':'')+'UTM fuso '+L.fuso+L.hemi+' (MC '+Math.abs(mc)+'° '+(mc<0?'W':'E')+') · medidas no '+(L.plano==='sgl'?'plano topográfico local':'plano UTM');
}

/* ================================================================
   Desenho (SVG em milímetros → escala real na impressão)
   ================================================================ */
var ESCALAS=[50,75,100,125,150,200,250,300,400,500,600,750,1000,1250,1500,2000,2500,3000,4000,5000,6000,7500,10000,12500,15000,20000,25000,50000,100000];

function dentro(p, P){
  var ins=false;
  for(var i=0,j=P.length-1;i<P.length;j=i++){
    if(((P[i][1]>p[1])!==(P[j][1]>p[1])) && (p[0] < (P[j][0]-P[i][0])*(p[1]-P[i][1])/(P[j][1]-P[i][1])+P[i][0])) ins=!ins;
  }
  return ins;
}
function distBorda(p, P){
  var m=Infinity;
  for(var i=0;i<P.length;i++){
    var a=P[i], b=P[(i+1)%P.length], dx=b[0]-a[0], dy=b[1]-a[1], l2=dx*dx+dy*dy;
    var t=l2 ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2)) : 0;
    m=Math.min(m, Math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy));
  }
  return m;
}
// ponto do interior mais afastado das bordas (onde cabe o rótulo do lote)
function poloInterno(P){
  var xs=P.map(function(p){return p[0];}), ys=P.map(function(p){return p[1];});
  var x0=Math.min.apply(null,xs), x1=Math.max.apply(null,xs), y0=Math.min.apply(null,ys), y1=Math.max.apply(null,ys);
  var melhor=null, md=-1, N=28, sx=(x1-x0)/N, sy=(y1-y0)/N;
  for(var i=0;i<=N;i++) for(var j=0;j<=N;j++){
    var p=[x0+i*sx, y0+j*sy];
    if(!dentro(p,P)) continue;
    var d=distBorda(p,P); if(d>md){ md=d; melhor=p; }
  }
  if(!melhor){ var cx=0,cy=0; P.forEach(function(p){cx+=p[0];cy+=p[1];}); return {p:[cx/P.length,cy/P.length], d:0}; }
  for(var it=0;it<4;it++){
    sx/=4; sy/=4; var base=melhor;
    for(var a=-4;a<=4;a++) for(var b=-4;b<=4;b++){
      var q=[base[0]+a*sx, base[1]+b*sy];
      if(!dentro(q,P)) continue;
      var dq=distBorda(q,P); if(dq>md){ md=dq; melhor=q; }
    }
  }
  // num retângulo o polo é uma linha inteira; se o centroide serve quase tão bem, fica no meio
  var gx=0, gy=0; P.forEach(function(p){ gx+=p[0]; gy+=p[1]; }); gx/=P.length; gy/=P.length;
  if(dentro([gx,gy],P)){ var dg=distBorda([gx,gy],P); if(dg>=md*0.9) return {p:[gx,gy], d:dg}; }
  return {p:melhor, d:md};
}

function n3(v){ return (Math.round(v*1000)/1000).toString(); }
function textoGirado(x, y, angRad, txt, attrs){
  // texto lido de baixo ou da direita da folha; vertical sobe (−90°)
  var a=angRad*180/Math.PI; while(a>85) a-=180; while(a<=-95) a+=180;
  return '<text x="'+n3(x)+'" y="'+n3(y)+'" transform="rotate('+a.toFixed(2)+' '+n3(x)+' '+n3(y)+')" text-anchor="middle" dominant-baseline="central" '+(attrs||'')+'>'+esc(txt)+'</text>';
}

function svgVazio(W,H){
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'mm" height="'+H+'mm" viewBox="0 0 '+W+' '+H+'" font-family="Arial, Helvetica, sans-serif">'+
    '<rect x=".25" y=".25" width="'+(W-.5)+'" height="'+(H-.5)+'" fill="none" stroke="#000" stroke-width=".5"/>'+
    '<text x="'+W/2+'" y="'+H/2+'" text-anchor="middle" font-size="4" fill="#999">Informe ao menos 3 vértices</text></svg>';
}

function desenhar(c, L, geo){
  var W=186, H=170, M=24;
  var pts=L.pts, n=pts.length, segs=geo.segs, fi=estado.frenteIdx;
  var ox=pts[0].x, oy=pts[0].y;
  var th=0;
  if(c.orientacao==='frente' && segs[fi]) th=-Math.PI/2-Math.atan2(segs[fi].ny, segs[fi].nx);
  var ct=Math.cos(th), st=Math.sin(th);
  var R=pts.map(function(p){ var x=p.x-ox, y=p.y-oy; return [x*ct-y*st, x*st+y*ct]; });
  var xs=R.map(function(p){return p[0];}), ys=R.map(function(p){return p[1];});
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs), minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  var w=(maxX-minX)||1, h=(maxY-minY)||1, RW=W-2*M, RH=H-2*M;
  var escala=null;
  for(var e=0;e<ESCALAS.length;e++){ if(w*1000/ESCALAS[e]<=RW && h*1000/ESCALAS[e]<=RH){ escala=ESCALAS[e]; break; } }
  if(!escala) escala=Math.ceil(Math.max(w*1000/RW, h*1000/RH)/1000)*1000;
  var k=1000/escala, cx=W/2, cy=M+RH/2, mx=(minX+maxX)/2, my=(minY+maxY)/2;
  var P=R.map(function(p){ return [cx+(p[0]-mx)*k, cy-(p[1]-my)*k]; });

  var s2=0;
  for(var i=0;i<n;i++){ var j=(i+1)%n; s2+=P[i][0]*P[j][1]-P[j][0]*P[i][1]; }
  var lados=segs.map(function(sg,i){
    var a=P[i], b=P[(i+1)%n], dx=b[0]-a[0], dy=b[1]-a[1], d=Math.hypot(dx,dy)||1, ux=dx/d, uy=dy/d;
    return {a:a, b:b, ux:ux, uy:uy, nx: s2>0 ? uy : -uy, ny: s2>0 ? -ux : ux, ang:Math.atan2(dy,dx), len:d};
  });
  function pt(l,t,o){ return [l.a[0]+l.ux*t+l.nx*o, l.a[1]+l.uy*t+l.ny*o]; }
  function ptsAttr(arr){ return arr.map(function(p){ return n3(p[0])+','+n3(p[1]); }).join(' '); }
  function linha(p,q,w){ return '<line x1="'+n3(p[0])+'" y1="'+n3(p[1])+'" x2="'+n3(q[0])+'" y2="'+n3(q[1])+'" stroke="#000" stroke-width="'+w+'"/>'; }

  var out=[];
  out.push('<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'mm" height="'+H+'mm" viewBox="0 0 '+W+' '+H+'" font-family="Arial, Helvetica, sans-serif">');
  out.push('<defs><clipPath id="quadro"><rect x="0" y="0" width="'+W+'" height="'+(H-13)+'"/></clipPath></defs>');   // rodapé (escala e notas) fica livre
  out.push('<g clip-path="url(#quadro)">');

  // ruas: faixa em todo lado que dá para rua; o nome só uma vez, no lado mais comprido, e se couber
  var ruas=[];
  lados.forEach(function(l,i){
    var s=estado.segs[i]; if(s.tipo!=='rua') return;
    var t0=-12, t1=l.len+12, o0=2.5, o1=14.5;
    out.push('<polygon points="'+ptsAttr([pt(l,t0,o0),pt(l,t1,o0),pt(l,t1,o1),pt(l,t0,o1)])+'" fill="#efefef" stroke="none"/>');
    out.push(linha(pt(l,t0,o0), pt(l,t1,o0), .3));
    out.push(linha(pt(l,t0,o1), pt(l,t1,o1), .3));
    var rua=nomeRua(s,c); if(rua) ruas.push({l:l, nome:rua});
  });
  ruas.sort(function(a,b){ return b.l.len-a.l.len; });
  var rotuladas={};
  ruas.forEach(function(r){
    var chave=normaliza(r.nome); if(rotuladas[chave]) return;
    if(r.nome.length*3.4*0.68 > r.l.len+20) return;
    rotuladas[chave]=true;
    var m=pt(r.l,r.l.len/2,8.5);
    out.push(textoGirado(m[0],m[1],r.l.ang,maiusc(r.nome),'font-size="3.4" font-weight="bold" letter-spacing=".3"'));
  });
  out.push('</g>');

  // lote
  out.push('<polygon points="'+ptsAttr(P)+'" fill="#fafafa" stroke="#000" stroke-width=".5" stroke-linejoin="round"/>');

  // confrontantes (lotes e outros)
  lados.forEach(function(l,i){
    var s=estado.segs[i]; if(s.tipo==='rua') return;
    var v=(s.valor||'').trim(); if(!v) return;
    var txt = s.tipo==='lote' ? 'LOTE '+maiusc(numeroLote(v)) : maiusc(v);
    var m=pt(l,l.len/2,5.2);
    out.push(textoGirado(m[0],m[1],l.ang,txt,'font-size="3.1" fill="#333"'));
  });

  // medidas
  lados.forEach(function(l,i){
    var m=pt(l,l.len/2,-2.4);
    out.push(textoGirado(m[0],m[1],l.ang,fmt(segs[i].d)+' m','font-size="2.8"'));
  });

  // vértices
  P.forEach(function(p,i){
    var la=lados[(i-1+n)%n], lb=lados[i], bx=la.nx+lb.nx, by=la.ny+lb.ny, bl=Math.hypot(bx,by);
    if(bl<1e-6){ bx=lb.nx; by=lb.ny; bl=1; }
    var q=[p[0]+bx/bl*3.3, p[1]+by/bl*3.3];
    out.push('<circle cx="'+n3(p[0])+'" cy="'+n3(p[1])+'" r=".75" fill="#000"/>');
    out.push('<text x="'+n3(q[0])+'" y="'+n3(q[1])+'" text-anchor="middle" dominant-baseline="central" font-size="3" font-weight="bold">'+esc(pts[i].nome)+'</text>');
  });

  // identificação dentro do lote
  var polo=poloInterno(P), fz=Math.max(.45, Math.min(1, polo.d/8));
  var lt=(c.lote||'').trim();
  if(lt){
    out.push('<text x="'+n3(polo.p[0])+'" y="'+n3(polo.p[1]-2.6*fz)+'" text-anchor="middle" dominant-baseline="central" font-size="'+n3(5.4*fz)+'" font-weight="bold">LOTE '+esc(maiusc(lt))+'</text>');
    out.push('<text x="'+n3(polo.p[0])+'" y="'+n3(polo.p[1]+3.2*fz)+'" text-anchor="middle" dominant-baseline="central" font-size="'+n3(3.2*fz)+'">'+fmt(geo.area)+' m²</text>');
  } else {
    out.push('<text x="'+n3(polo.p[0])+'" y="'+n3(polo.p[1])+'" text-anchor="middle" dominant-baseline="central" font-size="'+n3(3.4*fz)+'">'+fmt(geo.area)+' m²</text>');
  }

  // quadra, em destaque
  var qd=(c.quadra||'').trim();
  if(qd){
    out.push('<rect x="3" y="3" width="32" height="22" fill="#fff" stroke="#000" stroke-width=".6"/>');
    out.push('<text x="19" y="8" text-anchor="middle" dominant-baseline="central" font-size="3.2" font-weight="bold" letter-spacing=".6">QUADRA</text>');
    out.push('<text x="19" y="17.6" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="bold"'+(qd.length>3?' textLength="28" lengthAdjust="spacingAndGlyphs"':'')+'>'+esc(maiusc(qd))+'</text>');
  }

  // norte (da quadrícula UTM, ou do plano local)
  var sxn=-st, syn=-ct;          // direção do norte na tela (y para baixo)
  var alfa=Math.atan2(sxn,-syn)*180/Math.PI, ncx=W-13, ncy=15;
  out.push('<g transform="rotate('+alfa.toFixed(2)+' '+ncx+' '+ncy+')">'+
    '<polygon points="'+ncx+','+(ncy-8)+' '+(ncx+3.2)+','+(ncy+5)+' '+ncx+','+(ncy+2.6)+'" fill="#000"/>'+
    '<polygon points="'+ncx+','+(ncy-8)+' '+(ncx-3.2)+','+(ncy+5)+' '+ncx+','+(ncy+2.6)+'" fill="#fff" stroke="#000" stroke-width=".3"/>'+
    '</g>');
  out.push('<text x="'+n3(ncx+sxn*11.5)+'" y="'+n3(ncy+syn*11.5)+'" text-anchor="middle" dominant-baseline="central" font-size="3.8" font-weight="bold">N</text>');

  // escala gráfica
  var Lm=[1,2,5,10,20,50,100,200,500,1000,2000,5000].filter(function(v){ return v*k<=45; }).pop() || 1;
  var bw=Lm*k, bx0=6, by0=H-9;
  for(var q=0;q<4;q++){
    out.push('<rect x="'+n3(bx0+q*bw/4)+'" y="'+by0+'" width="'+n3(bw/4)+'" height="1.6" fill="'+(q%2?'#fff':'#000')+'" stroke="#000" stroke-width=".25"/>');
  }
  out.push('<text x="'+bx0+'" y="'+(by0-1.6)+'" text-anchor="middle" font-size="2.4">0</text>');
  out.push('<text x="'+n3(bx0+bw/2)+'" y="'+(by0-1.6)+'" text-anchor="middle" font-size="2.4">'+fmt(Lm/2, Lm%2?1:0)+'</text>');
  out.push('<text x="'+n3(bx0+bw)+'" y="'+(by0-1.6)+'" text-anchor="middle" font-size="2.4">'+Lm+' m</text>');
  out.push('<text x="'+bx0+'" y="'+(by0+5.2)+'" font-size="2.8" font-weight="bold">ESCALA 1:'+escala.toLocaleString('pt-BR')+'</text>');

  // notas
  out.push('<text x="'+(W-4)+'" y="'+(H-7.2)+'" text-anchor="end" font-size="2.4" fill="#333">Medidas em metros · Área: '+fmt(geo.area)+' m² · Perímetro: '+fmt(geo.perimetro)+' m</text>');
  out.push('<text x="'+(W-4)+'" y="'+(H-3.6)+'" text-anchor="end" font-size="2.4" fill="#333">'+esc(textoSistema(L,c))+'</text>');

  out.push('<rect x=".25" y=".25" width="'+(W-.5)+'" height="'+(H-.5)+'" fill="none" stroke="#000" stroke-width=".5"/>');
  out.push('</svg>');
  return {svg:out.join(''), escala:escala};
}

/* ================================================================
   Folhas
   ================================================================ */
function vz(x){ return x ? esc(x) : '<span class="vazio">—</span>'; }
function blocoAssinatura(titulo, linhas){
  return '<div class="assinatura"><div class="traco"></div>'+linhas.filter(Boolean).map(function(l,i){ return i===0 ? '<b>'+esc(l)+'</b>' : esc(l); }).join('<br>')+(titulo?'<br><span style="font-size:7.5pt">'+esc(titulo)+'</span>':'')+'</div>';
}
function linhasRT(c){
  return [c.rtNome||' ', c.rtTitulo, c.rtCrea && (/crea/i.test(c.rtCrea) ? c.rtCrea : 'CREA '+c.rtCrea), c.rtArt && 'ART/TRT '+c.rtArt];
}
function linhasProp(c){ return [c.propNome||' ', c.propDoc && U.rotuloDoc(c.propDoc)+' '+U.fmtDoc(c.propDoc)]; }

function renderPlanta(c, L, geo){
  $('plSub').textContent=[c.lote&&'Lote '+c.lote, c.quadra&&'Quadra '+c.quadra, c.logradouro, c.setor, c.municipio].filter(Boolean).join(' · ');
  var d = geo ? desenhar(c, L, geo) : {svg:svgVazio(186,170), escala:null};
  $('desenho').innerHTML=d.svg;
  var ass=blocoAssinatura('Responsável técnico', linhasRT(c));
  if(c.assinaProp) ass+=blocoAssinatura('Proprietário', linhasProp(c));
  $('carimbo').innerHTML=
    '<tr><td colspan="3"><i>Proprietário</i>'+vz(c.propNome)+'</td><td><i>'+U.rotuloDoc(c.propDoc)+'</i>'+vz(U.fmtDoc(c.propDoc))+'</td></tr>'+
    '<tr><td colspan="4"><i>Endereço</i>'+vz(c.enderecoExtenso)+'</td></tr>'+
    '<tr><td><i>Lote</i>'+vz(c.lote)+'</td><td><i>Quadra</i>'+vz(c.quadra)+'</td><td><i>Setor / bairro</i>'+vz(c.setor)+'</td><td><i>Município</i>'+vz(c.municipio)+'</td></tr>'+
    '<tr><td><i>Área</i>'+(geo?fmt(geo.area)+' m²':vz(''))+'</td><td><i>Perímetro</i>'+(geo?fmt(geo.perimetro)+' m':vz(''))+'</td><td><i>Escala</i>'+(d.escala?'1:'+d.escala.toLocaleString('pt-BR'):vz(''))+'</td><td><i>Data</i>'+vz(U.dataCurta(c.dataDoc))+'</td></tr>'+
    '<tr><td colspan="2"><i>Responsável técnico</i>'+vz(c.rtNome)+(c.rtTitulo?'<br>'+esc(c.rtTitulo):'')+'</td><td><i>CREA</i>'+vz(c.rtCrea)+'</td><td><i>ART / TRT</i>'+vz(c.rtArt)+'</td></tr>'+
    '<tr class="ass"><td colspan="4"><div class="assinaturas">'+ass+'</div></td></tr>';
}

function renderMemorial(c, L, geo){
  var h='<div class="me-tit">MEMORIAL DESCRITIVO</div>';
  var ident=[c.lote&&'Lote '+c.lote, c.quadra&&'Quadra '+c.quadra].filter(Boolean).join(', ');
  var linhas=[
    ['Imóvel', ident],
    ['Endereço', c.enderecoExtenso],
    ['Proprietário', c.propNome],
    [U.rotuloDoc(c.propDoc), U.fmtDoc(c.propDoc)],
    ['Área', geo ? fmt(geo.area)+' m²' : ''],
    ['Perímetro', geo ? fmt(geo.perimetro)+' m' : ''],
    ['Coordenadas', textoSistema(L,c)]
  ];
  h+='<table class="me-id">'+linhas.map(function(l){ return '<tr><th>'+esc(l[0])+'</th><td>'+vz(l[1])+'</td></tr>'; }).join('')+'</table>';
  h+='<h3>DESCRIÇÃO DO IMÓVEL</h3><div class="me-desc">'+
     String(c.descricao||'').split(/\n\s*\n/).map(function(p){ p=p.trim(); return p ? '<p>'+esc(p).replace(/\n/g,'<br>')+'</p>' : ''; }).join('')+'</div>';
  if(c.quadroVertices && geo){
    var geoS=saidaGeo(c,L), loc=!L.georef;
    var c1 = loc ? 'X (m)' : geoS ? 'Latitude' : 'E (m)', c2 = loc ? 'Y (m)' : geoS ? 'Longitude' : 'N (m)';
    h+='<h3>QUADRO DE VÉRTICES</h3><table class="me-quadro"><thead><tr>'+
       '<th>Vértice</th><th>'+c1+'</th><th>'+c2+'</th><th>Lado</th><th>Azimute</th><th>Distância (m)</th><th>Confrontação</th></tr></thead><tbody>';
    geo.segs.forEach(function(sg,i){
      var p=L.pts[sg.i];
      var v1 = geoS ? Geo.gms(p.lat,'lat') : fmt(p.E), v2 = geoS ? Geo.gms(p.lon,'lon') : fmt(p.N);
      h+='<tr><td>'+esc(p.nome)+'</td><td class="num">'+v1+'</td><td class="num">'+v2+'</td>'+
         '<td>'+esc(p.nome)+'–'+esc(L.pts[sg.j].nome)+'</td><td class="num">'+U.grausMS(sg.az)+'</td><td class="num">'+fmt(sg.d)+'</td>'+
         '<td class="esq">'+esc(confrontanteCurto(estado.segs[i], c))+'</td></tr>';
    });
    h+='</tbody></table>';
  }
  var fecho=[c.municipio, U.dataExtenso(c.dataDoc)].filter(Boolean).join(', ');
  h+='<p class="me-fecho">'+esc(fecho)+(fecho?'.':'')+'</p>';
  h+='<div class="me-ass">'+blocoAssinatura('Responsável técnico', linhasRT(c))+(c.assinaProp?blocoAssinatura('Proprietário', linhasProp(c)):'')+'</div>';
  $('folhaMemorial').innerHTML=h;
}

/* ================================================================
   Conferência
   ================================================================ */
function conferir(c, L, geo){
  var av=L.avisos.slice();
  if(!L.pts.length && !av.length) av.push({t:'info', m:'Cole as coordenadas (ou importe um arquivo) para gerar o desenho.'});
  else if(L.pts.length && L.pts.length<3) av.push({t:'erro', m:'São precisos pelo menos 3 vértices.'});
  if(geo){
    if(geo.cruza){
      var a=geo.segs[geo.cruza[0]], b=geo.segs[geo.cruza[1]];
      av.push({t:'erro', m:'Os lados '+L.pts[a.i].nome+'–'+L.pts[a.j].nome+' e '+L.pts[b.i].nome+'–'+L.pts[b.j].nome+' se cruzam — confira a ordem dos pontos.'});
    }
    geo.segs.forEach(function(sg){ if(sg.d<0.005) av.push({t:'erro', m:'Os vértices '+L.pts[sg.i].nome+' e '+L.pts[sg.j].nome+' estão no mesmo lugar.'}); });
    var semConf=[];
    geo.segs.forEach(function(sg,i){ if(!confrontanteCurto(estado.segs[i], c)) semConf.push(L.pts[sg.i].nome+'–'+L.pts[sg.j].nome); });
    if(semConf.length) av.push({t:'aviso', m:'Sem confrontante: '+semConf.join(', ')+'.'});
  }
  var falta=[];
  [['lote','lote'],['quadra','quadra'],['logradouro','rua da frente'],['setor','setor'],['propNome','proprietário'],['propDoc','CPF/CNPJ'],['rtNome','responsável técnico'],['rtCrea','CREA']].forEach(function(f){ if(!String(c[f[0]]||'').trim()) falta.push(f[1]); });
  if(falta.length) av.push({t:'aviso', m:'Falta preencher: '+falta.join(', ')+'.'});
  if(c.propDoc && !U.docValido(c.propDoc)) av.push({t:'erro', m:U.rotuloDoc(c.propDoc)+' do proprietário com dígito verificador inválido ou tamanho errado.'});
  if(estado.descricaoManual) av.push({t:'info', m:'A descrição foi editada à mão: mudanças nas coordenadas ou nos campos não entram nela.'});
  if(geo && !av.some(function(x){ return x.t==='erro'||x.t==='aviso'; })) av.unshift({t:'ok', m:'Tudo preenchido.'});
  $('avisos').innerHTML=av.map(function(x){ return '<li class="'+x.t+'">'+esc(x.m)+'</li>'; }).join('');
}

function resumoLeitura(c, L){
  if(!L.familia) return '';
  var p=['<b>'+L.pts.length+' vértice'+(L.pts.length===1?'':'s')+'</b>', esc(L.formatoLido)+(c.formato==='auto'?' (detectado)':'')];
  if(L.georef){
    var D=Geo.DATUMS[L.datumOrigem];
    p.push('datum '+esc(D.nome)+(L.datumDetectado?' (lido)':c.datum==='auto'?' (padrão)':''));
    p.push(L.familia==='utm' ? 'fuso '+L.fuso+L.hemi+(L.fusoDoArquivo?' (lido)':'') : 'UTM fuso '+L.fuso+L.hemi+' calculado');
  }
  if(L.altitudeLida!==null && isFinite(L.altitudeLida)) p.push('altitude média '+fmt(L.altitudeLida,1)+' m');
  return p.join(' · ');
}

/* ================================================================
   Ciclo
   ================================================================ */
var agendado=false;
function agendar(){ if(agendado) return; agendado=true; setTimeout(function(){ agendado=false; atualizar(); }, 0); }

function atualizar(){
  var c=lerCampos();
  var alt=U.parseNum(c.altitude);
  var L=Coord.ler(c.coords, {formato:c.formato, datum:c.datum, fuso:+c.fuso, hemi:c.hemisferio, plano:c.plano, altitude:isNaN(alt)?null:alt});
  var geo = L.pts.length>=3 ? geometria(L.pts) : null;

  // campos que dependem do que foi lido
  var pedeFuso = L.familia==='utm' && !L.fusoDoArquivo;
  $('boxFuso').classList.toggle('oculto', !pedeFuso);
  $('boxHemi').classList.toggle('oculto', !pedeFuso);
  $('boxAlt').classList.toggle('oculto', !(L.georef && c.plano==='sgl'));
  $('altitude').placeholder = L.altitudeLida!==null && isFinite(L.altitudeLida) ? fmt(L.altitudeLida,1)+' (lida)' : '0';
  $('linhaFuso').classList.toggle('oculto', !pedeFuso && !(L.georef && c.plano==='sgl'));
  $('plano').disabled = L.familia==='local';
  $('datum').disabled = L.familia==='local';
  $('coordSaida').disabled = !L.georef;
  $('leitura').innerHTML=resumoLeitura(c, L);

  if(geo){
    sincronizarSegs(L.pts.length);
    var auto=classificar(geo, estado.frenteIdx);
    estado.segs.forEach(function(s,i){ if(i<auto.length && !s.classeManual) s.classe=auto[i]; });
  }
  montarTabelaSegs(L, geo);

  var endAuto=gerarEndereco(c);
  if(!estado.enderecoManual){ $('enderecoExtenso').value=endAuto; c.enderecoExtenso=endAuto; }
  $('notaEndereco').classList.toggle('oculto', !estado.enderecoManual);

  if(!estado.descricaoManual){ var d = geo ? gerarDescricao(c, L, geo) : ''; $('descricao').value=d; c.descricao=d; }
  $('notaDescricao').classList.toggle('oculto', !estado.descricaoManual);

  var st=$('propDocStatus');
  if(!c.propDoc) st.innerHTML='';
  else if(U.docValido(c.propDoc)) st.innerHTML='<span class="doc-ok">✓ '+U.rotuloDoc(c.propDoc)+' válido</span>';
  else st.innerHTML='<span class="doc-erro">✗ dígito verificador não confere</span>';

  renderPlanta(c, L, geo);
  renderMemorial(c, L, geo);
  conferir(c, L, geo);

  gravarStorage(CHAVE_RASCUNHO, {campos:c, estado:estado});
  if(c.rtLembrar){ var rt={}; CAMPOS_RT.forEach(function(k){ rt[k]=c[k]; }); gravarStorage(CHAVE_RT, rt); }
}

function ajustarZoom(){
  var pv=$('preview'), largura=pv.clientWidth-32, px=210*96/25.4;
  $('paginas').style.zoom=Math.min(1, Math.max(.3, largura/px));
}

/* ================================================================
   Eventos
   ================================================================ */
function aplicar(campos, est){
  porCampos(campos);
  estado = est ? {segs:(est.segs||[]).map(function(s){ return {classe:s.classe||'', tipo:s.tipo||'lote', valor:s.valor||'', classeManual:!!s.classeManual}; }),
                  frenteIdx:est.frenteIdx||0, descricaoManual:!!est.descricaoManual, enderecoManual:!!est.enderecoManual}
               : estadoNovo();
  chaveTabela='';
  atualizar();
}

function novoImovel(perguntar){
  if(perguntar && !confirm('Apagar os dados deste imóvel e começar outro?')) return;
  var c=camposPadrao();
  var rt=lerStorage(CHAVE_RT);
  if(rt){ CAMPOS_RT.forEach(function(k){ c[k]=rt[k]||''; }); c.rtLembrar=true; }
  aplicar(c, null);
}

function exemplo(){
  var c=lerCampos(), base=camposPadrao();
  CAMPOS_RT.concat(['rtLembrar']).forEach(function(k){ base[k]=c[k]; });
  base.coords='A  701200,00  8039500,00\nB  701214,10  8039505,13\nC  701200,41  8039542,72\nD  701186,32  8039537,59';
  base.lote='25'; base.quadra='25'; base.logradouro='Rua 25'; base.setor='Setor São Francisco de Assis';
  aplicar(base, {frenteIdx:0, segs:[
    {tipo:'rua', valor:''}, {tipo:'lote', valor:'26'}, {tipo:'lote', valor:'10'}, {tipo:'lote', valor:'24'}
  ]});
}

function nomeArquivo(c){
  var p=['memorial'];
  if(c.lote) p.push('lote-'+c.lote);
  if(c.quadra) p.push('qd-'+c.quadra);
  return p.join('_').replace(/[^\w\-]+/g,'-');
}
function salvar(){
  var c=lerCampos();
  var dados={app:'planta-memorial', versao:1, campos:c, estado:estado};
  var blob=new Blob([JSON.stringify(dados,null,2)],{type:'application/json'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=nomeArquivo(c)+'.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
}
function lerArquivo(arq, feito){
  var fr=new FileReader();
  fr.onload=function(){ feito(String(fr.result)); };
  fr.readAsText(arq);
}
function abrirProjeto(arq){
  lerArquivo(arq, function(txt){
    try{
      var d=JSON.parse(txt);
      if(d.app!=='planta-memorial' || !d.campos) throw new Error('formato');
      aplicar(Object.assign(camposPadrao(), d.campos), d.estado);
    }catch(e){ alert('Este arquivo não é um projeto salvo por este gerador.'); }
  });
}
function importarCoordenadas(arq){
  if(/\.kmz$/i.test(arq.name)){ alert('KMZ é um KML compactado: abra-o no Google Earth e salve como KML, ou extraia o .kml de dentro do .kmz.'); return; }
  lerArquivo(arq, function(txt){
    $('coords').value=Coord.arquivoParaTexto(txt, arq.name);
    agendar();
  });
}

function imprimir(modo){
  document.body.classList.remove('so-planta','so-memorial');
  if(modo) document.body.classList.add(modo);
  window.print();
}
window.addEventListener('afterprint', function(){ document.body.classList.remove('so-planta','so-memorial'); });

document.addEventListener('input', function(ev){
  var t=ev.target;
  if(t.id==='descricao'){ estado.descricaoManual=true; }
  else if(t.id==='enderecoExtenso'){ estado.enderecoManual=true; }
  else if(t.classList.contains('valor')){ var i=+t.closest('tr').dataset.i; estado.segs[i].valor=t.value; }
  agendar();
});
document.addEventListener('change', function(ev){
  var t=ev.target, tr=t.closest && t.closest('#tbSegs tr');
  if(tr){
    var i=+tr.dataset.i, s=estado.segs[i];
    if(t.name==='frente'){
      var antiga=estado.segs[estado.frenteIdx];
      if(antiga && antiga.tipo==='rua' && !antiga.valor) antiga.tipo='lote';
      estado.frenteIdx=i;
      estado.segs.forEach(function(x){ x.classeManual=false; });
      if(s.tipo==='lote' && !s.valor) s.tipo='rua';
    } else if(t.classList.contains('classe')){ s.classe=t.value; s.classeManual=true; }
    else if(t.classList.contains('tipo')){ s.tipo=t.value; }
  }
  if(t.id==='rtLembrar' && !t.checked) gravarStorage(CHAVE_RT, null);
  if(t.id==='propDoc') t.value=U.fmtDoc(t.value);
  agendar();
});
$('propDoc').addEventListener('blur', function(){ this.value=U.fmtDoc(this.value); agendar(); });
$('btRegenDesc').addEventListener('click', function(){ estado.descricaoManual=false; atualizar(); });
$('btRegenEnd').addEventListener('click', function(){ estado.enderecoManual=false; atualizar(); });
$('btNovo').addEventListener('click', function(){ novoImovel(true); });
$('btExemplo').addEventListener('click', exemplo);
$('btSalvar').addEventListener('click', salvar);
$('btAbrir').addEventListener('click', function(){ $('arqAbrir').value=''; $('arqAbrir').click(); });
$('arqAbrir').addEventListener('change', function(){ if(this.files[0]) abrirProjeto(this.files[0]); });
$('btImportar').addEventListener('click', function(){ $('arqCoords').value=''; $('arqCoords').click(); });
$('arqCoords').addEventListener('change', function(){ if(this.files[0]) importarCoordenadas(this.files[0]); });
$('btImpPlanta').addEventListener('click', function(){ imprimir('so-planta'); });
$('btImpMemorial').addEventListener('click', function(){ imprimir('so-memorial'); });
$('btImpTudo').addEventListener('click', function(){ imprimir(null); });
window.addEventListener('resize', ajustarZoom);

// arrastar um arquivo de coordenadas para a caixa de texto
$('coords').addEventListener('dragover', function(ev){ ev.preventDefault(); });
$('coords').addEventListener('drop', function(ev){
  var f=ev.dataTransfer && ev.dataTransfer.files[0]; if(!f) return;
  ev.preventDefault(); importarCoordenadas(f);
});

/* ---------- início ---------- */
var rasc=lerStorage(CHAVE_RASCUNHO);
if(rasc && rasc.campos) aplicar(Object.assign(camposPadrao(), rasc.campos), rasc.estado);
else novoImovel(false);
ajustarZoom();

window.__app={estado:function(){ return estado; }, geometria:geometria, classificar:classificar};
})();
