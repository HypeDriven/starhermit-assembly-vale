// Localization coverage: every string id the client uses (T("…") in
// native/*.ts, and the id families it builds: content names, directions,
// tools, refusal reasons, the legend) has a text in all nine locales, with
// its placeholders intact. Run: node --test tests/i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';

const req = createRequire(import.meta.url);
const STRINGS = JSON.parse(readFileSync(new URL('../assets/strings.json', import.meta.url), 'utf8'));
const Content = req('../js/content.js');
const Rules = req('../js/rules.js');
const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT', 'fr-BE', 'de-BE', 'en-SG', 'en-HK', 'en-BQ', 'es-CO', 'de-IT', 'fr-IT', 'es-CL', 'es-AR', 'es-EC', 'ja-JP', 'nl-BE', 'zh-SG', 'nl-NL', 'id-ID', 'vi-VN', 'de-BR', 'ms-SG', 'ta-SG', 'zh-HK', 'yue-HK', 'fi-FI', 'sv-FI', 'et-EE', 'da-DE', 'sl-IT', 'ru-FI', 'ru-EE', 'lb-BE', 'co-FR', 'eu-FR', 'ca-FR', 'oc-FR', 'fur-IT', 'ca-IT', 'oc-IT', 'ca-ES', 'eu-ES', 'gl-ES', 'su-ID', 'bew-ID', 'km-VN'];

function usedKeys() {
  const keys = new Set();
  const dir = new URL('../native/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\bT\(\s*"([a-zA-Z][\w.-]*)"/g)) keys.add(m[1]);
    for (const m of src.matchAll(/T\([^()"]*\?\s*"([\w.-]+)"\s*:\s*"([\w.-]+)"/g)) { keys.add(m[1]); keys.add(m[2]); }
    for (const m of src.matchAll(/\["(lg\.\w+)"/g)) keys.add(m[1]);
  }
  for (const st of Content.JOURNEY) keys.add('j.' + st.id);
  for (const l of Content.LESSONS) { keys.add('lesson.' + l.id); keys.add('lessonx.' + l.id); }
  for (const c of Content.CHALLENGES) { keys.add('ch.' + c.id); keys.add('chd.' + c.id); }
  for (const d of Object.keys(Content.PRACTICE)) { keys.add('pr.' + d); keys.add('prd.' + d); }
  for (const g of Object.keys(Content.GOOD_META)) keys.add('good.' + g);
  for (const r of Content.RECIPES) keys.add('rec.' + r.id);
  for (const d of Object.keys(Rules.DIRS)) keys.add('dir.' + d);
  for (const t of ['belt', 'machine', 'rotate', 'remove', 'upgrade']) keys.add('tn.' + t);
  for (const r of Object.values(Rules.INVALID)) keys.add('reason.' + r);
  for (const k of ['ev.placeBelt', 'ev.placeMachine', 'ev.removeBelt', 'ev.removeMachine', 'ev.rotate', 'ev.upgrade', 'ev.deliver',
    'ev.contract', 'ev.spoil', 'ev.win', 'ev.lose', 'st.started', 'st.pickTool', 'st.pickMachine', 'st.nothingUndo', 'st.undid',
    'sound.on', 'sound.off', 'act.stop', 'act.auto', 'res.won', 'res.over', 'res.resigned', 'res.lost']) keys.add(k);
  return [...keys];
}

test('the client finds its ids (the scan is not empty)', () => {
  const keys = usedKeys();
  for (const k of ['m.play', 'act.tick', 'info.contract', 'sh.offline', 'keys.line', 'lg.source', 'hint.belt']) assert.ok(keys.includes(k), k);
});

test('every used id has a text in every locale, placeholders intact', () => {
  assert.deepEqual(Object.keys(STRINGS), LOCALES);
  const problems = [];
  for (const k of usedKeys()) {
    if (k.startsWith('starhermit.')) continue; // the engine's own
    const want = (STRINGS['en-GB'][k] ?? '').match(/\{\w+\}/g)?.sort().join() ?? '';
    if (!STRINGS['en-GB'][k]) { problems.push(`en-GB missing ${k}`); continue; }
    for (const loc of LOCALES) {
      const v = STRINGS[loc][k];
      if (typeof v !== 'string' || !v.length) { problems.push(`${loc} missing ${k}`); continue; }
      if (((v.match(/\{\w+\}/g) ?? []).sort().join()) !== want) problems.push(`${loc} placeholders ${k}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every table holds the same ids (no locale left behind)', () => {
  const keys = Object.keys(STRINGS['en-GB']).sort();
  for (const loc of LOCALES) assert.deepEqual(Object.keys(STRINGS[loc]).sort(), keys, loc);
});
