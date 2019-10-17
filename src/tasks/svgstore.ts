import cheerio from "gulp-cheerio";
import rename from "gulp-rename";
import svgMin from "gulp-svgmin";
import svgStore from "gulp-svgstore";
import merge from "lodash/merge";
import path from "path";
import svgo from "svgo";
import Vinyl from "vinyl";

import TaskExtended from "./task-extended";

/**
 * Combine SVG files into one.
 */
export default class SVGStore extends TaskExtended {
  /**
   * Global task name.
   * @type {string}
   * @readonly
   */
  public static readonly taskName: string = "svgstore";

  /**
   * Task constructor.
   *
   * @param {string} name
   * @param {object} settings
   */
  constructor(name: string, settings: object) {
    super(name, settings);

    // No need of linter.
    this._withLinter = false;

    const defaultSettings: {} = {
      svgmin: {
        plugins: [
          {
            inlineStyles: {
              onlyMatchedOnce: true,
              removeMatchedSelectors: true,
            },
          },
          {
            removeDoctype: true,
          },
          {
            removeComments: true,
          },
          {
            removeMetadata: true,
          },
          {
            removeTitle: true,
          },
          {
            removeDesc: true,
          },
          {
            removeViewBox: false,
          },
          {
            removeDimensions: true,
          },
        ],
      },
      svgstore: {
        inlineSvg: true,
      },
    };

    this._settings.settings = merge(defaultSettings, this._settings.settings);
  }

  /**
   * Method to add specific steps for the build.
   *
   * @param {NodeJS.ReadWriteStream} stream
   * @return {NodeJS.ReadWriteStream}
   * @protected
   */
  protected _buildSpecific(stream: NodeJS.ReadWriteStream): NodeJS.ReadWriteStream {
    return stream
      .pipe(
        svgMin(
          (file: Vinyl): svgo.Options =>
            merge(this._settings.settings.svgmin, {
              plugins: [
                {
                  cleanupIDs: {
                    force: true,
                    minify: true,
                    prefix: path.basename(file.relative, path.extname(file.relative)) + "-",
                  },
                },
              ],
            })
        )
      )
      .pipe(svgStore(this._settings.settings.svgstore))
      .pipe(cheerio({
        parserOptions: {
          xmlMode: true,
        },
        // tslint:disable-next-line:ban-types
        run: ($: CheerioStatic, file: Vinyl, done?: Function): any => {
          // Append view and use tags to the SVG.
          let offsetY: number = 0;
          let maxWidth: number = 0;

          const views: Cheerio = $("<views />");
          const uses: Cheerio = $("<uses />");

          $("symbol")
            .filter((index: number, symbol: CheerioElement): boolean => !!symbol.attribs.id && !!symbol.attribs.viewBox)
            .each((index: number, symbol: CheerioElement): void => {
              if (this._settings.settings.prefix) {
                symbol.attribs.id = `${this._settings.settings.prefix}-${symbol.attribs.id}`;
              }

              const [originX, , width, height] = symbol.attribs.viewBox
                .split(" ")
                .map((i: string): number => Number(i));
              const name: string = `${symbol.attribs.id}-icon`;

              views.append(`<view id="${name}" viewBox="${originX} ${offsetY} ${width} ${height}" />`);

              uses.append(
                `<use
                     xlink:href="#${symbol.attribs.id}"
                     width="${width}"
                     height="${height}"
                     x="${originX}"
                     y="${offsetY}" />`
              );

              offsetY += height;
              maxWidth = Math.max(maxWidth, width);
            });

          $("svg")
            .attr("xmlns:xlink", "http://www.w3.org/1999/xlink")
            .attr("viewBox", `0 0 ${maxWidth} ${offsetY}`)
            // @ts-ignore
            .append(views[0].children)
            .append(uses[0].children);

          if (done) {
            done();
          }
        },
      }) as NodeJS.WritableStream)
      .pipe(rename({
        basename: path.basename(this._settings.filename, path.extname(this._settings.filename)),
        extname: ".svg",
      }) as NodeJS.WritableStream);
  }
}
