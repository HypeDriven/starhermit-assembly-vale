/* Assembly Vale — versioned content: goods, recipes, themes, layouts,
 * journey stages, lessons, challenges, daily generator, validators.
 * Data only; no rules logic. Usable from browser (window.AVContent) and Node.
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.AVRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AVContent = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var CONTENT_VERSION = 1;

  // ---------- economy catalog ----------
  var GOODS = {
    ore: 5, ingot: 14, plate: 32,
    timber: 4, plank: 11, frame: 26,
    wool: 4, cloth: 12, garment: 30
  };

  var RECIPES = [
    { id: 'smelt',     name: 'Smelter',   input: 'ore',   output: 'ingot',   time: 4, cost: 40 },
    { id: 'press',     name: 'Press',     input: 'ingot', output: 'plate',   time: 6, cost: 60 },
    { id: 'saw',       name: 'Sawmill',   input: 'timber',output: 'plank',   time: 3, cost: 35 },
    { id: 'carpentry', name: 'Workshop',  input: 'plank', output: 'frame',   time: 5, cost: 55 },
    { id: 'weave',     name: 'Loom',      input: 'wool',  output: 'cloth',   time: 3, cost: 35 },
    { id: 'tailor',    name: 'Tailor',    input: 'cloth', output: 'garment', time: 5, cost: 55 }
  ];

  var BELT_COST = 6;
  var UPGRADE_COSTS = [25, 45]; // to level 2, to level 3

  // Presentation metadata (icons are drawn procedurally; these are labels).
  var GOOD_META = {
    ore:     { name: 'Ore',     color: '#8d97a5', shape: 'chunk' },
    ingot:   { name: 'Ingot',   color: '#e0883b', shape: 'bar' },
    plate:   { name: 'Plate',   color: '#f2c14e', shape: 'slab' },
    timber:  { name: 'Timber',  color: '#9a6a3f', shape: 'log' },
    plank:   { name: 'Plank',   color: '#c98d4b', shape: 'board' },
    frame:   { name: 'Frame',   color: '#e0b06a', shape: 'crate' },
    wool:    { name: 'Wool',    color: '#e8e4da', shape: 'puff' },
    cloth:   { name: 'Cloth',   color: '#7fa8d9', shape: 'roll' },
    garment: { name: 'Garment', color: '#b07fd9', shape: 'fold' }
  };

  // ---------- visual themes ----------
  var THEMES = {
    meadow: { name: 'Meadow', sky: '#a8d3e8', ground: '#6f9e5a', tileA: '#7fae66', tileB: '#74a35c',
              rock: '#8b8f96', water: '#5f9ec7', belt: '#4c4438', accent: '#ffd166' },
    ember:  { name: 'Ember',  sky: '#3d2b33', ground: '#7a4a3a', tileA: '#8a5340', tileB: '#7d4b39',
              rock: '#5d4a4a', water: '#3a5f6e', belt: '#3a2f28', accent: '#ff9d5c' },
    frost:  { name: 'Frost',  sky: '#c9dcec', ground: '#aebfd0', tileA: '#bcccda', tileB: '#b0c2d2',
              rock: '#7d8ea0', water: '#8fc3e8', belt: '#4a5568', accent: '#7fd4ff' },
    dusk:   { name: 'Dusk',   sky: '#2c2740', ground: '#5a4a72', tileA: '#665580', tileB: '#5d4d76',
              rock: '#4a4060', water: '#3a4a7a', belt: '#332c44', accent: '#e8a0e8' },
    canyon: { name: 'Canyon', sky: '#e8c9a0', ground: '#b5764a', tileA: '#c08153', tileB: '#b4784b',
              rock: '#8a5a40', water: '#5f8ea0', belt: '#54382a', accent: '#ffe08a' }
  };
  var THEME_ORDER = ['meadow', 'ember', 'frost', 'dusk', 'canyon'];

  // ---------- layouts (ASCII maps) ----------
  // '.' meadow, '#' rock, '~' water, 'X' exchange sink,
  // 'o' ore mine, 't' timber grove, 'w' wool pasture.
  var LAYOUTS = {
    ford: {
      rows: [
        'o.....',
        '..#...',
        '.....X',
        '......'
      ],
      dirs: { o: 'E' }, rates: { o: 4 }
    },
    bend: {
      rows: [
        'o......',
        '...##..',
        '...#...',
        '......X',
        '.......'
      ],
      dirs: { o: 'E' }, rates: { o: 4 }
    },
    twin: {
      rows: [
        'o.......',
        '...#....',
        '.......X',
        '...#....',
        't.......'
      ],
      dirs: { o: 'E', t: 'E' }, rates: { o: 4, t: 4 }
    },
    pasture: {
      rows: [
        'w.......',
        '..#..#..',
        '.......X',
        '..#..#..',
        'o.......',
        '........'
      ],
      dirs: { w: 'E', o: 'E' }, rates: { w: 4, o: 4 }
    },
    gorge: {
      rows: [
        'o~~~.....',
        '.~~~.#...',
        '.~~~.....',
        '.~~~....X',
        '.~~~.#...',
        't~~~.....'
      ],
      dirs: { o: 'E', t: 'E' }, rates: { o: 4, t: 5 }
    },
    delta: {
      rows: [
        'o........',
        '..##.....',
        '.........',
        'w.......X',
        '.........',
        '..##.....',
        't........'
      ],
      dirs: { o: 'E', w: 'E', t: 'E' }, rates: { o: 4, w: 4, t: 5 }
    },
    switchback: {
      rows: [
        'o...#...',
        '.##.#...',
        '.....#..',
        'X#......',
        '...#.##.',
        '...#...t'
      ],
      dirs: { o: 'E', t: 'N' }, rates: { o: 4, t: 5 }
    },
    quarry: {
      rows: [
        'o.........',
        '..#..#....',
        '..........',
        '....##....',
        '.........X',
        '..#..#....',
        't.........'
      ],
      dirs: { o: 'E', t: 'E' }, rates: { o: 4, t: 5 }
    },
    tiers: {
      rows: [
        'w........',
        '.###.###.',
        '.........',
        '###.###.#',
        '.......X.',
        '.###.###.',
        'o........'
      ],
      dirs: { w: 'E', o: 'E' }, rates: { w: 4, o: 5 }
    },
    basin: {
      rows: [
        'o.........',
        '..........',
        '....#.....',
        '..........',
        '.........X',
        '....#.....',
        '..........',
        'w........t'
      ],
      dirs: { o: 'E', w: 'E', t: 'W' }, rates: { o: 4, w: 4, t: 5 }
    },
    narrows: {
      rows: [
        'o......',
        '.####..',
        '.......',
        '..##...',
        '...##..',
        '.......',
        '..####.',
        'w....X.'
      ],
      dirs: { o: 'E', w: 'E' }, rates: { o: 4, w: 5 }
    },
    crossroads: {
      rows: [
        '....o....',
        '....#....',
        '##..#..##',
        '.........',
        'w...#...X',
        '.........',
        '##..#..##',
        '....#....',
        '....t....'
      ],
      dirs: { o: 'S', w: 'E', t: 'N' }, rates: { o: 4, w: 4, t: 5 }
    }
  };

  var SOURCE_CHAR = { o: 'ore', t: 'timber', w: 'wool' };

  function layoutToTerrain(layout) {
    var terrain = [], sources = [], sink = null;
    var rows = LAYOUTS[layout].rows;
    var cols = rows[0].length;
    for (var y = 0; y < rows.length; y++) {
      if (rows[y].length !== cols) throw new Error('layout ' + layout + ' ragged row ' + y);
      for (var x = 0; x < cols; x++) {
        var ch = rows[y][x];
        if (ch === '#') terrain.push({ x: x, y: y, k: 'rock' });
        else if (ch === '~') terrain.push({ x: x, y: y, k: 'water' });
        else if (ch === 'X') sink = { x: x, y: y };
        else if (SOURCE_CHAR[ch]) {
          sources.push({
            x: x, y: y, item: SOURCE_CHAR[ch],
            dir: (LAYOUTS[layout].dirs || {})[ch] || 'E',
            every: (LAYOUTS[layout].rates || {})[ch] || 4
          });
        }
      }
    }
    if (!sink) throw new Error('layout ' + layout + ' has no sink');
    return { cols: cols, rows: rows.length, terrain: terrain, sources: sources, sink: sink };
  }

  // ---------- journey ----------
  // 40 authored stages: one mechanic at a time, then combinations, with a
  // mastery stage closing each block of four.
  var JOURNEY = [
    { id: 'j01', name: 'First Ford',      layout: 'ford',       recipes: [],                              contracts: { ore: 5 },                      gold: 60,  tickLimit: 120, upgrades: false, theme: 'meadow' },
    { id: 'j02', name: 'Around the Rock', layout: 'bend',       recipes: [],                              contracts: { ore: 8 },                      gold: 80,  tickLimit: 150, upgrades: false, theme: 'meadow' },
    { id: 'j03', name: 'Narrows Run',     layout: 'narrows',    recipes: [],                              contracts: { ore: 10 },                     gold: 90,  tickLimit: 160, upgrades: false, theme: 'meadow' },
    { id: 'j04', name: 'Gorge Mastery',   layout: 'gorge',      recipes: [],                              contracts: { ore: 12 },                     gold: 110, tickLimit: 180, upgrades: false, theme: 'meadow', mastery: true },
    { id: 'j05', name: 'First Smelter',   layout: 'ford',       recipes: ['smelt'],                       contracts: { ingot: 5 },                    gold: 120, tickLimit: 150, upgrades: false, theme: 'meadow' },
    { id: 'j06', name: 'Ingot Bend',      layout: 'bend',       recipes: ['smelt'],                       contracts: { ingot: 7 },                    gold: 140, tickLimit: 170, upgrades: false, theme: 'meadow' },
    { id: 'j07', name: 'Mixed Manifest',  layout: 'basin',      recipes: ['smelt'],                       contracts: { ingot: 8, ore: 4 },            gold: 150, tickLimit: 190, upgrades: false, theme: 'meadow' },
    { id: 'j08', name: 'Quarry Mastery',  layout: 'quarry',     recipes: ['smelt'],                       contracts: { ingot: 10 },                   gold: 170, tickLimit: 210, upgrades: false, theme: 'meadow', mastery: true },
    { id: 'j09', name: 'First Sawmill',   layout: 'twin',       recipes: ['saw'],                         contracts: { plank: 5 },                    gold: 110, tickLimit: 150, upgrades: false, theme: 'ember' },
    { id: 'j10', name: 'Plank Basin',     layout: 'basin',      recipes: ['saw'],                         contracts: { plank: 7 },                    gold: 130, tickLimit: 170, upgrades: false, theme: 'ember' },
    { id: 'j11', name: 'Two Trades',      layout: 'delta',      recipes: ['smelt', 'saw'],                contracts: { plank: 6, ingot: 6 },          gold: 190, tickLimit: 210, upgrades: false, theme: 'ember' },
    { id: 'j12', name: 'Crossroads Mastery', layout: 'crossroads', recipes: ['smelt', 'saw'],             contracts: { plank: 8, ingot: 8 },          gold: 220, tickLimit: 240, upgrades: false, theme: 'ember', mastery: true },
    { id: 'j13', name: 'Tune-Up',         layout: 'ford',       recipes: ['smelt'],                       contracts: { ingot: 8 },                    gold: 170, tickLimit: 150, upgrades: true,  theme: 'ember' },
    { id: 'j14', name: 'First Press',     layout: 'bend',       recipes: ['smelt', 'press'],              contracts: { plate: 4 },                    gold: 230, tickLimit: 200, upgrades: true,  theme: 'ember' },
    { id: 'j15', name: 'Plate Basin',     layout: 'basin',      recipes: ['smelt', 'press'],              contracts: { plate: 6 },                    gold: 250, tickLimit: 220, upgrades: true,  theme: 'ember' },
    { id: 'j16', name: 'Quarry Plates',   layout: 'quarry',     recipes: ['smelt', 'press'],              contracts: { plate: 6, ingot: 4 },          gold: 280, tickLimit: 240, upgrades: true,  theme: 'ember', mastery: true },
    { id: 'j17', name: 'First Loom',      layout: 'pasture',    recipes: ['weave'],                       contracts: { cloth: 5 },                    gold: 110, tickLimit: 150, upgrades: true,  theme: 'frost' },
    { id: 'j18', name: 'Cloth Narrows',   layout: 'narrows',    recipes: ['weave'],                       contracts: { cloth: 7 },                    gold: 130, tickLimit: 170, upgrades: true,  theme: 'frost' },
    { id: 'j19', name: 'Warp and Grain',  layout: 'delta',      recipes: ['weave', 'saw'],                contracts: { cloth: 6, plank: 6 },          gold: 200, tickLimit: 220, upgrades: true,  theme: 'frost' },
    { id: 'j20', name: 'Frost Mastery',   layout: 'crossroads', recipes: ['weave', 'smelt'],              contracts: { cloth: 8, ingot: 8 },          gold: 240, tickLimit: 250, upgrades: true,  theme: 'frost', mastery: true },
    { id: 'j21', name: 'First Tailor',    layout: 'pasture',    recipes: ['weave', 'tailor'],             contracts: { garment: 4 },                  gold: 230, tickLimit: 200, upgrades: true,  theme: 'frost' },
    { id: 'j22', name: 'Garment Basin',   layout: 'basin',      recipes: ['weave', 'tailor'],             contracts: { garment: 5 },                gold: 250, tickLimit: 220, upgrades: true,  theme: 'frost' },
    { id: 'j23', name: 'First Workshop',  layout: 'twin',       recipes: ['saw', 'carpentry'],            contracts: { frame: 4 },                    gold: 230, tickLimit: 200, upgrades: true,  theme: 'dusk' },
    { id: 'j24', name: 'Frame Quarry',    layout: 'quarry',     recipes: ['saw', 'carpentry'],            contracts: { frame: 5 },                    gold: 250, tickLimit: 220, upgrades: true,  theme: 'dusk' },
    { id: 'j25', name: 'Delta Mastery',  layout: 'delta',     recipes: ['weave', 'tailor', 'saw', 'carpentry'], contracts: { garment: 5, frame: 5 }, gold: 400, tickLimit: 280, upgrades: true, theme: 'dusk', mastery: true },
    { id: 'j26', name: 'Lean Lines',      layout: 'ford',       recipes: ['smelt'],                       contracts: { ingot: 8 },                    gold: 200, tickLimit: 170, upgrades: true,  theme: 'dusk', buildLimit: 14 },
    { id: 'j27', name: 'Lean Plates',     layout: 'bend',       recipes: ['smelt', 'press'],              contracts: { plate: 5 },                    gold: 270, tickLimit: 210, upgrades: true,  theme: 'dusk', buildLimit: 18 },
    { id: 'j28', name: 'Lean Delta',      layout: 'delta',      recipes: ['weave', 'saw'],                contracts: { cloth: 6, plank: 5 },          gold: 260, tickLimit: 220, upgrades: true,  theme: 'dusk', buildLimit: 20 },
    { id: 'j29', name: 'Lean Luxury',     layout: 'basin',      recipes: ['weave', 'tailor', 'smelt', 'press'], contracts: { garment: 4, plate: 4 },  gold: 380, tickLimit: 260, upgrades: true,  theme: 'dusk', buildLimit: 24 },
    { id: 'j30', name: 'Lean Mastery',    layout: 'crossroads', recipes: ['weave', 'tailor', 'saw', 'carpentry'], contracts: { frame: 6, garment: 5 }, gold: 430, tickLimit: 300, upgrades: true, theme: 'dusk', buildLimit: 26, mastery: true },
    { id: 'j31', name: 'Shoestring',      layout: 'ford',       recipes: ['smelt'],                       contracts: { ingot: 10 },                   gold: 100, tickLimit: 200, upgrades: true,  theme: 'canyon' },
    { id: 'j32', name: 'Shoestring Plates', layout: 'bend',     recipes: ['smelt', 'press'],              contracts: { plate: 6 },                  gold: 220, tickLimit: 240, upgrades: true,  theme: 'canyon' },
    { id: 'j33', name: 'Shoestring Garments', layout: 'pasture', recipes: ['weave', 'tailor'],            contracts: { garment: 6 },                gold: 260, tickLimit: 250, upgrades: true,  theme: 'canyon' },
    { id: 'j34', name: 'Shoestring Frames', layout: 'quarry',   recipes: ['saw', 'carpentry'],            contracts: { frame: 6 },                  gold: 260, tickLimit: 250, upgrades: true,  theme: 'canyon' },
    { id: 'j35', name: 'Canyon Mastery',  layout: 'delta',      recipes: ['weave', 'tailor', 'smelt', 'press', 'saw', 'carpentry'], contracts: { plate: 6, garment: 5, frame: 5 }, gold: 560, tickLimit: 320, upgrades: true, theme: 'canyon', mastery: true },
    { id: 'j36', name: 'Express Ore',     layout: 'ford',       recipes: ['smelt'],                       contracts: { ore: 14, ingot: 8 },           gold: 180, tickLimit: 170, upgrades: true,  theme: 'canyon' },
    { id: 'j37', name: 'Express Delta',   layout: 'delta',      recipes: ['weave', 'saw'],                contracts: { cloth: 8, plank: 8 },          gold: 300, tickLimit: 220, upgrades: true,  theme: 'canyon' },
    { id: 'j38', name: 'Express Tiers',   layout: 'tiers',      recipes: ['weave', 'tailor', 'smelt', 'press'], contracts: { garment: 6, plate: 6 },  gold: 440, tickLimit: 280, upgrades: true,  theme: 'canyon' },
    { id: 'j39', name: 'Express Switchback', layout: 'switchback', recipes: ['saw', 'carpentry', 'smelt', 'press'], contracts: { frame: 7, plate: 6 }, gold: 440, tickLimit: 290, upgrades: true, theme: 'canyon' },
    { id: 'j40', name: 'Vale Mastery',    layout: 'crossroads', recipes: ['smelt', 'press', 'saw', 'carpentry', 'weave', 'tailor'], contracts: { garment: 6, frame: 6, plate: 6 }, gold: 600, tickLimit: 340, upgrades: true, theme: 'canyon', mastery: true }
  ];

  // ---------- lessons (Learn mode) ----------
  var LESSONS = [
    {
      id: 'belts', name: 'Lay the line',
      text: 'Goods ride conveyor belts. Select the belt tool and place a line of belts from the ore mine to the Exchange. Goods sell the moment they arrive.',
      layout: 'ford', recipes: [], contracts: { ore: 3 }, gold: 60, tickLimit: 200, upgrades: false,
      steps: [
        { action: 'place', kind: 'belt', text: 'Place a belt next to the ore mine (tap a meadow cell).' },
        { action: 'place', kind: 'belt', text: 'Keep laying belts toward the Exchange.' },
        { action: 'deliver', text: 'Watch the ore reach the Exchange and sell. Run the simulation with the play button.' }
      ]
    },
    {
      id: 'machines', name: 'Add a smelter',
      text: 'Machines refine goods into more valuable forms. A smelter turns ore into ingots. Feed it with a belt, and let its output side face onward.',
      layout: 'ford', recipes: ['smelt'], contracts: { ingot: 2 }, gold: 130, tickLimit: 240, upgrades: false,
      steps: [
        { action: 'place', kind: 'machine', recipe: 'smelt', text: 'Place a smelter on the ore line.' },
        { action: 'craft', text: 'Run the simulation until the smelter forges an ingot.' },
        { action: 'deliver', text: 'Sell an ingot at the Exchange.' }
      ]
    },
    {
      id: 'rotate', name: 'Change direction',
      text: 'Belts and machines move goods the way they face. Use the rotate tool (or R) to turn a building.',
      layout: 'bend', recipes: [], contracts: { ore: 3 }, gold: 80, tickLimit: 220, upgrades: false,
      steps: [
        { action: 'place', kind: 'belt', text: 'Place a belt.' },
        { action: 'rotate', text: 'Rotate any belt so it points around the rocks.' },
        { action: 'deliver', text: 'Finish the line and sell some ore.' }
      ]
    },
    {
      id: 'upgrade', name: 'Tune the works',
      text: 'Upgrading a machine makes it work faster. Click a machine with the upgrade tool.',
      layout: 'ford', recipes: ['smelt'], contracts: { ingot: 4 }, gold: 220, tickLimit: 240, upgrades: true,
      steps: [
        { action: 'place', kind: 'machine', recipe: 'smelt', text: 'Place a smelter.' },
        { action: 'upgrade', text: 'Upgrade the smelter to level 2.' },
        { action: 'deliver', text: 'Sell the ingots to finish the lesson.' }
      ]
    },
    {
      id: 'contracts', name: 'Fill the contract',
      text: 'Contracts order specific goods. Fulfill every line before the tick limit to win the round — leftover gold and spare time add to your score.',
      layout: 'pasture', recipes: ['weave'], contracts: { cloth: 3, ore: 2 }, gold: 150, tickLimit: 260, upgrades: false,
      steps: [
        { action: 'deliver', text: 'Build lines from both the pasture and the mine, with a loom on the wool line.' },
        { action: 'win', text: 'Complete both contract lines to win.' }
      ]
    }
  ];

  // ---------- challenges ----------
  var CHALLENGES = [
    { id: 'shoestring', name: 'Shoestring', desc: 'A tight purse: 90 gold, ten ingots.', layout: 'ford', recipes: ['smelt'], contracts: { ingot: 10 }, gold: 90, tickLimit: 210, upgrades: true, theme: 'canyon', seed: 1101 },
    { id: 'express', name: 'Express', desc: 'Six plates before the whistle: 190 ticks.', layout: 'bend', recipes: ['smelt', 'press'], contracts: { plate: 6 }, gold: 260, tickLimit: 190, upgrades: true, theme: 'ember', seed: 1102 },
    { id: 'bare-hands', name: 'Bare Hands', desc: 'No upgrades allowed. Twelve ingots.', layout: 'quarry', recipes: ['smelt'], contracts: { ingot: 12 }, gold: 200, tickLimit: 260, upgrades: false, theme: 'frost', seed: 1103 },
    { id: 'lean', name: 'Lean Works', desc: 'Only 16 buildings for six cloth.', layout: 'pasture', recipes: ['weave'], contracts: { cloth: 6 }, gold: 180, tickLimit: 240, upgrades: true, theme: 'dusk', buildLimit: 16, seed: 1104 },
    { id: 'grand-vale', name: 'Grand Vale', desc: 'Every trade at once: garments, frames, plates.', layout: 'crossroads', recipes: ['smelt', 'press', 'saw', 'carpentry', 'weave', 'tailor'], contracts: { garment: 6, frame: 6, plate: 6 }, gold: 620, tickLimit: 340, upgrades: true, theme: 'meadow', seed: 1105 }
  ];

  // Practice difficulty presets (seed is chosen per session).
  var PRACTICE = {
    relaxed: { name: 'Relaxed', desc: 'No tick limit. Learn the vale at your pace.', layout: 'basin', recipes: ['smelt', 'saw', 'weave'], contracts: { ingot: 6, plank: 6, cloth: 6 }, gold: 300, tickLimit: 0, upgrades: true, theme: 'meadow' },
    standard: { name: 'Standard', desc: 'A balanced round with a fair clock.', layout: 'delta', recipes: ['smelt', 'saw', 'weave'], contracts: { ingot: 8, plank: 8, cloth: 8 }, gold: 320, tickLimit: 280, upgrades: true, theme: 'frost' },
    veteran: { name: 'Veteran', desc: 'Long chains, lean purse, brisk clock.', layout: 'delta', recipes: ['smelt', 'press', 'weave', 'tailor'], contracts: { plate: 6, garment: 6 }, gold: 400, tickLimit: 280, upgrades: true, theme: 'dusk' }
  };

  // Score chase: open-ended, fixed seed pool, ranked by total score.
  var SCORE_CHASE = {
    id: 'score-chase', name: 'Score Chase',
    layout: 'basin', recipes: ['smelt', 'press', 'saw', 'carpentry', 'weave', 'tailor'],
    contracts: { plate: 8, frame: 8, garment: 8 },
    gold: 500, tickLimit: 360, upgrades: true, theme: 'meadow', seed: 777001
  };

  // ---------- cfg builder ----------

  var counter = 0;
  function stageCfg(def, kind, seedOverride) {
    var geo = layoutToTerrain(def.layout);
    var cfg = {
      id: def.id || ('custom-' + (++counter)),
      version: CONTENT_VERSION,
      kind: kind || 'journey',
      seed: (seedOverride != null ? seedOverride : (def.seed != null ? def.seed : RNG.hashString('assembly-vale:' + (def.id || def.name)))) >>> 0,
      board: { cols: geo.cols, rows: geo.rows },
      terrain: geo.terrain,
      sources: geo.sources,
      sink: geo.sink,
      goods: GOODS,
      recipes: RECIPES.filter(function (r) { return def.recipes.indexOf(r.id) >= 0; }),
      allowedRecipes: def.recipes.slice(),
      beltCost: BELT_COST,
      upgradeCosts: UPGRADE_COSTS.slice(),
      gold: def.gold,
      contracts: Object.assign({}, def.contracts),
      tickLimit: def.tickLimit || 0,
      buildLimit: def.buildLimit || 0,
      upgrades: def.upgrades !== false,
      mechanics: { undo: kind === 'practice' || kind === 'learn', hint: true },
      par: { ticks: Math.floor((def.tickLimit || 0) * 0.7), builds: 0 },
      theme: def.theme || 'meadow',
      name: def.name,
      desc: def.desc || '',
      mastery: !!def.mastery
    };
    return cfg;
  }

  function journeyCfg(index) {
    return stageCfg(JOURNEY[index], 'journey');
  }

  function lessonCfg(index) {
    var l = LESSONS[index];
    var cfg = stageCfg(l, 'learn');
    cfg.lesson = { id: l.id, steps: l.steps.map(function (s) { return Object.assign({}, s); }) };
    return cfg;
  }

  function challengeCfg(id) {
    var c = CHALLENGES.filter(function (x) { return x.id === id; })[0];
    return c ? stageCfg(c, 'challenge') : null;
  }

  function practiceCfg(difficulty, seed) {
    var p = PRACTICE[difficulty] || PRACTICE.standard;
    var cfg = stageCfg(Object.assign({ id: 'practice-' + difficulty }, p), 'practice', seed);
    cfg.mechanics.undo = true;
    return cfg;
  }

  function scoreChaseCfg(seed) {
    return stageCfg(SCORE_CHASE, 'score', seed != null ? seed : SCORE_CHASE.seed);
  }

  // ---------- daily (immutable per UTC date) ----------

  function dailyConfig(dateStr) { // 'YYYY-MM-DD'
    var seed = RNG.hashString('assembly-vale-daily:' + dateStr) >>> 0;
    var rng = RNG.derive(seed, RNG.STREAM_RULES);
    var day = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
    var tier = day % 3; // rotates recipe depth through the week
    // Each set lists only layouts that hold every raw source the set needs.
    var sets = [
      { recipes: ['smelt', 'weave'], contracts: { ingot: 8, cloth: 8 }, gold: 260,
        layouts: ['pasture', 'basin', 'delta'] },
      { recipes: ['smelt', 'saw', 'weave'], contracts: { ingot: 8, plank: 8, cloth: 6 }, gold: 340,
        layouts: ['delta', 'crossroads'] },
      { recipes: ['smelt', 'press', 'saw', 'carpentry', 'weave', 'tailor'], contracts: { plate: 5, frame: 5, garment: 5 }, gold: 560,
        layouts: ['delta', 'crossroads'] }
    ];
    var pick = sets[tier];
    var layout = pick.layouts[rng.int(pick.layouts.length)];
    var theme = THEME_ORDER[rng.int(THEME_ORDER.length)];
    return stageCfg({
      id: 'daily-' + dateStr, name: 'Daily ' + dateStr,
      layout: layout, recipes: pick.recipes, contracts: pick.contracts,
      gold: pick.gold, tickLimit: 300, upgrades: true, theme: theme, seed: seed
    }, 'daily');
  }

  // ---------- validators (offline content checks) ----------

  // Chain of recipes needed to produce `good` (empty for raw goods).
  function recipeChain(good) {
    var chain = [], g = good, guard = 0;
    while (guard++ < 8) {
      var r = RECIPES.filter(function (x) { return x.output === g; })[0];
      if (!r) break;
      chain.unshift(r);
      g = r.input;
    }
    return { chain: chain, raw: g };
  }

  // Basic legality + plausibility: every contract line is producible from an
  // on-map source through allowed recipes, and the purse covers one chain.
  function validateStage(def) {
    var errors = [];
    var geo;
    try { geo = layoutToTerrain(def.layout); } catch (e) { return [e.message]; }
    var srcItems = {};
    geo.sources.forEach(function (s) { srcItems[s.item] = true; });
    Object.keys(def.contracts).forEach(function (good) {
      if (GOODS[good] == null) { errors.push(def.id + ': unknown good ' + good); return; }
      var info = recipeChain(good);
      if (!srcItems[info.raw]) {
        errors.push(def.id + ': no source for ' + info.raw + ' (needed by ' + good + ')');
      }
      var cost = 0;
      info.chain.forEach(function (r) {
        if (def.recipes.indexOf(r.id) < 0) errors.push(def.id + ': recipe ' + r.id + ' not allowed for ' + good);
        cost += r.cost;
      });
      cost += BELT_COST * 4; // a few belts minimum
      if (def.gold < cost) errors.push(def.id + ': gold ' + def.gold + ' below minimum build ~' + cost + ' for ' + good);
    });
    if (!def.contracts || !Object.keys(def.contracts).length) errors.push(def.id + ': no contracts');
    return errors;
  }

  return {
    CONTENT_VERSION: CONTENT_VERSION,
    GOODS: GOODS,
    RECIPES: RECIPES,
    GOOD_META: GOOD_META,
    BELT_COST: BELT_COST,
    UPGRADE_COSTS: UPGRADE_COSTS,
    THEMES: THEMES,
    THEME_ORDER: THEME_ORDER,
    LAYOUTS: LAYOUTS,
    JOURNEY: JOURNEY,
    LESSONS: LESSONS,
    CHALLENGES: CHALLENGES,
    PRACTICE: PRACTICE,
    SCORE_CHASE: SCORE_CHASE,
    layoutToTerrain: layoutToTerrain,
    stageCfg: stageCfg,
    journeyCfg: journeyCfg,
    lessonCfg: lessonCfg,
    challengeCfg: challengeCfg,
    practiceCfg: practiceCfg,
    scoreChaseCfg: scoreChaseCfg,
    dailyConfig: dailyConfig,
    recipeChain: recipeChain,
    validateStage: validateStage
  };
});
