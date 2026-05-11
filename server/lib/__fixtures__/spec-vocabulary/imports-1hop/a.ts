import { Foo } from "./b.js";

export class A {
  public useFoo(): Foo {
    return new Foo();
  }
}
