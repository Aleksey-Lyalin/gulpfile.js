import cleanUpString from "clean-up-string";
import uniq from "lodash/uniq";
import rework from "rework";
import reworkMoveMedia from "rework-move-media";
import reworkSplitMedia from "rework-split-media";
import File from "vinyl";

export default class MediaQueries {
  /**
   * Extract media queries from files.
   *
   * @param file
   * @return {string[]}
   */
  public static extractMediaQueries(file: File): string[] {
    if (file.isBuffer() || file.isStream()) {
      const reworkData = rework(file.contents.toString()).use(reworkMoveMedia());
      const stylesheets = reworkSplitMedia(reworkData);

      return uniq(Object.keys(stylesheets));
    }

    return [];
  }

  /**
   * Get media query from filename.
   *
   * @param {string} filename
   * @param {string[]} queries
   * @return {string}
   */
  public static mediaQuery(filename: string, queries: string[]): string {
    const media: string[] = queries.filter(
      (query: string): boolean => filename.indexOf(`.${cleanUpString(query)}.css`) >= 0
    );

    return media[0] || "";
  }
}
