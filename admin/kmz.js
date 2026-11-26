// Lee los KMZ de CCTT, maniobra y apoyos y saca SOLO código + latitud + longitud.
// Ningún otro dato de las fichas sale del ordenador del administrador.
(function (global) {
  // Carpeta del KML → capa de la app
  const CAPAS = {
    'Nombres CCTT ENDESA': 'endesa',
    'CCTT EXTERNOS': 'ext',
    'DDMM_sub': 'ddmm',
    'Apoyo MT ENDESA': 'apoyo',
  };
  const TOKEN = /<Folder\b([^>]*)>|<\/Folder>|<Placemark\b[\s\S]*?<\/Placemark>/g;
  const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  const decode = s => s.replace(/&(amp|lt|gt|quot|apos);/g, m => ENT[m]).trim();
  const round6 = n => Math.round(n * 1e6) / 1e6;

  function codigoDe(pm) {
    const n = /<name>([^<]*)<\/name>/.exec(pm);
    if (n && decode(n[1])) return decode(n[1]);
    for (const campo of ['Código', 'Alias', 'Nombre']) {
      const m = new RegExp('<td>' + campo + '</td><td>([^<]*)</td>').exec(pm);
      if (m && decode(m[1])) return decode(m[1]);
    }
    return '';
  }

  // Devuelve { capa: [[codigo, lat, lon], ...] } con las capas que encuentre en el KML
  function leerKml(texto) {
    const out = {}, pila = [];
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(texto))) {
      const t = m[0];
      if (t.startsWith('</Folder')) { pila.pop(); continue; }
      if (t.startsWith('<Folder')) {
        const id = /\bid="([^"]*)"/.exec(m[1] || '');
        // Sin id, el nombre de la carpeta es su primer <name>
        let nombre = id ? id[1] : '';
        if (!nombre) { const n = /<name>([^<]*)<\/name>/.exec(texto.slice(TOKEN.lastIndex, TOKEN.lastIndex + 400)); nombre = n ? decode(n[1]) : ''; }
        pila.push(nombre);
        continue;
      }
      const capa = CAPAS[pila[pila.length - 1]];
      if (!capa) continue;
      const c = /<coordinates>\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(t);
      const codigo = codigoDe(t);
      if (!c || !codigo) continue;
      (out[capa] ||= []).push([codigo, round6(+c[2]), round6(+c[1])]);
    }
    return out;
  }

  // Une varias lecturas en el formato que usa la app
  function aDatos(capas) {
    const groups = {};
    for (const [k, rows] of Object.entries(capas)) groups[k] = { fields: [], rows };
    return { groups };
  }

  const api = { leerKml, aDatos, CAPAS };
  if (typeof module !== 'undefined') module.exports = api; else global.KMZ = api;
})(this);
