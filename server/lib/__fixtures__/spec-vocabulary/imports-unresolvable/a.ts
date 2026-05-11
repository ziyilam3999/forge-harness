// Imports a sibling that does NOT exist on disk. The vocabulary harvester
// should surface a warning and continue, NOT throw.
import { Phantom } from "./does-not-exist.js";

export class Solid {
  public usePhantom(): Phantom {
    return new Phantom();
  }
}
