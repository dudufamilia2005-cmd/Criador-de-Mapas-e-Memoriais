/* Números, texto por extenso, datas e CPF/CNPJ. Global: U. */
var U = (function(){
'use strict';

function fmt(v, d){ if(d===undefined) d=2; return Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d, maximumFractionDigits:d}); }
function r2(v){ return Math.round(v*100)/100; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function maiusc(s){ return String(s||'').toLocaleUpperCase('pt-BR'); }

// Aceita 680123,45 · 680123.45 · 8.037.654,32 · 8,037,654.32 · −17,72
function parseNum(t){
  t = String(t).trim().replace(/−/g,'-').replace(/^\+/,'');
  if(!/\d/.test(t) || !/^-?[\d.,]+$/.test(t)) return NaN;
  var neg = t.charAt(0)==='-'; if(neg) t=t.slice(1);
  var temPonto=t.indexOf('.')>=0, temVirg=t.indexOf(',')>=0;
  if(temPonto && temVirg){
    if(t.lastIndexOf(',')>t.lastIndexOf('.')) t=t.replace(/\./g,'').replace(',','.');
    else t=t.replace(/,/g,'');
  } else if(temVirg){
    t = (t.match(/,/g).length>1) ? t.replace(/,/g,'') : t.replace(',','.');
  } else if(temPonto){
    if(t.match(/\./g).length>1) t=t.replace(/\./g,'');
  }
  var v=parseFloat(t);
  return neg ? -v : v;
}

/* ---------- por extenso ---------- */
var UNI=['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
var DEZ=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
var CEN=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
function ate999(n){
  if(n===100) return 'cem';
  var c=Math.floor(n/100), r=n%100, p=[];
  if(c) p.push(CEN[c]);
  if(r){ if(r<20) p.push(UNI[r]); else { var d=Math.floor(r/10), u=r%10; p.push(u ? DEZ[d]+' e '+UNI[u] : DEZ[d]); } }
  return p.join(' e ');
}
function inteiroExtenso(n){
  if(n===0) return 'zero';
  var g=[], mi=Math.floor(n/1e6), mil=Math.floor(n/1000)%1000, r=n%1000;
  if(mi) g.push([mi, mi===1?'um milhão':ate999(mi)+' milhões']);
  if(mil) g.push([mil, mil===1?'mil':ate999(mil)+' mil']);
  if(r) g.push([r, ate999(r)]);
  var s=g[0][1];
  for(var i=1;i<g.length;i++){ var v=g[i][0]; s += (v<100 || v%100===0 ? ' e ' : ' ') + g[i][1]; }
  return s;
}
function medidaExtenso(v, sing, plur, subSing, subPlur){
  var cent=Math.round(v*100), i=Math.floor(cent/100), f=cent%100, p=[];
  if(i || !f){
    var de = (i>=1e6 && i%1e6===0) ? ' de ' : ' ';
    p.push(inteiroExtenso(i)+de+(i===1?sing:plur));
  }
  if(f) p.push(inteiroExtenso(f)+' '+(f===1?subSing:subPlur));
  return p.join(' e ');
}
function areaExtenso(v){ return medidaExtenso(v,'metro quadrado','metros quadrados','decímetro quadrado','decímetros quadrados'); }
function compExtenso(v){ return medidaExtenso(v,'metro','metros','centímetro','centímetros'); }

/* ---------- datas e ângulos ---------- */
var MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function dataExtenso(iso){
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||''); if(!m) return '';
  var d=+m[3];
  return (d===1?'1º':d)+' de '+MESES[+m[2]-1]+' de '+m[1];
}
function dataCurta(iso){ var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||''); return m ? m[3]+'/'+m[2]+'/'+m[1] : ''; }
function hojeISO(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

// azimute em graus decimais → 70°00'26"
function grausMS(az){
  var t=Math.round(az*3600); t=((t%1296000)+1296000)%1296000;
  var g=Math.floor(t/3600), m=Math.floor(t/60)%60, s=t%60;
  return g+'°'+String(m).padStart(2,'0')+"'"+String(s).padStart(2,'0')+'"';
}

/* ---------- CPF / CNPJ ---------- */
function cpfOk(d){
  if(/^(\d)\1+$/.test(d)) return false;
  var s=0,i,r;
  for(i=0;i<9;i++) s+=(+d[i])*(10-i);
  r=(s*10)%11; if(r===10) r=0; if(r!==+d[9]) return false;
  s=0; for(i=0;i<10;i++) s+=(+d[i])*(11-i);
  r=(s*10)%11; if(r===10) r=0; return r===+d[10];
}
function cnpjOk(d){
  if(/^(\d)\1+$/.test(d)) return false;
  function dv(len){
    var pesos = len===12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2], s=0;
    for(var i=0;i<len;i++) s+=(+d[i])*pesos[i];
    var r=s%11; return r<2?0:11-r;
  }
  return dv(12)===+d[12] && dv(13)===+d[13];
}
function docDigitos(s){ return String(s||'').replace(/\D/g,''); }
function docValido(s){ var d=docDigitos(s); return d.length===11 ? cpfOk(d) : d.length===14 ? cnpjOk(d) : false; }
function fmtDoc(s){
  var d=docDigitos(s);
  if(d.length===11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');
  if(d.length===14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
  return String(s||'').trim();
}
function rotuloDoc(s){ return docDigitos(s).length===14 ? 'CNPJ' : 'CPF'; }

return {fmt:fmt, r2:r2, esc:esc, maiusc:maiusc, parseNum:parseNum,
  inteiroExtenso:inteiroExtenso, areaExtenso:areaExtenso, compExtenso:compExtenso,
  dataExtenso:dataExtenso, dataCurta:dataCurta, hojeISO:hojeISO, grausMS:grausMS,
  docValido:docValido, fmtDoc:fmtDoc, rotuloDoc:rotuloDoc};
})();
