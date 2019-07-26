import process from "process";

import { dest, series, src, task as gulpTask, watch } from "gulp";
import GulpPlumber from "gulp-plumber";

import Config, { IGenericSettings } from "../modules/config";
import Browsersync from "./browsersync";

interface ITaskErrorDefinition {
  taskName: string;
  error: any;
  done: TaskCallback;
}

export type TaskCallback = (error?: any) => void;

export default abstract class Task {
  public static taskErrors: ITaskErrorDefinition[] = [];

  protected task: string = "";
  protected name: string = "";
  protected settings: IGenericSettings = {};

  protected watchingFiles: string[] = [];

  protected browserSync: Browsersync;
  protected browserSyncSettings: {} = {};

  protected withLinter: boolean = true;
  protected lintError: boolean = false;

  protected constructor(name: string, settings: object, browserSync: Browsersync) {
    this.name = name;
    this.settings = settings;

    this.browserSync = browserSync;
  }

  public build(): string {
    const taskName = this.taskName("build");

    gulpTask(
      taskName,
      (done: TaskCallback): NodeJS.ReadWriteStream => {
        this.chdir();

        const stream = src(this.settings.src, { cwd: this.settings.cwd }).pipe(
          GulpPlumber(error => this.exitOnError(taskName, error, done))
        );

        if (!this.withLinter || !this.lintError) {
          this.buildSpecific(stream);

          stream
            .pipe(GulpPlumber.stop())
            .pipe(dest(this.settings.dst, { cwd: this.settings.cwd }))
            .pipe(this.browserSync.sync(this.browserSyncSettings));
        }

        return stream;
      }
    );

    return taskName;
  }

  public abstract buildSpecific(stream: NodeJS.ReadWriteStream): void;

  public lint(): string | false {
    const taskName = this.taskName("lint");

    if (!this.withLinter) {
      return false;
    }

    this.lintError = false;

    gulpTask(
      taskName,
      (): NodeJS.ReadWriteStream => {
        this.chdir();

        const stream = src(this.settings.src, { cwd: this.settings.cwd });
        this.lintSpecific(stream);

        return stream;
      }
    );

    return taskName;
  }

  public abstract lintSpecific(stream: NodeJS.ReadWriteStream): void;

  public watch(): string {
    const taskName = this.taskName("watch");

    gulpTask(taskName, (done: TaskCallback): void => {
      const srcWatch = [...this.settings.src, ...(this.settings.watch || []), ...this.watchingFiles];
      const tasks = [this.taskName("build")];

      if (this.withLinter) {
        tasks.unshift(this.taskName("lint"));
      }

      watch(srcWatch, { cwd: this.settings.cwd }, series(tasks));

      done();
    });

    return taskName;
  }

  protected displayError(error: any): void {
    console.log(error);
  }

  protected chdir(): void {
    try {
      process.chdir(this.settings.cwd);
    } catch (err) {
      console.error(`chdir: ${err}`);
    }
  }

  protected exitOnError(taskName: string, error: any, done: TaskCallback): void {
    this.displayError(error);

    Task.taskErrors.push({
      done,
      error,
      taskName
    });

    if (this.isBuildRun() && this.isCurrentRun(taskName)) {
      done();
      process.exit(1);
    }
  }

  protected isBuildRun(): boolean {
    return Config.getInstance().isBuildRun();
  }

  protected isCurrentRun(task: string): boolean {
    return Config.getInstance().isCurrentRun(task);
  }

  protected taskName(step: string): string {
    return `${this.task}:${this.name}:${step}`;
  }
}
