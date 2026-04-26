export class Foo {
  bar(x: string): Promise<Baz> {
    return Promise.resolve({ id: x });
  }
  private secret(): void {}
}

export interface Baz {
  id: string;
}
