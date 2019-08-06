import changeCase from "change-case";
import { dest } from "gulp";
import header from "gulp-header";
import gulpIf from "gulp-if";
import sort from "gulp-sort";
import spriteSmith from "gulp.spritesmith";
import merge from "lodash/merge";
import omit from "lodash/omit";
import mergeStream from "merge-stream";
import minimatch from "minimatch";
import path from "path";

import Task, { IGulpOptions } from "./task";

export default class Sprites extends Task {
  public static readonly taskName: string = "sprites";

  private static _mapMatchPatterns(pattern: string): string {
    return ("**/" + pattern).replace("//", "/");
  }

  constructor(name: string, settings: object) {
    super(name, settings);

    this._withLinter = false;
    this._defaultDest = false;

    this._settings.src = this._srcGlobs();

    const defaultSettings: {} = {
      prefix: "sprite",
    };

    this._settings.settings = merge(defaultSettings, this._settings.settings || {});
  }

  protected _buildSpecific(stream: NodeJS.ReadWriteStream, options?: IGulpOptions): NodeJS.ReadWriteStream {
    const prefix: string = this._settings.settings.prefix === "" ? "" : `${this._settings.settings.prefix}-`;
    const sanitizedTaskName: string = changeCase.paramCase(this._taskName().replace("sprites:", prefix));

    const imgName: string = sanitizedTaskName + ".png";
    const imgNameRetina: string = sanitizedTaskName + "@2x.png";
    const imgNameAbs: string = path.join(this._settings.dst, imgName);
    const imgNameAbsRetina: string = path.join(this._settings.dst, imgNameRetina);

    const spritesmithDefaultSettings: {} = {
      cssName: "_" + sanitizedTaskName + ".scss",
      cssSpritesheetName: "spritesheet-" + sanitizedTaskName,
      cssVarMap: (spriteImg: any): void => {
        spriteImg.name = `${sanitizedTaskName}-${spriteImg.name}`;

        if (this._settings["src-2x"]) {
          let match: boolean = false;

          this._settings["src-2x"].map(Sprites._mapMatchPatterns).forEach((pattern: string): void => {
            match = match || minimatch(spriteImg.source_image, pattern);
          });

          if (match) {
            spriteImg.name += "-retina";
          }
        }
      },
      imgName: imgNameAbs,
      imgPath: path.join(this._settings.settings.sass.rel, imgName),
      padding: 4,
    };

    let spritesmithSettings: {} = merge(spritesmithDefaultSettings, omit(this._settings.settings, ["prefix", "sass"]));

    if (this._settings["src-1x"] && this._settings["src-2x"]) {
      spritesmithSettings = merge(spritesmithSettings, {
        cssRetinaGroupsName: `${sanitizedTaskName}-retina`,
        cssRetinaSpritesheetName: `spritesheet-${sanitizedTaskName}-retina`,
        retinaImgName: imgNameAbsRetina,
        retinaImgPath: path.join(this._settings.settings.sass.rel, imgNameRetina),
        retinaSrcFilter: this._settings["src-2x"],
      });
    }

    const sortFiles: boolean =
      (typeof this._settings.algorithm === "undefined" || this._settings.algorithm !== "binary-tree") &&
      typeof this._settings.algorithmOpts !== "undefined" &&
      this._settings.algorithmOpts.sort !== false;

    const sprite: {
      css: NodeJS.ReadWriteStream;
      img: NodeJS.ReadWriteStream;
    } = stream.pipe(gulpIf(sortFiles, sort())).pipe(spriteSmith(spritesmithSettings));

    return mergeStream(
      sprite.img.pipe(dest(".", options)),
      sprite.css
        .pipe(header("// sass-lint:disable-all\n\n"))
        .pipe(dest(this._settings.settings.sass.dst, options) as NodeJS.WritableStream)
    );
  }

  private _srcGlobs(): string[] {
    if (this._settings["src-1x"] && this._settings["src-2x"]) {
      return [...this._settings["src-1x"], ...this._settings["src-2x"]];
    }

    return this._settings.src;
  }
}
