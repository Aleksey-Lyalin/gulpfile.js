import crypto from "crypto";
import fs from "fs";
import merge from "lodash/merge";
import path from "path";
import PluginError from "plugin-error";
import { Transform } from "stream";
import through, { TransformCallback } from "through2";
import Vinyl from "vinyl";
import vinylFile from "vinyl-file";

import Config from "./config";
import TaskFactory from "./task-factory";

enum Hash {
  MD5 = "md5",
  SHA1 = "sha1",
  SHA256 = "sha256",
}

interface IDefaultObject {
  [name: string]: any;
}

interface IRevisionManifest {
  [type: string]: {
    [name: string]: {
      [origRelFile: string]: {
        revRelFile: string;
        [Hash.MD5]: string;
        [Hash.SHA1]: string;
        [Hash.SHA256]: string;
      };
    };
  };
}

interface IRevisionDefaultOption {
  manifest?: string;
}

export interface IRevisionOptions extends IRevisionDefaultOption {
  cwd: string;
  dst: string;
  taskName: string;
}

/**
 * Collect hashes from build files.
 */
export default class Revision {
  /**
   * Get hash for a file in a task.
   *
   * @param {string} taskName
   * @param {string} fileName
   * @param {Hash} hash
   * @return {string | false}
   */
  public static getHash(taskName: string, fileName: string, hash: Hash = Hash.SHA1): string | false {
    const { type, name } = TaskFactory.explodeTaskName(taskName);

    // If revision is deactivated, return false.
    if (!Revision.isActive()) {
      return false;
    }

    if (path.isAbsolute(fileName)) {
      return Revision._hashFile(fileName, hash);
    }

    // Try to search and return hash.
    try {
      return Revision._manifest[type][name][fileName][hash];
    } catch (e) {
      // Do nothing!
    }

    return false;
  }

  /**
   * Get hash for a file in a task to use in URL parameters (only the first 10 characters).
   *
   * @param {string} taskName
   * @param {string} fileName
   * @param {Hash} hash
   * @return {string | false}
   */
  public static getHashRevision(taskName: string, fileName: string, hash: Hash = Hash.SHA1): string | false {
    const hashStr = Revision.getHash(taskName, fileName, hash);
    return hashStr === false ? hashStr : hashStr.slice(0, 10);
  }

  /**
   * Check if revision is activated.
   *
   * @return {boolean}
   */
  public static isActive() {
    const config = Config.getInstance();
    return !!config.settings.revision;
  }

  /**
   * Collect hashes from build files.
   *
   * @param {IRevisionOptions} options
   * @return {Transform}
   */
  public static manifest(options: IRevisionOptions): Transform {
    const defaultOptions: IRevisionDefaultOption = {
      manifest: "rev-manifest.json",
    };

    options = merge(defaultOptions, options);

    // Do nothing if revision is deactivated.
    if (!Revision.isActive()) {
      return through.obj();
    }

    return through.obj(
      (file: any, encoding: string, cb: TransformCallback): void => {
        // Collect files and calculate hash from the stream.

        // Exclude null, stream and MAP files, only Buffer works.
        if (file.isNull() || file.isStream() || path.extname(file.path) === ".map") {
          return cb();
        }

        // Get relative path and name of the file.
        const revBase: string = path.resolve(file.cwd, file.base).replace(/\\/g, "/");
        const revPath: string = path.resolve(file.cwd, file.path).replace(/\\/g, "/");

        let revRelFile: string = "";

        if (!revPath.startsWith(revBase)) {
          revRelFile = revPath;
        } else {
          revRelFile = revPath.slice(revBase.length);

          if (revRelFile[0] === "/") {
            revRelFile = revRelFile.slice(1);
          }
        }

        const origRelFile = path.join(path.dirname(revRelFile), path.basename(file.path)).replace(/\\/g, "/");
        revRelFile = path.join(options.dst, revRelFile);

        // Insert file and calculated hashes into the manifest.
        Revision._pushHash(origRelFile, revRelFile, file.contents, options);

        cb();
      },
      function(cb: TransformCallback): void {
        // Merge and write manifest.
        const manifestFile = options.manifest as string;

        // Read manifest file.
        vinylFile
          .read(manifestFile, options)
          .catch(
            // File not exists, create new one.
            (error: any): Vinyl => {
              if (error.code === "ENOENT") {
                return new Vinyl({
                  path: manifestFile,
                });
              }

              throw error;
            }
          )
          .then((manifest: Vinyl): void => {
            let oldManifest = {};

            // Read manifest file.
            try {
              if (manifest.contents !== null) {
                oldManifest = JSON.parse(manifest.contents.toString());
              }
            } catch (e) {
              // Do nothing!
            }

            // Merge memory and file. Sort it by keys to improve reading and file versioning.
            Revision._manifest = Revision._sortObjectByKeys(merge(oldManifest, Revision._manifest));

            // Send manifest in stream.
            manifest.contents = Buffer.from(JSON.stringify(Revision._manifest, null, "  "));
            this.push(manifest);

            cb();
          })
          .catch(cb);
      }
    );
  }

  /**
   * Push arbitrary file in manifest.
   *
   * @param {string} fileName
   * @param {IRevisionOptions} options
   */
  public static pushAndWrite(fileName: string, options: IRevisionOptions): void {
    if (!Revision.isActive() || !path.isAbsolute(fileName)) {
      return;
    }

    const origRelFile = path.basename(fileName);
    const revRelFile = path.join(options.dst, origRelFile);

    fs.readFile(fileName, (error: NodeJS.ErrnoException | null, data: Buffer): void => {
      if (error) {
        throw error;
      }

      Revision._pushHash(origRelFile, revRelFile, data, options);

      // tslint:disable-next-line:no-empty
      fs.writeFile(
        path.resolve(options.cwd, options.manifest as string),
        JSON.stringify(Revision._manifest, null, "  "),
        (): void => {}
      );
    });
  }

  /**
   * Collection of hashes.
   * @type {IRevisionManifest}
   * @private
   */
  private static _manifest: IRevisionManifest = {};

  /**
   * Calculate the hash from a string or a Buffer.
   *
   * @param {string | Buffer} contents
   * @param {Hash} hash
   * @return {string}
   * @private
   */
  private static _hash(contents: string | Buffer, hash: Hash): string {
    if (typeof contents !== "string" && !Buffer.isBuffer(contents)) {
      throw new PluginError("revision", "Expected a Buffer or string");
    }

    return crypto
      .createHash(hash)
      .update(contents)
      .digest("hex");
  }

  /**
   * Calculate the hash from a file with its name.
   *
   * @param {string} fileName
   * @param {Hash} hash
   * @return {string}
   * @private
   */
  private static _hashFile(fileName: string, hash: Hash): string {
    return Revision._hash(fs.readFileSync(fileName), hash);
  }

  /**
   * Push a new file in manifest and calculate the hash of this file.
   *
   * @param {string} origRelFile
   * @param {string} revRelFile
   * @param {string | Buffer} contents
   * @param {IRevisionOptions} options
   * @private
   */
  private static _pushHash(
    origRelFile: string,
    revRelFile: string,
    contents: string | Buffer,
    options: IRevisionOptions
  ): void {
    const { type, name } = TaskFactory.explodeTaskName(options.taskName);

    Revision._manifest = Revision._sortObjectByKeys(
      merge(Revision._manifest, {
        [type]: {
          [name]: {
            [origRelFile]: {
              md5: Revision._hash(contents, Hash.MD5),
              revRelFile,
              sha1: Revision._hash(contents, Hash.SHA1),
              sha256: Revision._hash(contents, Hash.SHA256),
            },
          },
        },
      })
    );
  }

  /**
   * Sort object by keys.
   *
   * @param {IDefaultObject} object
   * @return {IDefaultObject}
   * @private
   */
  private static _sortObjectByKeys(object: IDefaultObject) {
    const result: IDefaultObject = {};

    Object.keys(object)
      .sort()
      .forEach((key: string) => {
        result[key] = typeof object[key] === "object" ? Revision._sortObjectByKeys(object[key]) : object[key];
      });

    return result;
  }
}
