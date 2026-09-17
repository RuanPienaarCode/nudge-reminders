'use strict';
/* The workspace view hosting the board. */

const { ItemView } = require('obsidian');
const { VIEW_TYPE } = require('./constants');
const { mountBoard } = require('./board');

class NudgeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = true;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Nudge'; }
  getIcon() { return 'bell'; }

  async onOpen() {
    this.ctl = mountBoard(this);
    this.appCtl = this.ctl;
    await this.ctl.start();
  }

  async onClose() {
    if (this.ctl) { this.ctl.stop(); this.ctl = null; this.appCtl = null; }
  }
}

module.exports = { NudgeView };
