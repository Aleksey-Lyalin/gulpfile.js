import log from "fancy-log";
import fs from "fs";
import * as yaml from "js-yaml";
import merge from "lodash/merge";
import minimist, { ParsedArgs } from "minimist";
import path from "path";
import process from "process";

import { explodeTaskName, filterObject, modules } from "./utils";

export interface Options {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [name: string]: any;
}

interface SizesOptions {
  gzipped: boolean;
  normal: boolean;
}

interface TaskOptions {
  src: string[];
  dst: string;
  watch?: string[];
  filename?: string;
  cwd?: string;
  revision?: string;
  settings?: Options;
  sizes?: boolean | Options | SizesOptions;
}

/**
 * Get configuration of the application from command line and settings file.
 */
export default class Config {
  /**
   * Get name of the current run.
   *
   * @return {string}
   */
  get currentRun(): string {
    if (this.options._.length === 0) {
      return "default";
    }

    return this.options._[0];
  }

  /**
   * Get options.
   *
   * @return {ParsedArgs}
   */
  get options(): ParsedArgs {
    return this._options;
  }

  /**
   * Get settings.
   */
  get settings(): Options {
    if (this.currentRun !== "default") {
      const { type, name } = explodeTaskName(this.currentRun);

      return filterObject(this._settings, (obj: unknown, key: string): boolean => {
        const valid: boolean = type === "" || key === type;

        if (valid && name !== "") {
          this._settings[key] = filterObject(this._settings[key], (o: unknown, k: string) => k === name);
        }

        return valid;
      });
    }

    return this._settings;
  }

  /**
   * Change the current working directory.
   *
   * @param directory
   */
  public static chdir(directory: string): void {
    try {
      process.chdir(directory);
    } catch (err) {
      log.error(`chdir: ${err}`);
    }
  }

  /**
   * Get Config instance.
   *
   * @return Unique instance of Config.
   */
  public static getInstance(): Config {
    if (!Config._instance) {
      log("Loading configuration file...");

      Config._instance = new Config();
      Config._instance._refreshOptions();
      Config._instance._refreshSettings();

      log("Configuration file loaded");
    }

    return Config._instance;
  }

  /**
   * Config instance.
   * @type {Config}
   * @private
   */
  private static _instance: Config;

  /**
   * Global options passed in command line.
   * @type {ParsedArgs}
   * @private
   */
  private _options: ParsedArgs = {
    _: [],
  };

  /**
   * All settings in YAML file that define tasks.
   * @type {Options}
   * @private
   */
  private _settings: Options = {};

  /**
   * Check if current run is a build run.
   *
   * @return {boolean}
   */
  public isBuildRun(): boolean {
    return this._isIndentifiedRun("build");
  }

  /**
   * Check if current run is a lint run.
   *
   * @return {boolean}
   */
  public isLintRun(): boolean {
    return this._isIndentifiedRun("lint");
  }

  /**
   * Check if a task is the current run.
   *
   * @param {string} taskName
   * @return {boolean}
   */
  public isCurrentRun(taskName: string): boolean {
    return this.currentRun === taskName;
  }

  /**
   * Identify a run.
   *
   * @param {string} run
   * @returns {boolean}
   * @private
   */
  private _isIndentifiedRun(run: string): boolean {
    return (
      this.currentRun !== "default" &&
      this.currentRun.lastIndexOf(run) >= 0 &&
      this.currentRun.lastIndexOf(run) === this.currentRun.length - run.length
    );
  }

  /**
   * Read options for application from command line.
   */
  private _refreshOptions(): void {
    // Merge default options with command line arguments
    this._options = minimist(process.argv.slice(2), {
      boolean: ["sourcemaps"],
      default: {
        configfile: process.env.CONFIG_FILE || "gulpconfig.yml",
        cwd: "",
        env: process.env.NODE_ENV || "production",
        revision: false,
        sourcemaps: process.env.SOURCEMAPS || false,
      },
      string: ["configfile", "cwd", "env", "revision"],
    });

    if (!path.isAbsolute(this._options.configfile)) {
      this._options.configfile = path.resolve(process.env.PWD || "", this._options.configfile);
    }
  }

  /**
   * Read settings from configuration file.
   */
  private _refreshSettings(): void {
    // Read configuration file.
    try {
      this._settings = yaml.safeLoad(fs.readFileSync(this._options.configfile, "utf8"));
    } catch (e) {
      log.error(e.stack || String(e));
    }

    // Normalize current working directory.
    if (!this._options.cwd) {
      if (!this._settings.cwd) {
        this._options.cwd = path.dirname(this._options.configfile);
      } else if (!path.isAbsolute(this._settings.cwd as string)) {
        this._options.cwd = path.resolve(path.dirname(this._options.configfile), this._settings.cwd as string);
      }

      delete this._settings.cwd;
    }

    // Get revision settings.
    if (!this._options.revision && this._settings.revision) {
      this._options.revision = this._settings.revision;
      delete this._settings.revision;
    }

    // Get sizes settings.
    if (!this._options.sizes) {
      const defaultSizes: SizesOptions = {
        normal: true,
        gzipped: true,
      };

      if (typeof this._settings.sizes === "boolean") {
        this._settings.sizes = {
          normal: this._settings.sizes,
          gzipped: this._settings.sizes,
        };
      } else if (typeof this._settings.sizes === "object") {
        this._settings.sizes = merge(defaultSizes, this._settings.sizes);
      } else {
        this._settings.sizes = defaultSizes;
      }

      this._options.sizes = this._settings.sizes;
      delete this._settings.sizes;
    }

    // Merge global and local settings in each tasks.
    for (const name of modules) {
      const settings: Options = this._settings[name] as Options;

      if (settings && !settings.tasks) {
        settings.cwd = this._options.cwd;
      } else if (settings && settings.tasks) {
        for (const taskName of Object.keys(settings.tasks)) {
          const task: TaskOptions = (settings.tasks as Options)[taskName] as TaskOptions;

          task.settings = merge(settings.settings || {}, task.settings || {});

          for (const option of ["cwd", "revision", "sizes"]) {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            if (!(task as any)[option]) {
              (task as any)[option] = this._options[option];
            }
            /* eslint-enable @typescript-eslint/no-explicit-any */
          }

          settings[taskName] = task;
        }

        delete settings.tasks;
        delete settings.settings;
      }
    }
  }
}
