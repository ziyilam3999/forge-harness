export function genericFunc<T, U>(arg: T): U {
  return arg as unknown as U;
}

export class GenericBox<T> {
  value: T;
  constructor(v: T) {
    this.value = v;
  }
  unwrap(): T {
    return this.value;
  }
}
