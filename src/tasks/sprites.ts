import changeCase from "change-case";
import merge from "lodash/merge";
import omit from "lodash/omit";
import mergeStream from "merge-stream";
import minimatch from "minimatch";
import path from "path";

import { dest } from "gulp";

import GulpHeader from "gulp-header";
import GulpIf from "gulp-if";
import GulpSort from "gulp-sort";
import GulpSpriteSmith from "gulp.spritesmith";

import Task, { IGulpOptions } from "./task";

export default class Sprites extends Task {
  public static readonly taskName: string = "sprites";

  private static mapMatchPatterns(pattern: string): string {
    return ("**/" + pattern).replace("//", "/");
  }

  constructor(name: string, settings: object) {
    super(name, settings);

    this.withLinter = false;
    this.defaultDest = false;

    this.settings.src = this.srcGlobs();

    const defaultSettings: {} = {
      prefix: "sprite",
    };

    this.settings.settings = merge(defaultSettings, this.settings.settings || {});
  }

  protected buildSpecific(stream: NodeJS.ReadWriteStream, options?: IGulpOptions): NodeJS.ReadWriteStream {
    const prefix = this.settings.settings.prefix === "" ? "" : `${this.settings.settings.prefix}-`;

    const sanitizedTaskName = changeCase.paramCase(this.taskName().replace("sprites:", prefix));

    const imgName = sanitizedTaskName + ".png";
    const imgNameRetina = sanitizedTaskName + "@2x.png";
    const imgNameAbs = path.join(this.settings.dst, imgName);
    const imgNameAbsRetina = path.join(this.settings.dst, imgNameRetina);

    const spritesmithDefaultSettings = {
      cssName: "_" + sanitizedTaskName + ".scss",
      cssSpritesheetName: "spritesheet-" + sanitizedTaskName,
      cssVarMap: (spriteImg: any): void => {
        spriteImg.name = `${sanitizedTaskName}-${spriteImg.name}`;

        if (this.settings["src-2x"]) {
          let match = false;

          this.settings["src-2x"].map(Sprites.mapMatchPatterns).forEach((pattern: string): void => {
            match = match || minimatch(spriteImg.source_image, pattern);
          });

          if (match) {
            spriteImg.name += "-retina";
          }
        }
      },
      imgName: imgNameAbs,
      imgPath: path.join(this.settings.settings.sass.rel, imgName),
      padding: 4,
    };

    let spritesmithSettings = merge(spritesmithDefaultSettings, omit(this.settings.settings, ["prefix", "sass"]));

    if (this.settings["src-1x"] && this.settings["src-2x"]) {
      spritesmithSettings = merge(spritesmithSettings, {
        cssRetinaGroupsName: `${sanitizedTaskName}-retina`,
        cssRetinaSpritesheetName: `spritesheet-${sanitizedTaskName}-retina`,
        retinaImgName: imgNameAbsRetina,
        retinaImgPath: path.join(this.settings.settings.sass.rel, imgNameRetina),
        retinaSrcFilter: this.settings["src-2x"],
      });
    }

    const sortFiles =
      (typeof this.settings.algorithm === "undefined" || this.settings.algorithm !== "binary-tree") &&
      typeof this.settings.algorithmOpts !== "undefined" &&
      this.settings.algorithmOpts.sort !== false;

    const sprite = stream.pipe(GulpIf(sortFiles, GulpSort())).pipe(GulpSpriteSmith(spritesmithSettings));

    return mergeStream(
      sprite.img.pipe(dest(".", options)),
      sprite.css.pipe(GulpHeader("// sass-lint:disable-all\n\n")).pipe(dest(this.settings.settings.sass.dst, options))
    );
  }

  private srcGlobs(): string[] {
    if (this.settings["src-1x"] && this.settings["src-2x"]) {
      return [...this.settings["src-1x"], ...this.settings["src-2x"]];
    }

    return this.settings.src;
  }
}
