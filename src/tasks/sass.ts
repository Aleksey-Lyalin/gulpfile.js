import Browsersync from "./browsersync";
import Task from "./task";

export default class Sass extends Task {
  public static readonly taskName: string = "sass";

  // tslint:disable-next-line:no-empty
  public buildSpecific(stream: NodeJS.ReadWriteStream): void {}

  // tslint:disable-next-line:no-empty
  public lintSpecific(stream: NodeJS.ReadWriteStream): void {}
}
