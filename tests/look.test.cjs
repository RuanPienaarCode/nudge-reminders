'use strict';
/* Light or dark glass: 'auto' follows Obsidian's theme; a pinned mode wins. */
const assert = require('node:assert');
const { isLightLook, DEFAULT_SETTINGS, MODES } = require('../src/constants');

assert.strictEqual(DEFAULT_SETTINGS.mode, 'auto', 'the default follows the theme');
assert.strictEqual(isLightLook('auto', true), true);
assert.strictEqual(isLightLook('auto', false), false);
assert.strictEqual(isLightLook('light', false), true, 'pinned light ignores a dark theme');
assert.strictEqual(isLightLook('dark', true), false, 'pinned dark ignores a light theme');
assert.strictEqual(isLightLook(undefined, true), true, 'settings saved before the mode existed follow the theme');
assert.strictEqual(isLightLook('bogus', false), false);
assert.deepStrictEqual(MODES.map(m => m.id), ['auto', 'light', 'dark']);

console.log('look ok');
