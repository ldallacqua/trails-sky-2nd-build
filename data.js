// Build data for the page. Edit this file to update the build; app.js only renders it.
// Elemental values come from the in-game Value box (screenshots) and Kago's quartz table.

window.BUILD = {
  version: 'v15',
  updated: '2026-10-05',
  chapter: 'Chapter 4 — Rolent',

  // el = quartz colour (decides which locked slot it fits); v = elemental values; fx = effect
  quartz: {
    'Breeze':       { el: 'wind',   v: { wind: 3, water: 3 }, fx: 'Item effect +30%, item range +30m' },
    'HP 3':         { el: 'water',  v: { water: 3 }, fx: 'Max HP +35%' },
    'Action 3':     { el: 'time',   v: { time: 3 }, fx: 'SPD +25%' },
    'Action 4':     { el: 'time',   v: { time: 4 }, fx: 'SPD +30%' },
    'Golden Guard': { el: 'space',  v: { space: 3, earth: 2 }, fx: 'DEF/ADF +50, CP regen in a pinch' },
    'Defense 3':    { el: 'earth',  v: { earth: 3 }, fx: 'DEF +35%' },
    'Defense 4':    { el: 'earth',  v: { earth: 4 }, fx: 'DEF +40%' },
    'Impede 3':     { el: 'mirage', v: { mirage: 3 }, fx: '60% to cancel casting on attack' },
    'Hit 3':        { el: 'space',  v: { space: 3 }, fx: 'STR +45, hit +90%' },
    'Jade Guard':   { el: 'wind',   v: { wind: 3, space: 2 }, fx: 'Insight for 2 turns in a pinch' },
    'Mind 3':       { el: 'water',  v: { water: 3 }, fx: 'ATS +25%' },
    'Mind 4':       { el: 'water',  v: { water: 4 }, fx: 'ATS +30%' },
    'Evade 3':      { el: 'wind',   v: { wind: 3 }, fx: 'EVA +7%' },
    'Shield 4':     { el: 'wind',   v: { wind: 4 }, fx: 'ADF +40%, magic EVA +9%, SPD +3' },
    'EP Cut 3':     { el: 'space',  v: { space: 3, time: 2, mirage: 1 }, fx: 'EP cost ×0.75' },
    'EP Cut 4':     { el: 'space',  v: { space: 4, time: 2, mirage: 2 }, fx: 'EP cost ×0.7' },
    'Cast 3':       { el: 'time',   v: { time: 3, space: 1, mirage: 2 }, fx: 'ATS +45, cast time ×0.6' },
    'Mercy':        { el: 'water',  v: { water: 4, earth: 4 }, fx: 'Healing Arts +30%' },
    'Heal':         { el: 'water',  v: { water: 3, fire: 3 }, fx: 'HP regen on the field' },
    'EP 3':         { el: 'mirage', v: { mirage: 3, time: 1, space: 2 }, fx: 'Max EP +35%' },
    'EP 4':         { el: 'mirage', v: { mirage: 4, time: 2, space: 2 }, fx: 'Max EP +40%' },
    'Sage Sight':   { el: 'space',  v: { space: 2, water: 2, wind: 2 }, fx: 'Arts vs. weakness +30%' },
    'Topaz Guard':  { el: 'earth',  v: { earth: 3, mirage: 2 }, fx: 'DEF/ADF up in a pinch' },
    'Bastion':      { el: 'earth',  v: { earth: 4, water: 3, space: 3 }, fx: 'STR/DEF +50, shields on self ×3' },
    'Scent':        { el: 'wind',   v: { wind: 3, earth: 3, water: 3, fire: 3 }, fx: 'Enemies target the wearer more' },
    'Attack 4':     { el: 'fire',   v: { fire: 4 }, fx: 'STR +30%, DEF −12%' }
  },

  // One-copy quartz. found = already owned (the page lets you tick the rest).
  uniques: [
    { key: 'action4',  name: 'Action 4',  where: 'Milch Main Road', chest: 'monster chest', to: 'Schera',  slot: 'lower-right', replaces: 'Action 3',    found: true },
    { key: 'defense4', name: 'Defense 4', where: 'Milch Main Road', to: 'Zin',     slot: 'lower-right', replaces: 'Defense 3' },
    { key: 'mind4',    name: 'Mind 4',    where: 'Elize Turnpike',  to: 'Schera',  slot: 'top',         replaces: 'Mind 3' },
    { key: 'attack4',  name: 'Attack 4',  where: 'Malga Trail',     to: 'Zin',     slot: 'top',         replaces: 'Evade 3' },
    { key: 'ep4',      name: 'EP 4',      where: 'Mistwald', chest: 'monster chest', to: 'Kloe',    slot: 'lower-left',  replaces: 'EP 3' },
    { key: 'epcut4',   name: 'EP Cut 4',  where: 'Esmelas Tower 4F', chest: 'monster chest', to: 'Schera', slot: 'upper-left', replaces: 'EP Cut 3' },
    { key: 'shield4',  name: 'Shield 4',  where: 'Esmelas Tower 5F', to: 'Schera', slot: 'upper-right', replaces: 'Evade 3' },
    { key: 'bastion',  name: 'Bastion',   where: 'Report 45 quests', to: 'Zin',    slot: 'center',      replaces: 'Topaz Guard' }
  ],

  // Slot keys: c, t, ur, lr, b, ll, ul.
  // target = what to slot. needs/until = a one-copy quartz and what sits there before you own it.
  // shot = what the last screenshot showed (omit when it already matched). lock = slot colour.
  characters: [
    {
      id: 'estelle', name: 'Estelle', role: 'Buffer, item healer, interrupter',
      lines: [['c', 't', 'ul', 'll'], ['c', 'ur', 'lr', 'b']],
      slots: {
        c:  { target: 'Breeze' },
        t:  { target: 'HP 3' },
        ul: { target: 'Action 3', shot: 'Action 4' },
        ur: { target: 'Golden Guard' },
        ll: { target: 'Defense 3' },
        lr: { target: 'Impede 3' },
        b:  { target: 'Hit 3' }
      },
      accessories: ['Force Seal+', 'Red Sphere+'],
      arts: [
        { label: 'Heals', list: 'Teara, La Tear, La Curia, Thelas (revive)' },
        { label: 'Support', list: 'Earth Guard (shield), Saint' }
      ],
      notes: [
        'Dropping to Action 3 loses no Art and about 2 SPD. Schera does more with Action 4.',
        'Keep Golden Guard and Hit 3 on the same line. Space 6 there is what gives her Thelas and La Tear.',
        'Cast Earth Guard on Zin once he has Bastion.'
      ]
    },
    {
      id: 'schera', name: 'Scherazard', role: 'Turn engine, wind Arts, debuffs',
      lines: [['c', 'b'], ['c', 't', 'ur', 'ul', 'll', 'lr']],
      slots: {
        c:  { target: 'Jade Guard', lock: 'wind' },
        t:  { target: 'Mind 4', needs: 'mind4', until: 'Mind 3' },
        ur: { target: 'Shield 4', needs: 'shield4', until: 'Evade 3', lock: 'wind' },
        ul: { target: 'EP Cut 4', needs: 'epcut4', until: 'EP Cut 3' },
        ll: { target: 'Cast 3' },
        lr: { target: 'Action 4', needs: 'action4', until: 'Action 3', shot: 'Action 3' },
        b:  { target: 'Impede 3' }
      },
      accessories: ['Divine Cross', 'Victory Headband'],
      arts: [
        { label: 'Already has', list: 'Aero Storm, Clock Up EX, Anti-Sept All, Chaos Brand' },
        { label: 'Action 4 adds', list: 'Orbal Down (cancels casting, big delay, all stats down)' },
        { label: 'Mind 4 adds', list: 'La Teara (group heal), Athelas (stronger revive)' },
        { label: 'EP Cut 4 adds', list: 'Lost Mobius (top Space attack), Sylphen Wing (party ATS/ADF up)' }
      ],
      notes: [
        'Shield 4 is a free upgrade over Evade 3: same Wind-locked slot, more Wind, so no Art is lost.',
        'Evade 3 was only there because that slot is Wind-locked.',
        'Swap Victory Headband for Vajra X if you want Arts damage over CP gain.'
      ]
    },
    {
      id: 'kloe', name: 'Kloe', role: 'Main healer, weakness Arts, boss debuffs',
      lines: [['c', 't', 'ur', 'lr', 'b', 'll', 'ul']],
      slots: {
        c:  { target: 'Mercy', lock: 'water' },
        t:  { target: 'Heal', shot: 'Cobalt Guard', lock: 'water' },
        ul: { target: 'Action 3', shot: 'Septium Vein' },
        ur: { target: 'Cast 3', shot: 'Ingenuity' },
        ll: { target: 'EP 4', needs: 'ep4', until: 'EP 3' },
        lr: { target: 'Sage Sight' },
        b:  { target: 'Jade Guard', shot: 'Serendipity' }
      },
      accessories: ['Blue Sphere+', 'Feather Brooch+'],
      arts: [
        { label: 'Heals', list: 'Tearal, Tear-All, La Teara, La Tearal, La Curia, Athelas — all +30% from Mercy' },
        { label: 'Attack', list: 'Blue Ascension, Diamond Dust, Plasma Wave, Aero Storm, Lost Mobius, White Gehenna, Napalm Breath, Stone Impact' },
        { label: 'EP 4 adds', list: 'Silver Thorn' },
        { label: 'Support', list: 'Earth Wall, Earth Guard, La Crest, Sylphen Wing, Clock Up EX, Saint, Chaos Brand' }
      ],
      notes: [
        'The five white slots can be arranged in any order; she has one line.',
        'Heal is not for healing Arts. Its Fire 3 is what unlocks Plasma Wave and Napalm Breath.',
        'EP 3 / EP 4 supplies the Mirage that Tearal and Tear-All need. She has no EP Cut and her big Arts cost 360–420 EP.',
        'You need a second Jade Guard and a second Cast 3. Both can be synthesized.',
        'Septium Vein, Ingenuity and Serendipity are farming quartz. Swap them back in when grinding.',
        'Her SPD was 35 in the screenshot, far below everyone else. Action 3 and Feather Brooch+ matter most here.'
      ]
    },
    {
      id: 'zin', name: 'Zin', role: 'Taunt tank and main physical damage',
      lines: [['c', 'ul', 'll'], ['c', 't'], ['c', 'ur'], ['c', 'lr', 'b']],
      slots: {
        c:  { target: 'Bastion', needs: 'bastion', until: 'Topaz Guard', lock: 'earth' },
        t:  { target: 'Attack 4', needs: 'attack4', until: 'Evade 3' },
        ul: { target: 'Scent' },
        ur: { target: 'Action 3' },
        ll: { target: 'HP 3' },
        lr: { target: 'Defense 4', needs: 'defense4', until: 'Defense 3', lock: 'earth' },
        b:  { target: 'Hit 3' }
      },
      accessories: ['Master Beads X', 'Red Sphere+'],
      arts: [],
      notes: [
        'Attack 4: two guides pick Zin as this chapter’s main physical hitter, and he had no offensive quartz.',
        'Defense 4 more than covers Attack 4’s DEF penalty.',
        'Bastion: he holds Scent, so he is the one being hit. Have Estelle or Kloe cast Earth Guard on him.',
        'To confirm in-game: the cursor hid Zin’s Top slot in the screenshot. It should be white. If Attack 4 will not go in, the slot is locked.',
        'To confirm in-game: Bastion is an Earth quartz, so it should fit the Earth-locked center.'
      ]
    }
  ]
};
