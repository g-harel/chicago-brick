/* Copyright 2018 Google Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/

define(function(require) {
  'use strict';

  var _ = require('underscore');

  const asset = require('client/asset/asset');
  const conform = require('lib/conform');
  var debug = require('debug')('wall:client_module');
  var debugFactory = require('debug');
  var error = require('client/util/log').error(debug);
  const inject = require('lib/inject');
  var geometry = require('lib/geometry');
  var moduleInterface = require('lib/module_interface');
  var network = require('client/network/network');
  var peerNetwork = require('client/network/peer');
  var StateManager = require('client/state/state_manager');
  var timeManager = require('client/util/time');
  var TitleCard = require('client/title_card');
  var moduleTicker = require('client/modules/module_ticker');
  const assert = require('lib/assert');

  function createNewContainer(name) {
    var newContainer = document.createElement('div');
    newContainer.className = 'container';
    newContainer.id = 't-' + timeManager.now();
    newContainer.style.opacity = 0.0;
    newContainer.setAttribute('moduleName', name);
    document.querySelector('#containers').appendChild(newContainer);
    return newContainer;
  }

  class ClientModule {
    constructor(name, path, config, titleCard, deadline, geo) {
      // The module name.
      this.name = name;

      // The path to the main file of this module.
      this.path = path;

      // The module config.
      this.config = config;

      // The title card instance for this module.
      this.titleCard = titleCard;

      // Absolute time when this module is supposed to be visible. Module will
      // actually be faded in by deadline + 5000ms.
      this.deadline = deadline;

      // The wall geometry.
      this.geo = geo;

      // Globals that are associated with this module.
      this.globals = {};

      // The dom container for the module's content.
      this.container = null;

      // Module class instance.
      this.instance = null;

      // Network instance for this module.
      this.network = null;

      // The name of the requirejs context for this module.
      this.contextName = null;
    }

    // Deserializes from the json serialized form of ModuleDef in the server.
    static deserialize(bits) {
      if (bits.module.name == '_empty') {
        return ClientModule.newEmptyModule(bits.time);
      }
      return new ClientModule(
        bits.module.name,
        bits.module.path,
        bits.module.config,
        new TitleCard(bits.module),
        bits.time,
        new geometry.Polygon(bits.geo)
      );
    }

    static newEmptyModule(deadline = 0) {
      return new ClientModule(
        'empty-module',
        '',
        {},
        new TitleCard({}),
        deadline,
        new geometry.Polygon([{x: 0, y:0}])
      );
    }

    async instantiate() {
      this.container = createNewContainer(this.name);

      if (!this.path) {
        return Promise.resolve();
      }

      this.network = network.forModule(
        `${this.geo.extents.serialize()}-${this.deadline}`);
      let openNetwork = this.network.open();

      this.contextName = 'module-' + this.deadline;
      let classes = {};

      const fakeEnv = {
        asset,
        debug: debugFactory('wall:module:' + this.name),
        game: undefined,
        network: openNetwork,
        titleCard: this.titleCard.getModuleAPI(),
        state: new StateManager(openNetwork),
        globalWallGeometry: this.geo,
        wallGeometry: new geometry.Polygon(this.geo.points.map(function(p) {
          return {x: p.x - this.geo.extents.x, y: p.y - this.geo.extents.y};
        }, this)),
        peerNetwork,
        assert,
      }
      const {load} = await import(this.path);
      if (!load) {
        throw new Error(`${this.name} did not export a 'load' function!`);
      }
      const {client} = inject(load, fakeEnv);
      conform(client, moduleInterface.Client);

      this.instance = new client(this.config);
    }

    willBeHiddenSoon() {
      if (!this.path) {
        return true;
      }
      try {
        this.instance.willBeHiddenSoon();
      } catch(e) {
        error(e);
      }
      return true;
    }

    // Returns true if module is still OK.
    willBeShownSoon() {
      if (!this.path) {
        return true;
      }
      try {
        this.instance.willBeShownSoon(this.container, this.deadline);
        return true;
      } catch(e) {
        error(e);
        return false;
      }
      return true;
    }

    // Returns true if module is still OK.
    fadeIn(deadline) {
      this.container.style.transition =
          'opacity ' + timeManager.until(deadline).toFixed(0) + 'ms';
      this.container.style.opacity = 1.0;

      if (!this.path) {
        return true;
      }
      try {
        this.instance.beginFadeIn(deadline);
      } catch(e) {
        error(e);
        return false;
      }
      moduleTicker.add(this.name, this.instance, this.globals);
      Promise.delay(timeManager.until(deadline)).done(() => {
        this.titleCard.enter();
        try {
          this.instance.finishFadeIn();
        } catch(e) {
          error(e);
        }
      });
      return true;
    }

    fadeOut(deadline) {
      if (this.container) {
        this.container.style.transition =
            'opacity ' + timeManager.until(deadline).toFixed(0) + 'ms';
        this.container.style.opacity = 0.0;
      }
      if (!this.path) {
        return true;
      }
      this.titleCard.exit();
      try {
        this.instance.beginFadeOut(deadline);
      } catch(e) {
        error(e);
      }
      return true;
    }

    dispose() {
      if (this.container) {
        this.container.remove();
        this.container = null;
      }
      if (!this.path) {
        return true;
      }
      this.titleCard.exit();  // Just in case.
      moduleTicker.remove(this.instance);

      if (this.network) {
        this.network.close();
      }
      try {
        this.instance.finishFadeOut();
      } catch(e) {
        error(e);
      }

      return true;
    }
  }

  return ClientModule;
});
