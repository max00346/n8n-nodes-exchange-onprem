'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.cpSync(path.join(root, 'src'), path.join(root, 'dist'), { recursive: true });
