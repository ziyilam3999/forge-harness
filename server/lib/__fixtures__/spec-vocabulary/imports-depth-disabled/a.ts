import { OnlySeenWhenFollowed } from "./b.js";

export class Root {
  public ref(): OnlySeenWhenFollowed {
    return new OnlySeenWhenFollowed();
  }
}
