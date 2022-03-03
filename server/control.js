/* Copyright 2019 Google Inc. All Rights Reserved.

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

import * as wallGeometry from './util/wall_geometry.js';
import * as time from './util/time.js';
import {emitter, clients} from './network/network.js';
import {getErrors} from './util/last_n_errors_logger.js';
import {loadAllModules} from './playlist/playlist_loader.js';
import {WebSocketServer} from 'ws';
import {EventEmitter} from 'events';
import {easyLog} from '../lib/log.js';
import {WS} from '../lib/websocket.js';

const log = easyLog('wall:control');

class WSS extends EventEmitter {
  constructor(options) {
    super();
    this.webSocketServer = new WebSocketServer(options);
    this.clientSockets = new Set();
    this.webSocketServer.on('listening', () => {
      log('Control server listening on', this.webSocketServer.address());
    });
    this.webSocketServer.on('connection', websocket => {
      const ws = WS.serverWrapper(websocket);
      this.clientSockets.add(ws);
      ws.on('disconnect', (code, reason) => {
        log.error(`Lost control client: ${code} Reason: ${reason}`);
        this.clientSockets.delete(ws);
        this.emit('disconnect', ws);
      });
      this.emit('connection', ws);
    });
  }
  sendToAllClients(msg, payload) {
    for (const websocket of this.clientSockets) {
      websocket.send(msg, payload);
    }
  }
}

// Basic server management hooks.
// This is just for demonstration purposes, since the real server
// will not have the ability to listen over http.
export class Control {
  constructor(playlistDriver, initialPlaylist, defsByName) {
    this.playlistDriver = playlistDriver;

    this.initialPlaylist = initialPlaylist;
    this.defsByName = defsByName;
  }

  installHandlers() {
    const wss = new WSS({host: 'localhost', port: 6001});
    let transitionData = {};
    this.playlistDriver.on('transition', data => {
      transitionData = data;
      wss.sendToAllClients('transition', data);
    });
    emitter.on('new-client', c => {
      wss.sendToAllClients('new-client', c.rect.serialize());
      c.socket.on('takeSnapshotRes', res => {
        wss.sendToAllClients('takeSnapshotRes', res);
      });
      c.socket.on('record-error', err => {
        wss.sendToAllClients('error', err);
      });
    });
    emitter.on('lost-client', c => {
      wss.sendToAllClients('lost-client', c.rect.serialize());
    });
    wss.on('connection', socket => {
      // When we transition to a new module, let this guy know.
      socket.send('time', {time: time.now()});
      socket.send('transition', transitionData);
      socket.send('clients', Object.values(clients).map(c => c.rect.serialize()));
      socket.send('wallGeometry', wallGeometry.getGeo().points);
      socket.send('errors', getErrors());

      socket.on('takeSnapshot', req => {
        const client = Object.values(clients).find(c => c.rect.serialize() == req.client);
        if (client) {
          client.socket.send('takeSnapshot', req);
        } else {
          socket.send('takeSnapshotRes', {
            ...req,
            error: `Client ${req.client} not found`
          });
        }
      });
      socket.on('newPlaylist', data => {
        const {playlist, moduleConfig} = data;
        loadAllModules(Object.values(moduleConfig), this.defsByName);
        this.playlistDriver.setPlaylist(playlist);
      });
      socket.on('resetPlaylist', () => {
        this.playlistDriver.setPlaylist(this.initialPlaylist);
      });
    });
    wss.sendToAllClients('time', {time: time.now()});
    setInterval(() => {
      wss.sendToAllClients('time', {time: time.now()});
    }, 20000);
  }
}
