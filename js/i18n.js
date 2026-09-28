/* Assembly Vale — locale table for the Settings / Graphics panel.
 * The locale comes from navigator.languages (exact tag, then language
 * fallback). Other screens are still English-only (see spec §10).
 * UMD: window.AVI18n in the browser, module.exports in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AVI18n = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];

  var en = {
    'settings.open': 'Settings',
    'settings.title': 'Settings',
    'settings.intro': 'Changes apply immediately and are saved on this device.',
    'settings.back': 'Back',
    'gfx.heading': 'Graphics',
    'gfx.preview': 'Live preview of the board with the current settings',
    'gfx.quality': 'Quality',
    'gfx.auto': 'Auto (detected: {tier})',
    'gfx.preset.low': 'Low', 'gfx.preset.balanced': 'Balanced', 'gfx.preset.high': 'High', 'gfx.preset.ultra': 'Ultra',
    'gfx.scale': 'Render scale',
    'gfx.fromPreset': 'From preset ({tier})',
    'gfx.cat.shadows': 'Shadows', 'gfx.cat.detail': 'Surface detail', 'gfx.cat.bloom': 'Glow (bloom)',
    'gfx.cat.grade': 'Colour grade and vignette', 'gfx.cat.particles': 'Particles', 'gfx.cat.animation': 'Animation',
    'gfx.tier.off': 'Off', 'gfx.tier.on': 'On', 'gfx.tier.low': 'Low', 'gfx.tier.medium': 'Medium', 'gfx.tier.high': 'High',
    'gfx.tier.plain': 'Plain', 'gfx.tier.detailed': 'Detailed', 'gfx.tier.static': 'Static', 'gfx.tier.animated': 'Animated',
    'gfx.adaptive': 'Adaptive resolution',
    'gfx.fps': 'Show frame rate',
    'gfx.summary': '{gpu} · {preset} · cost ×{cost} · {w}×{h} px',
    'gfx.postNote': 'Some effects could not be drawn on this device, so the board is shown without them.',
    'gfx.motionNote': 'Reduced motion is on: animation and particles stay off.',
    'gfx.fpsReadout': '{fps} fps · {ms} ms'
  };

  var T = {
    'en-US': Object.assign({}, en, { 'gfx.cat.grade': 'Color grade and vignette' }),
    'en-GB': en,
    'es-419': {
      'settings.open': 'Configuración', 'settings.title': 'Configuración',
      'settings.intro': 'Los cambios se aplican al instante y se guardan en este dispositivo.', 'settings.back': 'Volver',
      'gfx.heading': 'Gráficos', 'gfx.preview': 'Vista previa del tablero con la configuración actual',
      'gfx.quality': 'Calidad', 'gfx.auto': 'Automática (detectada: {tier})',
      'gfx.preset.low': 'Baja', 'gfx.preset.balanced': 'Equilibrada', 'gfx.preset.high': 'Alta', 'gfx.preset.ultra': 'Ultra',
      'gfx.scale': 'Escala de renderizado', 'gfx.fromPreset': 'Según el ajuste ({tier})',
      'gfx.cat.shadows': 'Sombras', 'gfx.cat.detail': 'Detalle de superficies', 'gfx.cat.bloom': 'Resplandor (bloom)',
      'gfx.cat.grade': 'Corrección de color y viñeta', 'gfx.cat.particles': 'Partículas', 'gfx.cat.animation': 'Animación',
      'gfx.tier.off': 'Desactivado', 'gfx.tier.on': 'Activado', 'gfx.tier.low': 'Bajo', 'gfx.tier.medium': 'Medio', 'gfx.tier.high': 'Alto',
      'gfx.tier.plain': 'Simple', 'gfx.tier.detailed': 'Detallado', 'gfx.tier.static': 'Estático', 'gfx.tier.animated': 'Animado',
      'gfx.adaptive': 'Resolución adaptable', 'gfx.fps': 'Mostrar cuadros por segundo',
      'gfx.summary': '{gpu} · {preset} · costo ×{cost} · {w}×{h} px',
      'gfx.postNote': 'Algunos efectos no se pudieron dibujar en este dispositivo, así que el tablero se muestra sin ellos.',
      'gfx.motionNote': 'El movimiento reducido está activado: la animación y las partículas permanecen desactivadas.',
      'gfx.fpsReadout': '{fps} FPS · {ms} ms'
    },
    'es-ES': {
      'settings.open': 'Ajustes', 'settings.title': 'Ajustes',
      'settings.intro': 'Los cambios se aplican al momento y se guardan en este dispositivo.', 'settings.back': 'Volver',
      'gfx.heading': 'Gráficos', 'gfx.preview': 'Vista previa del tablero con los ajustes actuales',
      'gfx.quality': 'Calidad', 'gfx.auto': 'Automática (detectada: {tier})',
      'gfx.preset.low': 'Baja', 'gfx.preset.balanced': 'Equilibrada', 'gfx.preset.high': 'Alta', 'gfx.preset.ultra': 'Ultra',
      'gfx.scale': 'Escala de renderizado', 'gfx.fromPreset': 'Según el ajuste ({tier})',
      'gfx.cat.shadows': 'Sombras', 'gfx.cat.detail': 'Detalle de superficies', 'gfx.cat.bloom': 'Resplandor (bloom)',
      'gfx.cat.grade': 'Corrección de color y viñeta', 'gfx.cat.particles': 'Partículas', 'gfx.cat.animation': 'Animación',
      'gfx.tier.off': 'Desactivado', 'gfx.tier.on': 'Activado', 'gfx.tier.low': 'Bajo', 'gfx.tier.medium': 'Medio', 'gfx.tier.high': 'Alto',
      'gfx.tier.plain': 'Sencillo', 'gfx.tier.detailed': 'Detallado', 'gfx.tier.static': 'Estático', 'gfx.tier.animated': 'Animado',
      'gfx.adaptive': 'Resolución adaptativa', 'gfx.fps': 'Mostrar fotogramas por segundo',
      'gfx.summary': '{gpu} · {preset} · coste ×{cost} · {w}×{h} px',
      'gfx.postNote': 'Algunos efectos no se han podido dibujar en este dispositivo, así que el tablero se muestra sin ellos.',
      'gfx.motionNote': 'El movimiento reducido está activado: la animación y las partículas siguen desactivadas.',
      'gfx.fpsReadout': '{fps} FPS · {ms} ms'
    },
    'de-DE': {
      'settings.open': 'Einstellungen', 'settings.title': 'Einstellungen',
      'settings.intro': 'Änderungen gelten sofort und werden auf diesem Gerät gespeichert.', 'settings.back': 'Zurück',
      'gfx.heading': 'Grafik', 'gfx.preview': 'Live-Vorschau des Spielbretts mit den aktuellen Einstellungen',
      'gfx.quality': 'Qualität', 'gfx.auto': 'Automatisch (erkannt: {tier})',
      'gfx.preset.low': 'Niedrig', 'gfx.preset.balanced': 'Ausgewogen', 'gfx.preset.high': 'Hoch', 'gfx.preset.ultra': 'Ultra',
      'gfx.scale': 'Renderskalierung', 'gfx.fromPreset': 'Aus Voreinstellung ({tier})',
      'gfx.cat.shadows': 'Schatten', 'gfx.cat.detail': 'Oberflächendetails', 'gfx.cat.bloom': 'Leuchten (Bloom)',
      'gfx.cat.grade': 'Farbkorrektur und Vignette', 'gfx.cat.particles': 'Partikel', 'gfx.cat.animation': 'Animation',
      'gfx.tier.off': 'Aus', 'gfx.tier.on': 'An', 'gfx.tier.low': 'Niedrig', 'gfx.tier.medium': 'Mittel', 'gfx.tier.high': 'Hoch',
      'gfx.tier.plain': 'Schlicht', 'gfx.tier.detailed': 'Detailliert', 'gfx.tier.static': 'Statisch', 'gfx.tier.animated': 'Animiert',
      'gfx.adaptive': 'Adaptive Auflösung', 'gfx.fps': 'Bildrate anzeigen',
      'gfx.summary': '{gpu} · {preset} · Aufwand ×{cost} · {w}×{h} px',
      'gfx.postNote': 'Einige Effekte konnten auf diesem Gerät nicht gezeichnet werden, daher wird das Brett ohne sie angezeigt.',
      'gfx.motionNote': 'Reduzierte Bewegung ist aktiv: Animation und Partikel bleiben aus.',
      'gfx.fpsReadout': '{fps} FPS · {ms} ms'
    },
    'fr-FR': {
      'settings.open': 'Paramètres', 'settings.title': 'Paramètres',
      'settings.intro': 'Les modifications s’appliquent immédiatement et sont enregistrées sur cet appareil.', 'settings.back': 'Retour',
      'gfx.heading': 'Graphismes', 'gfx.preview': 'Aperçu en direct du plateau avec les paramètres actuels',
      'gfx.quality': 'Qualité', 'gfx.auto': 'Auto (détectée : {tier})',
      'gfx.preset.low': 'Basse', 'gfx.preset.balanced': 'Équilibrée', 'gfx.preset.high': 'Haute', 'gfx.preset.ultra': 'Ultra',
      'gfx.scale': 'Échelle de rendu', 'gfx.fromPreset': 'Selon le préréglage ({tier})',
      'gfx.cat.shadows': 'Ombres', 'gfx.cat.detail': 'Détail des surfaces', 'gfx.cat.bloom': 'Halo lumineux (bloom)',
      'gfx.cat.grade': 'Étalonnage et vignettage', 'gfx.cat.particles': 'Particules', 'gfx.cat.animation': 'Animation',
      'gfx.tier.off': 'Désactivé', 'gfx.tier.on': 'Activé', 'gfx.tier.low': 'Bas', 'gfx.tier.medium': 'Moyen', 'gfx.tier.high': 'Élevé',
      'gfx.tier.plain': 'Simple', 'gfx.tier.detailed': 'Détaillé', 'gfx.tier.static': 'Statique', 'gfx.tier.animated': 'Animé',
      'gfx.adaptive': 'Résolution adaptative', 'gfx.fps': 'Afficher la fréquence d’images',
      'gfx.summary': '{gpu} · {preset} · coût ×{cost} · {w}×{h} px',
      'gfx.postNote': 'Certains effets n’ont pas pu être dessinés sur cet appareil ; le plateau s’affiche sans eux.',
      'gfx.motionNote': 'Le mouvement réduit est activé : l’animation et les particules restent désactivées.',
      'gfx.fpsReadout': '{fps} i/s · {ms} ms'
    },
    'fr-CA': {
      'settings.open': 'Paramètres', 'settings.title': 'Paramètres',
      'settings.intro': 'Les changements s’appliquent tout de suite et sont enregistrés sur cet appareil.', 'settings.back': 'Retour',
      'gfx.heading': 'Graphiques', 'gfx.preview': 'Aperçu en direct du plateau avec les paramètres actuels',
      'gfx.quality': 'Qualité', 'gfx.auto': 'Auto (détectée : {tier})',
      'gfx.preset.low': 'Basse', 'gfx.preset.balanced': 'Équilibrée', 'gfx.preset.high': 'Haute', 'gfx.preset.ultra': 'Ultra',
      'gfx.scale': 'Échelle de rendu', 'gfx.fromPreset': 'Selon le préréglage ({tier})',
      'gfx.cat.shadows': 'Ombres', 'gfx.cat.detail': 'Détail des surfaces', 'gfx.cat.bloom': 'Lueur (bloom)',
      'gfx.cat.grade': 'Correction des couleurs et vignette', 'gfx.cat.particles': 'Particules', 'gfx.cat.animation': 'Animation',
      'gfx.tier.off': 'Désactivé', 'gfx.tier.on': 'Activé', 'gfx.tier.low': 'Bas', 'gfx.tier.medium': 'Moyen', 'gfx.tier.high': 'Élevé',
      'gfx.tier.plain': 'Simple', 'gfx.tier.detailed': 'Détaillé', 'gfx.tier.static': 'Statique', 'gfx.tier.animated': 'Animé',
      'gfx.adaptive': 'Résolution adaptative', 'gfx.fps': 'Afficher le nombre d’images par seconde',
      'gfx.summary': '{gpu} · {preset} · coût ×{cost} · {w}×{h} px',
      'gfx.postNote': 'Certains effets n’ont pas pu être affichés sur cet appareil; le plateau s’affiche donc sans eux.',
      'gfx.motionNote': 'Le mouvement réduit est activé : l’animation et les particules restent désactivées.',
      'gfx.fpsReadout': '{fps} im/s · {ms} ms'
    },
    'pt-BR': {
      'settings.open': 'Configurações', 'settings.title': 'Configurações',
      'settings.intro': 'As mudanças valem na hora e ficam salvas neste dispositivo.', 'settings.back': 'Voltar',
      'gfx.heading': 'Gráficos', 'gfx.preview': 'Prévia ao vivo do tabuleiro com as configurações atuais',
      'gfx.quality': 'Qualidade', 'gfx.auto': 'Automática (detectada: {tier})',
      'gfx.preset.low': 'Baixa', 'gfx.preset.balanced': 'Equilibrada', 'gfx.preset.high': 'Alta', 'gfx.preset.ultra': 'Ultra',
      'gfx.scale': 'Escala de renderização', 'gfx.fromPreset': 'Da predefinição ({tier})',
      'gfx.cat.shadows': 'Sombras', 'gfx.cat.detail': 'Detalhe das superfícies', 'gfx.cat.bloom': 'Brilho (bloom)',
      'gfx.cat.grade': 'Correção de cor e vinheta', 'gfx.cat.particles': 'Partículas', 'gfx.cat.animation': 'Animação',
      'gfx.tier.off': 'Desligado', 'gfx.tier.on': 'Ligado', 'gfx.tier.low': 'Baixo', 'gfx.tier.medium': 'Médio', 'gfx.tier.high': 'Alto',
      'gfx.tier.plain': 'Simples', 'gfx.tier.detailed': 'Detalhado', 'gfx.tier.static': 'Estático', 'gfx.tier.animated': 'Animado',
      'gfx.adaptive': 'Resolução adaptativa', 'gfx.fps': 'Mostrar taxa de quadros',
      'gfx.summary': '{gpu} · {preset} · custo ×{cost} · {w}×{h} px',
      'gfx.postNote': 'Alguns efeitos não puderam ser desenhados neste dispositivo, então o tabuleiro aparece sem eles.',
      'gfx.motionNote': 'Movimento reduzido está ativado: animação e partículas ficam desligadas.',
      'gfx.fpsReadout': '{fps} FPS · {ms} ms'
    },
    'it-IT': {
      'settings.open': 'Impostazioni', 'settings.title': 'Impostazioni',
      'settings.intro': 'Le modifiche si applicano subito e vengono salvate su questo dispositivo.', 'settings.back': 'Indietro',
      'gfx.heading': 'Grafica', 'gfx.preview': 'Anteprima dal vivo del tabellone con le impostazioni attuali',
      'gfx.quality': 'Qualità', 'gfx.auto': 'Automatica (rilevata: {tier})',
      'gfx.preset.low': 'Bassa', 'gfx.preset.balanced': 'Bilanciata', 'gfx.preset.high': 'Alta', 'gfx.preset.ultra': 'Ultra',
      'gfx.scale': 'Scala di rendering', 'gfx.fromPreset': 'Dal preset ({tier})',
      'gfx.cat.shadows': 'Ombre', 'gfx.cat.detail': 'Dettaglio delle superfici', 'gfx.cat.bloom': 'Bagliore (bloom)',
      'gfx.cat.grade': 'Correzione colore e vignettatura', 'gfx.cat.particles': 'Particelle', 'gfx.cat.animation': 'Animazione',
      'gfx.tier.off': 'Disattivato', 'gfx.tier.on': 'Attivo', 'gfx.tier.low': 'Basso', 'gfx.tier.medium': 'Medio', 'gfx.tier.high': 'Alto',
      'gfx.tier.plain': 'Semplice', 'gfx.tier.detailed': 'Dettagliato', 'gfx.tier.static': 'Statico', 'gfx.tier.animated': 'Animato',
      'gfx.adaptive': 'Risoluzione adattiva', 'gfx.fps': 'Mostra fotogrammi al secondo',
      'gfx.summary': '{gpu} · {preset} · costo ×{cost} · {w}×{h} px',
      'gfx.postNote': 'Alcuni effetti non possono essere disegnati su questo dispositivo, quindi il tabellone viene mostrato senza.',
      'gfx.motionNote': 'Il movimento ridotto è attivo: animazione e particelle restano disattivate.',
      'gfx.fpsReadout': '{fps} FPS · {ms} ms'
    }
  };

  /** Best supported locale for a list of BCP 47 tags. */
  function pick(tags) {
    var list = [].concat(tags || []);
    for (var i = 0; i < list.length; i++) {
      var tag = String(list[i] || '');
      for (var j = 0; j < LOCALES.length; j++) if (LOCALES[j].toLowerCase() === tag.toLowerCase()) return LOCALES[j];
      var lang = tag.split('-')[0].toLowerCase();
      if (lang === 'en') return 'en-US';
      if (lang === 'es') return 'es-419';
      if (lang === 'de') return 'de-DE';
      if (lang === 'fr') return 'fr-FR';
      if (lang === 'pt') return 'pt-BR';
      if (lang === 'it') return 'it-IT';
    }
    return 'en-US';
  }

  function make(locale) {
    var table = T[locale] || T['en-US'];
    return function t(key, vars) {
      var s = table[key] != null ? table[key] : (en[key] != null ? en[key] : key);
      if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; });
      return s;
    };
  }

  return { LOCALES: LOCALES, STRINGS: T, pick: pick, make: make };
});
