/* Elipsoides, datums, UTM (série de Krüger), geocêntricas e plano local. Global: Geo. */
var Geo = (function(){
'use strict';

var RAD=Math.PI/180, K0=0.9996;

var ELIP={
  GRS80:{nome:'GRS 80',                 a:6378137, f:1/298.257222101},
  WGS84:{nome:'WGS 84',                 a:6378137, f:1/298.257223563},
  UGGI67:{nome:'Internacional 1967',    a:6378160, f:1/298.25},
  HAY24:{nome:'Internacional 1924 (Hayford)', a:6378388, f:1/297}
};

// Translação para SIRGAS 2000: parâmetros oficiais do IBGE (R.PR 1/2005), X_sirgas = X_origem + d
var DATUMS={
  sirgas:{nome:'SIRGAS 2000',     elip:ELIP.GRS80,  d:[0,0,0]},
  wgs84: {nome:'WGS 84',          elip:ELIP.WGS84,  d:[0,0,0]},
  sad69: {nome:'SAD 69',          elip:ELIP.UGGI67, d:[-67.35, 3.88, -38.22]},
  ca:    {nome:'Córrego Alegre',  elip:ELIP.HAY24,  d:[-206.05, 168.28, -3.82]}
};

/* ---------- Transversa de Mercator ---------- */
var cache={};
function tm(elip){
  elip=elip||ELIP.GRS80;
  var k=elip.a+'/'+elip.f; if(cache[k]) return cache[k];
  var a=elip.a, f=elip.f, e=Math.sqrt(f*(2-f)), n=f/(2-f);
  var n2=n*n,n3=n2*n,n4=n3*n,n5=n4*n,n6=n5*n;
  var A=a/(1+n)*(1+n2/4+n4/64+n6/256);
  var al=[0,
    n/2-2/3*n2+5/16*n3+41/180*n4-127/288*n5+7891/37800*n6,
    13/48*n2-3/5*n3+557/1440*n4+281/630*n5-1983433/1935360*n6,
    61/240*n3-103/140*n4+15061/26880*n5+167603/181440*n6,
    49561/161280*n4-179/168*n5+6601661/7257600*n6,
    34729/80640*n5-3418889/1995840*n6,
    212378941/319334400*n6];
  var be=[0,
    n/2-2/3*n2+37/96*n3-1/360*n4-81/512*n5+96199/604800*n6,
    1/48*n2+1/15*n3-437/1440*n4+46/105*n5-1118711/3870720*n6,
    17/480*n3-37/840*n4-209/4480*n5+5569/90720*n6,
    4397/161280*n4-11/504*n5-830251/7257600*n6,
    4583/161280*n5-108847/3991680*n6,
    20648693/638668800*n6];
  return (cache[k]={e:e, A:A, al:al, be:be});
}
function meridianoCentral(fuso){ return (fuso-1)*6-180+3; }
function fusoDe(lon){ return Math.floor((lon+180)/6)+1; }

function geoParaUtm(lat, lon, fuso, hemi, elip){
  var T=tm(elip), e=T.e, al=T.al;
  var phi=lat*RAD, lam=(lon-meridianoCentral(fuso))*RAD;
  var tau=Math.tan(phi);
  var sigma=Math.sinh(e*Math.atanh(e*tau/Math.sqrt(1+tau*tau)));
  var taup=tau*Math.sqrt(1+sigma*sigma)-sigma*Math.sqrt(1+tau*tau);
  var cl=Math.cos(lam);
  var xip=Math.atan2(taup, cl);
  var etap=Math.asinh(Math.sin(lam)/Math.sqrt(taup*taup+cl*cl));
  var xi=xip, eta=etap;
  for(var j=1;j<=6;j++){
    xi +=al[j]*Math.sin(2*j*xip)*Math.cosh(2*j*etap);
    eta+=al[j]*Math.cos(2*j*xip)*Math.sinh(2*j*etap);
  }
  var E=K0*T.A*eta+500000, N=K0*T.A*xi;
  if(hemi==='S') N+=10000000;
  return {E:E, N:N};
}
function utmParaGeo(E, N, fuso, hemi, elip){
  var T=tm(elip), e=T.e, be=T.be;
  var x=E-500000, y=(hemi==='S') ? N-10000000 : N;
  var eta=x/(K0*T.A), xi=y/(K0*T.A), xip=xi, etap=eta;
  for(var j=1;j<=6;j++){
    xip -=be[j]*Math.sin(2*j*xi)*Math.cosh(2*j*eta);
    etap-=be[j]*Math.cos(2*j*xi)*Math.sinh(2*j*eta);
  }
  var sh=Math.sinh(etap), sx=Math.sin(xip), cx=Math.cos(xip);
  var taup=sx/Math.sqrt(sh*sh+cx*cx), tau=taup, e2=e*e;
  for(var k=0;k<30;k++){
    var sigma=Math.sinh(e*Math.atanh(e*tau/Math.sqrt(1+tau*tau)));
    var taui=tau*Math.sqrt(1+sigma*sigma)-sigma*Math.sqrt(1+tau*tau);
    var d=(taup-taui)/Math.sqrt(1+taui*taui)*(1+(1-e2)*tau*tau)/((1-e2)*Math.sqrt(1+tau*tau));
    tau+=d; if(Math.abs(d)<1e-13) break;
  }
  return {lat:Math.atan(tau)/RAD, lon:Math.atan2(sh,cx)/RAD+meridianoCentral(fuso)};
}

/* ---------- geocêntricas ---------- */
function ecef(lat, lon, h, elip){
  elip=elip||ELIP.GRS80;
  var a=elip.a, e2=elip.f*(2-elip.f), p=lat*RAD, l=lon*RAD;
  var Nn=a/Math.sqrt(1-e2*Math.sin(p)*Math.sin(p));
  return [(Nn+h)*Math.cos(p)*Math.cos(l), (Nn+h)*Math.cos(p)*Math.sin(l), (Nn*(1-e2)+h)*Math.sin(p)];
}
function ecefParaGeo(x, y, z, elip){
  elip=elip||ELIP.GRS80;
  var a=elip.a, e2=elip.f*(2-elip.f), p=Math.hypot(x,y), lon=Math.atan2(y,x);
  var lat=Math.atan2(z, p*(1-e2)), h=0;
  for(var i=0;i<15;i++){
    var s=Math.sin(lat), Nn=a/Math.sqrt(1-e2*s*s);
    h=p/Math.cos(lat)-Nn;
    var nl=Math.atan2(z, p*(1-e2*Nn/(Nn+h)));
    if(Math.abs(nl-lat)<1e-14){ lat=nl; break; }
    lat=nl;
  }
  return {lat:lat/RAD, lon:lon/RAD, h:h};
}

// lat/lon (e altitude elipsoidal) num datum → SIRGAS 2000
function paraSirgas(lat, lon, h, datum){
  var D=DATUMS[datum];
  if(!D || (D.d[0]===0 && D.d[1]===0 && D.d[2]===0)) return {lat:lat, lon:lon, h:h};   // WGS 84 ≈ SIRGAS 2000
  var c=ecef(lat, lon, h||0, D.elip);
  var g=ecefParaGeo(c[0]+D.d[0], c[1]+D.d[1], c[2]+D.d[2], ELIP.GRS80);
  return {lat:g.lat, lon:g.lon, h:g.h};
}

// Plano topográfico local: Este/Norte em torno do centro do imóvel, na altitude informada
function paraLocal(geos, h){
  var lat0=0, lon0=0;
  geos.forEach(function(g){ lat0+=g.lat; lon0+=g.lon; });
  lat0/=geos.length; lon0/=geos.length;
  var o=ecef(lat0,lon0,h), p=lat0*RAD, l=lon0*RAD;
  var sp=Math.sin(p), cp=Math.cos(p), sl=Math.sin(l), cl=Math.cos(l);
  return geos.map(function(g){
    var c=ecef(g.lat,g.lon,h), dx=c[0]-o[0], dy=c[1]-o[1], dz=c[2]-o[2];
    return {x:-sl*dx+cl*dy, y:-sp*cl*dx-sp*sl*dy+cp*dz};
  });
}

// -17.7225 → 17°43'21,040" S
function gms(v, eixo, casas){
  if(casas===undefined) casas=3;
  var hemi = eixo==='lat' ? (v<0?'S':'N') : (v<0?'W':'E');
  var f=Math.pow(10,casas), t=Math.round(Math.abs(v)*3600*f);
  var g=Math.floor(t/(3600*f)), m=Math.floor(t/(60*f))%60, s=(t%(60*f))/f;
  var ss=s.toFixed(casas).replace('.',','); if(s<10) ss='0'+ss;
  return g+'°'+String(m).padStart(2,'0')+"'"+ss+'" '+hemi;
}

return {ELIP:ELIP, DATUMS:DATUMS, meridianoCentral:meridianoCentral, fusoDe:fusoDe,
  geoParaUtm:geoParaUtm, utmParaGeo:utmParaGeo, ecef:ecef, ecefParaGeo:ecefParaGeo,
  paraSirgas:paraSirgas, paraLocal:paraLocal, gms:gms};
})();
