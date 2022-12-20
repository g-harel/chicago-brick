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
import blobs2Animate from "https://esm.sh/blobs@2.2.1-beta.1/v2/animate";

import { CanvasSurface } from "../../client/surface/canvas_surface.ts";
import { ModuleState } from "../../client/network/state_manager.ts";
import { Client } from "../../client/modules/module_interface.ts";
import { Polygon } from "../../lib/math/polygon2d.ts";

const GOOGLE_COLORS = ["#3369E8", "#D50F25", "#EEB211", "#009925"];
const BLOB_PADDING = 100;

export function load(state: ModuleState, wallGeometry: Polygon) {
  class BallsClient extends Client {
    surface: CanvasSurface | undefined = undefined;
    ctx!: CanvasRenderingContext2D;
    animation: any;
    color!: string;

    finishFadeOut() {
      if (this.surface) {
        this.surface.destroy();
      }
    }

    willBeShownSoon(container: HTMLElement) {
      this.surface = new CanvasSurface(container, wallGeometry);
      this.ctx = this.surface.context;

      this.animation = blobs2Animate.canvasPath();
      this.color = GOOGLE_COLORS[Math.floor(Math.random() * GOOGLE_COLORS.length)];

      const blobSize = -BLOB_PADDING + Math.min(
        this.surface!.virtualRect.w,
        this.surface!.virtualRect.h,
      );

      const genBlobOptions = () => ({
        seed: Math.random(),
        extraPoints: 6,
        randomness: 3,
        size: blobSize,
      });

      // Offset blob to the center of the canvas.
      const blobCanvasOptions = {
        offsetX: (this.surface!.virtualRect.w - blobSize) / 2,
        offsetY: (this.surface!.virtualRect.h - blobSize) / 2,
      };

      // Generate new keyframe to transition to.
      const loopAnimation = () => {
        this.animation.transition({
          duration: 4000,
          timingFunction: "ease",
          callback: loopAnimation,
          blobOptions: genBlobOptions(),
          canvasOptions: blobCanvasOptions,
        });
      };

      // Initial keyframe.
      this.animation.transition({
        duration: 0,
        callback: loopAnimation,
        blobOptions: genBlobOptions(),
        canvasOptions: blobCanvasOptions,
      });
    }

    draw(time: number) {
      this.ctx.clearRect(
        0,
        0,
        this.surface!.virtualRect.w,
        this.surface!.virtualRect.h,
      );

      this.ctx.fillStyle = this.color;
      this.ctx.fill(this.animation.renderFrame());
    }
  }

  return { client: BallsClient };
}
