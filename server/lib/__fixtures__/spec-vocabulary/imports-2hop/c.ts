export interface CeeShape {
  id: number;
  name: string;
}

export class CeeHelper {
  public build(): CeeShape {
    return { id: 0, name: "" };
  }
}
