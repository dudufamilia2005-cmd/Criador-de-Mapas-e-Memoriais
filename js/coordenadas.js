/* Leitura de coordenadas em vários formatos. Global: Coord.

   Entra: texto colado ou arquivo (TXT, CSV, planilha, KML, GPX, NMEA).
   Sai: vértices em SIRGAS 2000 — UTM (E, N) e geodésicas (lat, lon) — ou em coordenadas locais.

   Famílias:
     utm   — Este/Norte projetados (com ou sem fuso na linha)
     geo   — geodésicas: graus decimais, graus e minutos, graus/minutos/segundos, NMEA
     ecef  — geocêntricas cartesianas X, Y, Z (saída de processamento GNSS)
     local — X/Y em metros sem georreferência                                         */
var Coord = (function(){
'use strict';
var parseNum=U.parseNum;

function semAcento(s){ return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }
function casas(raw){ var m=/[.,](\d+)$/.exec(raw||''); return m ? m[1].length : 0; }
function inteiro(x){ return !!x && /^[-+]?\d+$/.test(x.raw); }
function letra(i){ var s=''; i++; while(i>0){ var r=(i-1)%26; s=String.fromCharCode(65+r)+s; i=Math.floor((i-1)/26); } return s; }

var BANDAS='CDEFGHJKLMNPQRSTUVWX';
// "22S" no Brasil quer dizer fuso 22 Sul (a banda S de verdade fica no hemisfério norte, fora do país)
function hemiDaBanda(b){
  if(!b) return null; b=b.toUpperCase();
  if(b==='S' || b==='N') return b;
  return BANDAS.indexOf(b)>=0 ? (b<'N' ? 'S' : 'N') : null;
}

/* ================================================================
   KML, GPX e NMEA
   ================================================================ */
function ehXml(t){ return /^\s*<(\?xml|kml|gpx)/i.test(t) || /<(\w+:)?coordinates>|<wpt\b|<trkpt\b/i.test(t); }
function textoXml(s){
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').trim();
}
function tuplaKml(tr, n, nome){
  var p=tr.split(','); if(p.length<2) return null;
  var lon=parseFloat(p[0]), lat=parseFloat(p[1]), h=p[2]!==undefined ? parseFloat(p[2]) : undefined;
  if(!isFinite(lat) || !isFinite(lon)) return null;
  return {n:n, nome:nome||'', fam:'geo', sub:'kml', lat:lat, lon:lon, h:isFinite(h)?h:undefined};
}
function lerKml(t){
  var regs=[];
  // o contorno do polígono (ou da linha) vence pontos soltos
  var pol=/<(?:\w+:)?(?:Polygon|LinearRing)\b[\s\S]*?<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/i.exec(t)
       || /<(?:\w+:)?LineString\b[\s\S]*?<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/i.exec(t);
  if(pol){
    pol[1].trim().split(/\s+/).forEach(function(tr,i){ var r=tuplaKml(tr,i+1,''); if(r) regs.push(r); });
    return regs;
  }
  var re=/<(?:\w+:)?Placemark\b[\s\S]*?<\/(?:\w+:)?Placemark>/gi, m, i=0;
  while((m=re.exec(t))){
    var c=/<(?:\w+:)?Point\b[\s\S]*?<(?:\w+:)?coordinates>([\s\S]*?)<\//i.exec(m[0]); if(!c) continue;
    var nm=/<(?:\w+:)?name>([\s\S]*?)<\//i.exec(m[0]);
    var r=tuplaKml(c[1].trim(), ++i, nm ? textoXml(nm[1]) : ''); if(r) regs.push(r);
  }
  return regs;
}
function lerGpx(t){
  var regs=[], re=/<(wpt|rtept|trkpt)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi, m, i=0;
  while((m=re.exec(t))){
    var lat=/\blat\s*=\s*["']([^"']+)/i.exec(m[2]), lon=/\blon\s*=\s*["']([^"']+)/i.exec(m[2]);
    if(!lat || !lon) continue;
    var corpo=m[3]||'', nm=/<name>([\s\S]*?)<\/name>/i.exec(corpo), el=/<ele>([\s\S]*?)<\/ele>/i.exec(corpo);
    var h=el ? parseFloat(el[1]) : undefined;
    regs.push({n:++i, nome:nm ? textoXml(nm[1]) : '', fam:'geo', sub:'gpx', lat:parseFloat(lat[1]), lon:parseFloat(lon[1]), h:isFinite(h)?h:undefined});
  }
  return regs;
}
// $GPGGA,123519,1743.3507,S,04906.1592,W,1,08,0.9,770.4,M,...  (graus e minutos: ddmm.mmmm)
function lerNmea(s, n){
  var c=s.split('*')[0].split(','), tipo=c[0].slice(-3).toUpperCase();
  var i = (tipo==='GGA' || tipo==='GNS') ? 2 : tipo==='RMC' ? 3 : tipo==='GLL' ? 1 : -1;
  if(i<0 || !c[i] || !c[i+2]) return null;
  function ddm(v){ var x=parseFloat(v), d=Math.floor(x/100); return d+(x-d*100)/60; }
  var lat=ddm(c[i])*(/S/i.test(c[i+1])?-1:1), lon=ddm(c[i+2])*(/W/i.test(c[i+3])?-1:1);
  var h=(tipo==='GGA' || tipo==='GNS') ? parseFloat(c[9]) : NaN;
  if(!isFinite(lat) || !isFinite(lon)) return null;
  return {n:n, nome:'', fam:'geo', sub:'nmea', lat:lat, lon:lon, h:isFinite(h)?h:undefined};
}

/* ================================================================
   Linhas: separador, cabeçalho e nome do vértice
   ================================================================ */
function separar(linha){
  if(linha.indexOf('\t')>=0) return {sep:'\t', cells:linha.split('\t')};
  if(linha.indexOf(';')>=0) return {sep:';', cells:linha.split(';')};
  if(linha.indexOf(',')>=0){
    // vírgula separa colunas quando o decimal é ponto, quando é cabeçalho, ou em "P1,701200,8039500"
    var semDig=!/\d/.test(linha), pontoDec=/\d\.\d/.test(linha), semEsp=!/\s/.test(linha.trim());
    if(semDig || pontoDec || (semEsp && linha.match(/,/g).length>=2)) return {sep:',', cells:linha.split(',')};
  }
  return {sep:' ', cells:linha.trim().split(/\s+/)};
}
function separarCom(linha, sep){ return sep===' ' ? linha.trim().split(/\s+/) : linha.split(sep); }

var COLUNAS=[
  ['ignorar', /(sigma|σ|desvio|precis|rms|std|dop\b|^sat|^data$|^date$|hora|^time|solu|status|^tipo|metodo|limite|antena|antenna|^obs|^descr|^origin|^cs\b|^ratio|^age|^base\b|^q$)/],
  ['nome',  /^(nome|name|ponto|pto|pt|point|vertice|vertices|marco|codigo|code|id|estacao|station|label|identificador)$/],
  ['lat',   /^(lat|latitude)\b/],
  ['lon',   /^(lon|long|longitude|lng)\b/],
  ['E',     /^(e|este|leste|easting|east|coord(enada)? e|e utm|utm e|x utm|utm x|me)$/],
  ['N',     /^(n|norte|northing|north|coord(enada)? n|n utm|utm n|y utm|utm y|mn)$/],
  ['X',     /^x$/], ['Y', /^y$/], ['Z', /^z$/],
  ['h',     /^(h|alt|altitude|altura|cota|elev|elevacao|elevation|height|ellipsoidal height|altitude elipsoidal|altitude ortometrica)\b/],
  ['fuso',  /^(fuso|zona|zone|utm zone)$/],
  ['hemi',  /^(hemisferio|hemisphere|hem)$/]
];
function tipoColuna(cel){
  var k=semAcento(cel).replace(/[\(\[].*?[\)\]]/g,'').replace(/[_.\-:]+/g,' ').replace(/\s+/g,' ').trim();
  if(!k) return null;
  for(var i=0;i<COLUNAS.length;i++) if(COLUNAS[i][1].test(k)) return COLUNAS[i][0];
  return null;
}
function cabecalho(sp){
  if(sp.cells.length<2) return null;
  var idx={}, numericas=0;
  sp.cells.forEach(function(cel,i){
    var c=cel.trim(); if(!c) return;
    if(/^[-+]?\d+([.,]\d+)?$/.test(c)) numericas++;
    var t=tipoColuna(c);
    if(t && t!=='ignorar' && idx[t]===undefined) idx[t]=i;
  });
  if(numericas) return null;
  var ok=(idx.lat!==undefined && idx.lon!==undefined) || (idx.E!==undefined && idx.N!==undefined) || (idx.X!==undefined && idx.Y!==undefined);
  return ok ? {idx:idx, sep:sp.sep} : null;
}

// um ângulo só: -17.7225 · 17°43'21,04"S · S 17 43 21.04 · 17:43:21.04 · 17°43,3507'
function lerAngulo(s){
  s=String(s||'').replace(/−/g,'-').trim(); if(!s) return NaN;
  var hm=/(?:^|[^A-Za-z])([NSEWOL])(?![A-Za-z])/i.exec(s), hemi=hm ? hm[1].toUpperCase() : '';
  var ns=s.match(/[-+]?\d+(?:[.,]\d+)?/g); if(!ns || ns.length>3) return NaN;
  var v=ns.map(parseNum); if(v.some(isNaN)) return NaN;
  var m=Math.abs(v[1]||0), sg=Math.abs(v[2]||0); if(m>=60 || sg>=60) return NaN;
  var r=Math.abs(v[0])+m/60+sg/3600;
  var neg=/^-/.test(ns[0]) || (hemi!=='' && 'SWO'.indexOf(hemi)>=0);
  return neg ? -r : r;
}
function fusoDeTexto(s){
  var m=/(\d{1,2})\s*([A-Za-z])?/.exec(String(s||'')); if(!m) return null;
  var f=+m[1]; return (f>=1 && f<=60) ? {fuso:f, hemi:hemiDaBanda(m[2])} : null;
}

function lerPorCabecalho(cells, cab, n){
  function val(t){ var i=cab.idx[t]; return i===undefined ? '' : String(cells[i]||'').trim(); }
  var nome=val('nome'), h=parseNum(val('h')); if(isNaN(h)) h=undefined;
  var I=cab.idx;
  if(I.lat!==undefined && I.lon!==undefined){
    var lat=lerAngulo(val('lat')), lon=lerAngulo(val('lon'));
    if(isNaN(lat) || isNaN(lon)) return null;
    return {n:n, nome:nome, fam:'geo', sub:'cab', lat:lat, lon:lon, h:h};
  }
  var fz=fusoDeTexto(val('fuso')), hemi=val('hemi') ? (/^s/i.test(val('hemi'))?'S':'N') : (fz && fz.hemi);
  if(I.E!==undefined && I.N!==undefined){
    var E=parseNum(val('E')), N=parseNum(val('N'));
    if(isNaN(E) || isNaN(N)) return null;
    return {n:n, nome:nome, fam:Math.max(Math.abs(E),Math.abs(N))>=1e5?'utm':'local', sub:'cab',
            a:{v:E,rot:'E'}, b:{v:N,rot:'N'}, h:h, fuso:fz&&fz.fuso, hemi:hemi};
  }
  var X=parseNum(val('X')), Y=parseNum(val('Y')), Z=parseNum(val('Z'));
  if(isNaN(X) || isNaN(Y)) return null;
  if(!isNaN(Z)){
    var r=Math.hypot(X,Y,Z);
    if(r>6.3e6 && r<6.42e6) return {n:n, nome:nome, fam:'ecef', sub:'cab', X:X, Y:Y, Z:Z};
    if(h===undefined) h=Z;
  }
  return {n:n, nome:nome, fam:Math.max(Math.abs(X),Math.abs(Y))>=1e5?'utm':'local', sub:'cab',
          a:{v:X,rot:'E'}, b:{v:Y,rot:'N'}, h:h, fuso:fz&&fz.fuso, hemi:hemi};
}

function pareceCoordenada(t){
  return /^[-+]?\d/.test(t) ||
         /^[NSEWOL]\s*[-+]?\d+(?:[.,]\d+|\s*[°º:])/i.test(t) ||
         /^(LATITUDE|LAT|LONGITUDE|LONG|LON|ALTITUDE|ALT|ELEV|E|N|X|Y|Z|H)\s*[:=]/i.test(t) ||
         /^(fuso|zona|zone|utm)$/i.test(t);
}
function separarNome(sp){
  var cells=sp.cells.map(function(c){ return c.trim(); }).filter(Boolean), nome=[];
  if(sp.sep!==' '){
    if(cells.length && !pareceCoordenada(cells[0])) nome.push(cells.shift());
  } else {
    while(cells.length && !pareceCoordenada(cells[0])){
      if(/^[NSEWOLXY]$/i.test(cells[0]) && cells[1] && /^[-+]?\d/.test(cells[1])) break;   // hemisfério ou rótulo na frente do número
      nome.push(cells.shift());
    }
  }
  return {nome:nome.join(' ').replace(/[:=]+$/,'').trim(), resto:cells.join(' ')};
}

/* ================================================================
   Vocabulário de uma linha livre
   ================================================================ */
var RE_LEX=/\b(fuso|zona|zone)\s*[:=]?\s*(\d{1,2})\s*([A-Za-z](?![A-Za-z]))?|\b(LATITUDE|LAT|LONGITUDE|LONG|LON|ALTITUDE|ALT|ELEV|E|N|X|Y|Z|H)\s*[:=]|([-+]?\d+(?:[.,]\d+)*)\s*(''|’’|°|º|'|′|’|"|″|”|:)?|(?<![A-Za-zÀ-ÿ])(m\s?)?([A-Za-z])(?![A-Za-zÀ-ÿ])|[A-Za-zÀ-ÿ]+|\S/gi;

function simbolo(s){
  if(!s) return '';
  if(s==='°' || s==='º') return 'g';
  if(s===':') return ':';
  if(/^(''|’’|"|″|”)$/.test(s)) return 's';
  return 'm';
}
function rotulo(r){
  r=r.toUpperCase();
  if(r==='LATITUDE' || r==='LAT') return 'LAT';
  if(r==='LONGITUDE' || r==='LONG' || r==='LON') return 'LON';
  if(r==='ALTITUDE' || r==='ALT' || r==='ELEV' || r==='H') return 'H';
  return r;
}
function lex(s){
  var out=[], m;
  RE_LEX.lastIndex=0;
  while((m=RE_LEX.exec(s))){
    if(m[0]===''){ RE_LEX.lastIndex++; continue; }
    if(m[1]) out.push({t:'zona', fuso:+m[2], banda:m[3] ? m[3].toUpperCase() : null});
    else if(m[4]) out.push({t:'rot', c:rotulo(m[4])});
    else if(m[5]!==undefined) out.push({t:'num', v:parseNum(m[5]), raw:m[5], sym:simbolo(m[6])});
    else if(m[8]) out.push({t:'letra', c:m[8].toUpperCase(), m:!!m[7]});
  }
  return out;
}

/* ---------- geodésicas ---------- */
function cabeDMS(a,i){
  if(a.length<i+6 || a.length>i+7) return false;
  var d1=a[i],m1=a[i+1],s1=a[i+2],d2=a[i+3],m2=a[i+4],s2=a[i+5];
  return inteiro(d1)&&inteiro(m1)&&inteiro(d2)&&inteiro(m2) && Math.abs(d1.v)<=180 && Math.abs(d2.v)<=180 &&
         Math.abs(m1.v)<60&&Math.abs(m2.v)<60&&Math.abs(s1.v)<60&&Math.abs(s2.v)<60 && (casas(s1.raw)>0||casas(s2.raw)>0);
}
function cabeDM(a,i){
  if(a.length<i+4 || a.length>i+5) return false;
  var d1=a[i],m1=a[i+1],d2=a[i+2],m2=a[i+3];
  return inteiro(d1)&&inteiro(d2) && Math.abs(d1.v)<=180 && Math.abs(d2.v)<=180 &&
         Math.abs(m1.v)<60&&Math.abs(m2.v)<60 && casas(m1.raw)>0 && casas(m2.raw)>0;
}
function padraoGms(ns){ return cabeDMS(ns,0)||cabeDMS(ns,1)||cabeDM(ns,0)||cabeDM(ns,1); }

function valorGrupo(g){
  var n=g.nums; if(!n.length || n.length>3) return NaN;
  var m=n[1] ? Math.abs(n[1].v) : 0, s=n[2] ? Math.abs(n[2].v) : 0;
  if(m>=60 || s>=60) return NaN;
  var v=Math.abs(n[0].v)+m/60+s/3600;
  var neg=/^-/.test(n[0].raw) || g.hemi==='S' || g.hemi==='W';
  return neg ? -v : v;
}

function comoGeo(it, ordem){
  var seq=[], antes=[], depois=[], grupos=[], g=null;
  it.forEach(function(x){
    if(x.t==='num') seq.push(x);
    else if(x.t==='letra' && 'NSEWOL'.indexOf(x.c)>=0 && !x.m) seq.push({t:'hemi', c: x.c==='O'?'W' : x.c==='L'?'E' : x.c});
    else if(x.t==='rot' && (x.c==='LAT' || x.c==='LON' || x.c==='H' || x.c==='Z')) seq.push({t:'eixo', c: x.c==='Z'?'H':x.c});
  });
  var temEixo=seq.some(function(s){ return s.t==='eixo'; }), temHemi=seq.some(function(s){ return s.t==='hemi'; });

  if(temEixo){                                   // Lat: -17,72 Lon: -49,10 Alt: 770
    seq.forEach(function(s){
      if(s.t==='eixo'){ g={nums:[], eixo:s.c}; grupos.push(g); }
      else if(s.t==='hemi'){ if(g) g.hemi=s.c; }
      else if(!g) antes.push(s);
      else g.nums.push(s);
    });
    grupos=grupos.filter(function(x){ if(x.eixo==='H'){ depois=depois.concat(x.nums); return false; } return true; });
  } else if(temHemi){
    if(seq[0].t==='hemi'){                       // S 17 43 21 W 49 06 09
      seq.forEach(function(s){ if(s.t==='hemi'){ g={nums:[], hemi:s.c}; grupos.push(g); } else if(g) g.nums.push(s); else antes.push(s); });
      if(grupos.length===2 && grupos[1].nums.length===grupos[0].nums.length+1) depois.push(grupos[1].nums.pop());
    } else {                                     // 17 43 21 S 49 06 09 W
      g={nums:[]};
      seq.forEach(function(s){ if(s.t==='hemi'){ g.hemi=s.c; grupos.push(g); g={nums:[]}; } else g.nums.push(s); });
      depois=g.nums;
      if(grupos.length===2 && grupos[0].nums.length===grupos[1].nums.length+1 && inteiro(grupos[0].nums[0])) antes.push(grupos[0].nums.shift());
    }
  } else if(seq.some(function(s){ return s.sym==='g'; })){   // 17°43'21" 49°06'09"
    seq.forEach(function(s){
      if(s.sym==='g'){ g={nums:[s]}; grupos.push(g); }
      else if(!g) antes.push(s);
      else if(g.nums.length<3 && g.nums[g.nums.length-1].sym!=='s' && Math.abs(s.v)<60) g.nums.push(s);
      else depois.push(s);
    });
  } else if(seq.some(function(s){ return s.sym===':'; })){   // 17:43:21.04 -49:06:09.55
    seq.forEach(function(s,i){ var p=seq[i-1]; if(!p || p.sym!==':'){ g={nums:[s]}; grupos.push(g); } else g.nums.push(s); });
    while(grupos.length>2 && grupos[0].nums.length===1){ antes.push(grupos.shift().nums[0]); }
    while(grupos.length>2){ depois=depois.concat(grupos.pop().nums); }
  } else {                                       // só números: a quantidade diz o formato
    var a=seq, ini=0, tam=1;
    if(cabeDMS(a,0)) tam=3; else if(cabeDMS(a,1)){ tam=3; ini=1; }
    else if(cabeDM(a,0)) tam=2; else if(cabeDM(a,1)){ tam=2; ini=1; }
    else if(a.length===3 && inteiro(a[0]) && !/^[-+]/.test(a[0].raw) && !inteiro(a[1]) && !inteiro(a[2])) ini=1;
    antes=a.slice(0,ini);
    grupos=[{nums:a.slice(ini,ini+tam)}, {nums:a.slice(ini+tam,ini+2*tam)}];
    depois=a.slice(ini+2*tam);
  }

  if(grupos.length!==2) return null;
  var v0=valorGrupo(grupos[0]), v1=valorGrupo(grupos[1]);
  if(isNaN(v0) || isNaN(v1)) return null;
  function eixoDe(gr){ if(gr.eixo) return gr.eixo==='LAT'?'lat':'lon'; if(gr.hemi) return (gr.hemi==='N'||gr.hemi==='S')?'lat':'lon'; return null; }
  var e0=eixoDe(grupos[0]), e1=eixoDe(grupos[1]);
  if(!e0 && e1) e0 = e1==='lat'?'lon':'lat';
  if(!e1 && e0) e1 = e0==='lat'?'lon':'lat';
  if(!e0){
    if(ordem==='latlon'){ e0='lat'; e1='lon'; }
    else if(ordem==='lonlat'){ e0='lon'; e1='lat'; }
    else if(Math.abs(v0)>Math.abs(v1)){ e0='lon'; e1='lat'; }   // no Brasil |longitude| > |latitude|
    else { e0='lat'; e1='lon'; }
  }
  if(e0===e1) return null;
  var lat = e0==='lat' ? v0 : v1, lon = e0==='lat' ? v1 : v0;
  if(Math.abs(lat)>90 || Math.abs(lon)>180) return null;
  var tamMax=Math.max(grupos[0].nums.length, grupos[1].nums.length);
  return {lat:lat, lon:lon, h:depois.length ? depois[0].v : undefined,
          nomeNum: antes.length && inteiro(antes[0]) ? antes[0].raw : null,
          sub: tamMax===3 ? 'gms' : tamMax===2 ? 'gm' : 'gd'};
}

/* ---------- planas: UTM e locais ---------- */
function comoPlano(it, fam){
  var fuso=null, hemi=null, lista=[], pend=null;
  // rótulo na frente ("E 701200 N 8039500") ou atrás ("701200 E 8039500 N")?
  var iLetra=-1, iNum=-1;
  it.forEach(function(x,i){
    if(iLetra<0 && x.t==='letra' && 'ENXY'.indexOf(x.c)>=0) iLetra=i;
    if(iNum<0 && x.t==='num' && (Math.abs(x.v)>=100 || casas(x.raw)>0)) iNum=i;
  });
  var prefixo = iLetra>=0 && (iNum<0 || iLetra<iNum);

  for(var i=0;i<it.length;i++){
    var x=it[i], prox=it[i+1];
    if(x.t==='zona'){ fuso=x.fuso; hemi=hemiDaBanda(x.banda)||hemi; continue; }
    if(x.t==='rot'){ pend=x.c; continue; }
    if(x.t==='letra'){
      var ult=lista[lista.length-1];
      if(x.c==='S' && ult && Math.abs(ult.v)>=1000){ hemi='S'; continue; }   // Google Earth: "8039500.00 m S"
      if('ENXY'.indexOf(x.c)>=0){ if(prefixo) pend=x.c; else if(ult && !ult.rot) ult.rot=x.c; }
      continue;
    }
    if(x.t==='num'){
      // "22K 701200 8039500" · "22 K 701200.00 m E ..."
      if(!lista.length && fuso===null && /^\d{1,2}$/.test(x.raw) && x.v>=1 && x.v<=60 &&
         prox && prox.t==='letra' && !prox.m && BANDAS.indexOf(prox.c)>=0 && it[i+2] && it[i+2].t==='num'){
        fuso=x.v; hemi=hemiDaBanda(prox.c); i++; continue;
      }
      lista.push({v:x.v, raw:x.raw, rot:pend}); pend=null;
    }
  }
  var h;
  lista=lista.filter(function(x){ if(x.rot==='H' || x.rot==='Z'){ h=x.v; return false; } return true; });
  var nomeNum=null;
  if(lista.length>=3 && /^\d{1,4}$/.test(lista[0].raw) && !lista[0].rot &&
     (fam==='utm' ? Math.abs(lista[1].v)>=1000 : (casas(lista[1].raw)>0 && casas(lista[2].raw)>0))){
    nomeNum=lista.shift().raw;
  }
  if(lista.length<2) return null;
  if(h===undefined && lista[2]) h=lista[2].v;
  return {a:lista[0], b:lista[1], h:h, fuso:fuso, hemi:hemi, nomeNum:nomeNum};
}

function comoEcef(it){
  var ns=it.filter(function(x){ return x.t==='num'; }), nomeNum=null;
  if(ns.length>=4 && /^\d{1,4}$/.test(ns[0].raw)) nomeNum=ns.shift().raw;
  if(ns.length<3) return null;
  var r=Math.hypot(ns[0].v, ns[1].v, ns[2].v);
  if(r<6.3e6 || r>6.42e6) return null;
  return {X:ns[0].v, Y:ns[1].v, Z:ns[2].v, nomeNum:nomeNum};
}

// família mais provável de uma linha
function classificar(it){
  var ns=it.filter(function(x){ return x.t==='num'; });
  if(ns.length<2) return null;
  if(it.some(function(x){ return x.t==='rot' && (x.c==='LAT' || x.c==='LON'); })) return 'geo';
  if(ns.some(function(x){ return x.sym!==''; })) return 'geo';
  var grandes=ns.filter(function(x){ return Math.abs(x.v)>1e6; });
  if(grandes.length>=3){ var r=Math.hypot(grandes[0].v, grandes[1].v, grandes[2].v); if(r>6.3e6 && r<6.42e6) return 'ecef'; }
  if(ns.some(function(x){ return Math.abs(x.v)>=1e5; })) return 'utm';
  var letras=it.filter(function(x){ return x.t==='letra' && 'NSEWOL'.indexOf(x.c)>=0 && !x.m; }).map(function(x){ return x.c; });
  var dec4=ns.filter(function(x){ return casas(x.raw)>=4; }).length>=2;
  if(letras.length>=2 && (dec4 || letras.some(function(c){ return 'SWOL'.indexOf(c)>=0; }))) return 'geo';
  if(dec4 && Math.abs(ns[0].v)<=180 && Math.abs(ns[1].v)<=180) return 'geo';
  if(padraoGms(ns)) return 'geo';
  return 'local';
}

/* ================================================================
   Texto inteiro
   ================================================================ */
var NOME_FAM={utm:'UTM', geo:'geodésica', ecef:'geocêntrica', local:'local'};

function detectarDatum(t){
  var cands=[[/sad[\s\-_]*69/i,'sad69'], [/c[oó]rrego[\s\-_]*alegre/i,'ca'], [/sirgas/i,'sirgas'], [/wgs[\s\-_]*84/i,'wgs84']];
  var melhor=null, pos=Infinity;
  cands.forEach(function(c){ var m=c[0].exec(t); if(m && m.index<pos){ pos=m.index; melhor=c[1]; } });
  return melhor;
}
function detectarFuso(t){
  var m=/\b(?:utm\s*)?(?:zone|zona|fuso)\s*[:=]?\s*(\d{1,2})\s*([A-Za-z])?(?![A-Za-z])/i.exec(t) ||
        /\butm\s*(\d{1,2})\s*([A-Za-z])(?![A-Za-z])/i.exec(t);
  if(!m) return null;
  var f=+m[1]; return (f>=1 && f<=60) ? {fuso:f, hemi:hemiDaBanda(m[2])} : null;
}

function lerLinhas(texto, forc, av){
  var tipados=[], livres=[], cab=null;
  texto.split('\n').forEach(function(bruta, i){
    var n=i+1, s=bruta.trim();
    if(!s || s.charAt(0)==='#' || s.slice(0,2)==='//') return;
    if(s.charAt(0)==='$'){
      if(/^\$[A-Z]{2}(GGA|RMC|GLL|GNS)\b/i.test(s)){ var r0=lerNmea(s,n); if(r0) tipados.push(r0); }
      return;
    }
    var sp=separar(s);
    if(!cab){ var c=cabecalho(sp); if(c){ cab=c; return; } }
    if(!/\d/.test(s)) return;
    if(cab){
      // sem trim: a primeira coluna (nome) pode vir vazia
      var r1=lerPorCabecalho(separarCom(cab.sep===' ' ? s : bruta, cab.sep), cab, n);
      if(r1) tipados.push(r1); else av.push({t:'aviso', m:'Linha '+n+' não bate com as colunas do cabeçalho — ignorada.'});
      return;
    }
    var nm=separarNome(sp), it=lex(nm.resto);
    if(it.filter(function(x){ return x.t==='num'; }).length<2){
      av.push({t:'info', m:'Linha '+n+' tem menos de duas coordenadas — ignorada.'});
      return;
    }
    livres.push({n:n, nome:nm.nome, itens:it});
  });

  if(livres.length){
    var famGeral=forc.familia;
    if(!famGeral){
      var cont={};
      livres.forEach(function(l){ l.fam=classificar(l.itens); if(l.fam) cont[l.fam]=(cont[l.fam]||0)+1; });
      famGeral=['geo','utm','ecef','local'].reduce(function(m,f){ return (cont[f]||0)>(cont[m]||0) ? f : m; }, 'local');
    }
    livres.forEach(function(l){
      // no automático cada linha é lida no seu próprio tipo; quem destoar da maioria é apontado em ler()
      var fam = forc.familia || l.fam || famGeral, r=null, nomeNum=null;
      if(fam==='geo'){
        var g=comoGeo(l.itens, forc.ordemGeo);
        if(g){ r={fam:'geo', sub:g.sub, lat:g.lat, lon:g.lon, h:g.h}; nomeNum=g.nomeNum; }
      } else if(fam==='ecef'){
        var e=comoEcef(l.itens);
        if(e){ r={fam:'ecef', sub:'num', X:e.X, Y:e.Y, Z:e.Z}; nomeNum=e.nomeNum; }
      } else {
        var p=comoPlano(l.itens, fam);
        if(p){ r={fam:fam, sub:'num', a:p.a, b:p.b, h:p.h, fuso:p.fuso, hemi:p.hemi}; nomeNum=p.nomeNum; }
      }
      if(!r){ av.push({t:'aviso', m:'Linha '+l.n+' não foi entendida como coordenada '+NOME_FAM[fam]+' — ignorada.'}); return; }
      r.n=l.n; r.nome=[l.nome, nomeNum].filter(Boolean).join(' ');
      tipados.push(r);
    });
  }
  return tipados.sort(function(a,b){ return a.n-b.n; });
}

// E e N a partir dos dois números, respeitando rótulos
function atribuirEN(r, ordem){
  var ra=r.a.rot, rb=r.b.rot;
  ra = (ra==='E'||ra==='X') ? 'E' : (ra==='N'||ra==='Y') ? 'N' : null;
  rb = (rb==='E'||rb==='X') ? 'E' : (rb==='N'||rb==='Y') ? 'N' : null;
  if(ra==='E' || rb==='N') return {E:r.a.v, N:r.b.v};
  if(ra==='N' || rb==='E') return {E:r.b.v, N:r.a.v};
  return ordem==='ne' ? {E:r.b.v, N:r.a.v} : {E:r.a.v, N:r.b.v};
}

/* opc: formato ('auto'|'utm-en'|'utm-ne'|'geo-latlon'|'geo-lonlat'|'ecef'|'local'),
        fuso, hemi, datum ('auto'|'sirgas'|'wgs84'|'sad69'|'ca'), plano ('utm'|'sgl'), altitude */
function ler(texto, opc){
  opc=opc||{};
  texto=String(texto||'').replace(/\r/g,'').replace(/−/g,'-');
  var res={pts:[], avisos:[], familia:null, georef:false, formatoLido:'', ordem:null,
           fuso:null, hemi:null, fusoDoArquivo:false, datumOrigem:null, datumDetectado:false,
           plano:opc.plano||'utm', altitudeUsada:null, altitudeLida:null};
  var av=res.avisos, origem=null, regs;

  var formato=opc.formato||'auto';
  var forc={
    familia: formato==='auto' ? null : formato.slice(0,3)==='utm' ? 'utm' : formato.slice(0,3)==='geo' ? 'geo' : formato,
    ordemGeo: formato==='geo-lonlat' ? 'lonlat' : formato==='geo-latlon' ? 'latlon' : 'auto'
  };

  if(ehXml(texto)){
    origem=/<gpx\b/i.test(texto) ? 'GPX' : 'KML';
    regs = origem==='GPX' ? lerGpx(texto) : lerKml(texto);
    if(!regs.length) av.push({t:'erro', m:'Não achei coordenadas no '+origem+'.'});
  } else {
    regs=lerLinhas(texto, forc, av);
  }
  if(!regs.length) return res;

  // planilha com E/N: o formato escolhido decide entre UTM e local
  if(forc.familia==='utm' || forc.familia==='local'){
    regs.forEach(function(r){ if(r.fam==='utm' || r.fam==='local') r.fam=forc.familia; });
  }

  // uma família só
  var cont={};
  regs.forEach(function(r){ cont[r.fam]=(cont[r.fam]||0)+1; });
  var fam=['geo','utm','ecef','local'].reduce(function(m,f){ return (cont[f]||0)>(cont[m]||0) ? f : m; }, 'local');
  var fora=regs.filter(function(r){ return r.fam!==fam; });
  if(fora.length){
    av.push({t:'erro', m:'Linhas em outro tipo de coordenada foram ignoradas: '+fora.map(function(r){ return r.n; }).join(', ')+'. Use um tipo só.'});
    regs=regs.filter(function(r){ return r.fam===fam; });
  }
  res.familia=fam;
  res.georef = fam!=='local';

  // datum
  var dDet=detectarDatum(texto);
  var gnss = origem || regs.some(function(r){ return r.sub==='nmea'; });
  var datum = (opc.datum && opc.datum!=='auto') ? opc.datum : (dDet || (gnss ? 'wgs84' : 'sirgas'));
  if(res.georef){ res.datumOrigem=datum; res.datumDetectado = (!opc.datum || opc.datum==='auto') && !!(dDet || gnss); }
  var D=Geo.DATUMS[datum] || Geo.DATUMS.sirgas, transforma = datum==='sad69' || datum==='ca';

  // altitude lida
  var hs=regs.map(function(r){ return r.h; }).filter(function(h){ return h!==undefined && isFinite(h); });

  if(fam==='geo' || fam==='ecef'){
    regs.forEach(function(r){
      if(fam==='ecef'){ var g=Geo.ecefParaGeo(r.X, r.Y, r.Z, D.elip); r.lat=g.lat; r.lon=g.lon; r.h=g.h; }
      if(transforma){ var s=Geo.paraSirgas(r.lat, r.lon, r.h||0, datum); r.lat=s.lat; r.lon=s.lon; }
    });
    if(fam==='ecef') hs=regs.map(function(r){ return r.h; });
    var ruins=regs.filter(function(r){ return !(Math.abs(r.lat)<=90 && Math.abs(r.lon)<=180); });
    if(ruins.length){ av.push({t:'erro', m:'Latitude/longitude fora do intervalo nas linhas '+ruins.map(function(r){ return r.n; }).join(', ')+'.'}); regs=regs.filter(function(r){ return ruins.indexOf(r)<0; }); }
    if(!regs.length) return res;
    var mlat=0, mlon=0; regs.forEach(function(r){ mlat+=r.lat; mlon+=r.lon; });
    res.fuso=Geo.fusoDe(mlon/regs.length); res.hemi=mlat<0 ? 'S' : 'N'; res.fusoDoArquivo=true;
    regs.forEach(function(r){ var u=Geo.geoParaUtm(r.lat, r.lon, res.fuso, res.hemi); r.E=u.E; r.N=u.N; });
    var sub=regs[0].sub;
    res.formatoLido = origem ? 'arquivo '+origem
      : sub==='nmea' ? 'sentenças NMEA do receptor GNSS'
      : fam==='ecef' ? 'geocêntricas (X, Y, Z)'
      : 'geodésicas em '+({gd:'graus decimais', gm:'graus e minutos', gms:'graus, minutos e segundos', cab:'planilha'})[sub];
    if(sub==='cab') res.formatoLido = fam==='ecef' ? 'planilha com X, Y, Z geocêntricos' : 'planilha com latitude e longitude';
  } else {
    var ordem='en';
    if(forc.familia==='utm' && formato==='utm-ne') ordem='ne';
    else if(fam==='utm' && formato==='auto'){
      var sem=regs.filter(function(r){ return !r.a.rot && !r.b.rot; })[0];
      if(sem && Math.abs(sem.a.v)>Math.abs(sem.b.v)) ordem='ne';   // no hemisfério sul o Norte é sempre o maior
    }
    res.ordem=ordem;
    regs.forEach(function(r){ var en=atribuirEN(r, ordem); r.E=en.E; r.N=en.N; });
    if(fam==='utm'){
      var comFuso=regs.filter(function(r){ return r.fuso; })[0], fz=comFuso ? {fuso:comFuso.fuso, hemi:comFuso.hemi} : detectarFuso(texto);
      res.fuso = fz ? fz.fuso : (+opc.fuso || 22);
      res.hemi = (fz && fz.hemi) || regs.reduce(function(h,r){ return h || r.hemi; }, null) || opc.hemi || 'S';
      res.fusoDoArquivo=!!fz;
      regs.forEach(function(r){
        if(transforma){
          var g=Geo.utmParaGeo(r.E, r.N, res.fuso, res.hemi, D.elip), s=Geo.paraSirgas(g.lat, g.lon, r.h||0, datum);
          var u=Geo.geoParaUtm(s.lat, s.lon, res.fuso, res.hemi); r.E=u.E; r.N=u.N; r.lat=s.lat; r.lon=s.lon;
        } else {
          var g2=Geo.utmParaGeo(r.E, r.N, res.fuso, res.hemi); r.lat=g2.lat; r.lon=g2.lon;
        }
        if(r.E<100000 || r.E>900000) av.push({t:'aviso', m:'Linha '+r.n+': o Este ('+U.fmt(r.E)+') está fora da faixa da UTM — confira se E e N não estão trocados.'});
      });
      res.formatoLido = (regs[0].sub==='cab' ? 'planilha UTM' : 'UTM')+' ('+(ordem==='ne'?'N, E':'E, N')+')';
    } else {
      res.formatoLido = regs[0].sub==='cab' ? 'planilha com X, Y locais' : 'locais (X, Y)';
    }
  }

  if(res.georef){
    if(transforma) av.push({t:'info', m:'Coordenadas em '+D.nome+' convertidas para SIRGAS 2000 com os parâmetros oficiais do IBGE.'});
    if(datum==='wgs84') av.push({t:'info', m:'Coordenadas em WGS 84 (GNSS) usadas como SIRGAS 2000: a diferença é de decímetros e não muda medidas nem área.'});
  }

  // ponto de fechamento repetido
  if(regs.length>3){
    var p0=regs[0], pu=regs[regs.length-1];
    if(Math.abs(p0.E-pu.E)<0.0005 && Math.abs(p0.N-pu.N)<0.0005){
      regs.pop(); av.push({t:'info', m:'O último ponto repetia o primeiro (fechamento) e foi desconsiderado.'});
    }
  }

  // nomes: os informados, se todos tiverem e forem únicos; senão A, B, C…
  var nomes=regs.map(function(r){ return r.nome; });
  var usaNomes = nomes.every(Boolean) && new Set(nomes).size===nomes.length;

  if(hs.length) res.altitudeLida=hs.reduce(function(s,h){ return s+h; },0)/hs.length;

  var calc;
  if(res.georef && res.plano==='sgl'){
    var alt=isFinite(opc.altitude) && opc.altitude!==null && opc.altitude!=='' ? +opc.altitude : (res.altitudeLida!==null ? res.altitudeLida : 0);
    res.altitudeUsada=alt;
    calc=Geo.paraLocal(regs.map(function(r){ return {lat:r.lat, lon:r.lon}; }), alt);
  } else {
    if(!res.georef) res.plano='local';
    calc=regs.map(function(r){ return {x:r.E, y:r.N}; });
  }

  res.pts=regs.map(function(r,i){
    return {nome:usaNomes ? r.nome : letra(i), E:r.E, N:r.N, lat:r.lat, lon:r.lon, h:r.h, x:calc[i].x, y:calc[i].y};
  });
  return res;
}

// KML/GPX viram texto editável (com cabeçalho); o resto entra como veio
function arquivoParaTexto(texto, nome){
  texto=String(texto||'');
  if(!ehXml(texto)) return texto;
  var gpx=/<gpx\b/i.test(texto), regs=gpx ? lerGpx(texto) : lerKml(texto);
  if(!regs.length) return texto;
  var linhas=['# WGS 84 — importado de '+(nome || (gpx?'GPX':'KML')), 'Nome\tLatitude\tLongitude\tAltitude'];
  regs.forEach(function(r){
    linhas.push([r.nome, r.lat.toFixed(9), r.lon.toFixed(9), r.h!==undefined ? r.h.toFixed(3) : ''].join('\t'));
  });
  return linhas.join('\n');
}

return {ler:ler, arquivoParaTexto:arquivoParaTexto, lerAngulo:lerAngulo, letra:letra,
  _lex:lex, _classificar:classificar};
})();
